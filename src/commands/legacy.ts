import { Command } from 'commander';
import { interactiveDeveloperAgent, DevelopmentResult } from '../core/agents/legacy-developer-agent.js';
import { TaskManager } from '../core/workflow/task-manager.js';
import { tui } from '../ui/tui.js';
import { colors } from '../ui/colors.js';
import { interactiveSpecificationAgent } from '../core/agents/specification-agent.js';

export const legacyCommand = new Command('legacy')
    .description('Starts the Legacy Developer Agent task orchestration loop')
    .option('-t, --task <type>', 'Initial task description (Quick Mode)')
    .option('-c, --context <path>', 'Path to custom context file')
    .action(async (options) => {
        const taskManager = new TaskManager(process.cwd());

        // 1. Check State
        let state = taskManager.analyzeSpecState();

        if (state.status === 'MISSING') {
            tui.log.warning('📋 No tech-spec.md found.');
            const confirm = await tui.confirm({ message: 'Create a new Specification (Tech Spec)?' });
            if (confirm) {
                // Handover to Spec Agent
                await interactiveSpecificationAgent({
                    briefingPath: options.task ? undefined : undefined
                });
                // Re-analyze after spec agent returns
                state = taskManager.analyzeSpecState();
                if (state.status === 'MISSING') {
                    tui.log.error('❌ Spec creation aborted or failed.');
                    return;
                }
            } else {
                return;
            }
        }

        // 2. Orchestration Loop
        let keepOrchestrating = true;
        let burnMode = false; // "Auto" mode
        let contextHistory = "";

        tui.intro('🦈 Shark Legacy Orchestrator');

        while (keepOrchestrating) {
            state = taskManager.analyzeSpecState();

            if (state.status === 'COMPLETED') {
                tui.log.success('🎉 All tasks in tech-spec.md are COMPLETED!');
                const choice = await tui.select({
                    message: 'What next?',
                    options: [
                        { value: 'exit', label: 'Exit' },
                        { value: 'new_spec', label: 'New Specification (Reset)' }
                    ]
                });
                if (choice === 'new_spec') {
                    await interactiveSpecificationAgent();
                    contextHistory = ""; // Reset history for new spec
                    continue; // Loop again
                } else {
                    keepOrchestrating = false;
                    break;
                }
            }

            const currentTask = state.nextTask;
            if (!currentTask) {
                tui.log.error('Something went wrong. Status is not completed but no next task found.');
                break;
            }

            tui.log.info(`\n👉 **NEXT TASK**: ${colors.bold(currentTask.description)}`);

            // Confirm Execution (unless Burn Mode)
            if (!burnMode) {
                const action = await tui.select({
                    message: 'Orchestration Checkpoint:',
                    options: [
                        { value: 'execute', label: '🚀 Execute Task (Start)' },
                        { value: 'burn', label: '🔥 Burn Mode (Auto-Execute Remaining)' },
                        { value: 'pivot', label: '🔧 Pivot/Correct (Edit Spec)' },
                        { value: 'skip', label: '⏭️ Skip Task (Mark Done without Executing)' },
                        { value: 'stop', label: '🛑 Stop Session' }
                    ]
                });

                if (action === 'stop') {
                    keepOrchestrating = false;
                    break;
                } else if (action === 'burn') {
                    burnMode = true;
                } else if (action === 'skip') {
                    taskManager.markTaskAsDone(currentTask.id);
                    tui.log.info('Task skipped.');
                    continue;
                } else if (action === 'pivot') {
                    tui.log.info('Transferring control to Specification Agent...');
                    await interactiveSpecificationAgent({
                        initialContext: `User requested pivot after tasks:\n${contextHistory}`
                    });
                    continue;
                }
            }

            // Execute Agent
            taskManager.markTaskInProgress(currentTask.id);

            tui.log.info(`⚡ Starting Micro-Context for Task: "${currentTask.description}"`);

            const result: DevelopmentResult = await interactiveDeveloperAgent({
                taskId: currentTask.id,
                taskInstruction: currentTask.description,
                history: contextHistory,
                context: options.context
            });

            if (result.success) {
                tui.log.success(`✅ Task Completed: ${currentTask.description}`);
                taskManager.markTaskAsDone(currentTask.id);
                contextHistory += `\n[Task "${currentTask.description}" completed]: ${result.summary}`;
            } else {
                tui.log.error(`❌ Task Failed: ${result.summary}`);
                burnMode = false; // Stop burn mode on failure

                const recovery = await tui.select({
                    message: 'Task Failed. Recovery Action:',
                    options: [
                        { value: 'retry', label: 'Retry (Run Agent Again)' },
                        { value: 'pivot', label: 'Pivot (Adjust Spec/Instructions)' },
                        { value: 'ignore', label: 'Ignore (Mark Done anyway)' },
                        { value: 'stop', label: 'Stop' }
                    ]
                });

                if (recovery === 'stop') break;
                if (recovery === 'ignore') taskManager.markTaskAsDone(currentTask.id);
                if (recovery === 'pivot') {
                    await interactiveSpecificationAgent({
                        initialContext: `Task "${currentTask.description}" FAILED.\nError: ${result.summary}\nHistory:\n${contextHistory}`
                    });
                }
            }
        }

        tui.outro('🦈 Legacy Orchestration Finished.');
    });
