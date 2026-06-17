import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { handleRunCommand } from './agent-tools.js';

const AGENT_TYPE = 'developer_agent';

export interface DevelopmentResult {
    success: boolean;
    summary: string;
}

export async function interactiveDeveloperAgent(options: {
    taskId?: string,
    taskInstruction?: string,
    context?: string,
    history?: string,
    auto?: boolean
} = {}): Promise<DevelopmentResult> {
    const isAuto = options.auto === true || process.argv.includes('--auto');
    const projectRoot = process.cwd();
    const currentTask = options.taskInstruction || "Analyze the project and fix pending issues.";

    // Load context if available
    let contextContent = '';
    const defaultContextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
    const specificContextPath = options.context ? path.resolve(projectRoot, options.context) : defaultContextPath;

    if (fs.existsSync(specificContextPath)) {
        try {
            contextContent = fs.readFileSync(specificContextPath, 'utf-8');
        } catch (e) {
            tui.log.warning(`Failed to read context file: ${e}`);
        }
    }

    // Build Prompt
    let basePrompt = ``;
    if (contextContent) {
        basePrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
    }

    if (options.history) {
        basePrompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
    }

    basePrompt += `\n\n🟢 EXECUTION MODE\n
You are a highly skilled Developer Agent.
👉 **CURRENT TASK**: "${currentTask}"

Your goal is to COMPLETE this specific task and then STOP.
1. Implement the necessary changes.
2. Verify (compile/test).
3. **MANDATORY**: When you are confident the task is done, output a final message starting with "TASK_COMPLETED:" followed by a brief technical summary of what you did.
`;

    let nextPrompt = basePrompt;
    let keepGoing = true;
    let finalSummary = "";
    const conversationKey = options.taskId ? `dev_agent_${options.taskId}` : `dev_agent_${Date.now()}`;
    const anchorManager = new AnchorStateManager();

    const spinner = tui.spinner();

    while (keepGoing) {
        try {
            spinner.start('🦈 Shark Dev working...');

            const existingConversationId = await conversationManager.getConversationId(conversationKey);
            const provider = ProviderResolver.getProvider('developer_agent');
            const response = await provider.streamChat(nextPrompt, {
                conversationId: existingConversationId,
                agentType: 'developer_agent',
                onChunk: () => {}
            });

            if (response.conversation_id) {
                await conversationManager.saveConversationId(conversationKey, response.conversation_id);
            }

            spinner.stop('Response received');

            // Handle completion/failure messages
            if (response.message && response.message.includes('TASK_COMPLETED:')) {
                finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                keepGoing = false;
                break;
            }

            if (response.message && response.message.includes('TASK_FAILED:')) {
                const failureReason = response.message.split('TASK_FAILED:')[1].trim();
                tui.log.error(`❌ Agent reported task failure: ${failureReason}`);
                return { success: false, summary: failureReason };
            }

            const action = response.action;

            if (!action) {
                if (response.message) {
                    tui.log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(response.message);
                    const userReply = await tui.text({ message: 'Your answer:' });
                    if (tui.isCancel(userReply)) {
                        keepGoing = false;
                        break;
                    }
                    nextPrompt = userReply as string;
                } else {
                    nextPrompt = "Please continue.";
                }
                continue;
            }

            let resultMsg = "";

            if (action.type === 'read_file') {
                const filePath = action.path || '';
                tui.log.info(`📖 Reading (Anchored): ${colors.dim(filePath)}`);
                try {
                    const content = anchorManager.getAnchoredContent(filePath);
                    resultMsg = `[Action read_file(${filePath}) Success]:\n${content}`;
                } catch (e: any) {
                    resultMsg = `[Action read_file(${filePath}) Failed]: ${e.message}`;
                }
            }
            else if (action.type === 'modify_file') {
                const filePath = action.path || '';
                tui.log.warning(`📝 Modify (Anchored): ${colors.bold(filePath)}`);

                let approved = isAuto;
                if (!approved) {
                    approved = await tui.confirm({ message: `Approve modify_file changes to ${filePath}?` });
                }

                if (approved) {
                    try {
                        anchorManager.applyAnchoredEdit(filePath, action.start_anchor || '', action.end_anchor || '', action.content || '');
                        resultMsg = `[Action modify_file(${filePath}) Success]`;
                    } catch (e: any) {
                        resultMsg = `[Action modify_file(${filePath}) Failed]: ${e.message}`;
                    }
                } else {
                    resultMsg = `[Action modify_file(${filePath}) User Denied]`;
                }
            }
            else if (action.type === 'create_file') {
                const filePath = action.path || '';
                tui.log.warning(`📝 Create file: ${colors.bold(filePath)}`);

                let approved = isAuto;
                if (!approved) {
                    approved = await tui.confirm({ message: `Approve create_file changes to ${filePath}?` });
                }

                if (approved) {
                    try {
                        const resolvedPath = path.resolve(projectRoot, filePath);
                        const dir = path.dirname(resolvedPath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }
                        fs.writeFileSync(resolvedPath, action.content || '', 'utf-8');
                        resultMsg = `[Action create_file(${filePath}) Success]`;
                    } catch (e: any) {
                        resultMsg = `[Action create_file(${filePath}) Failed]: ${e.message}`;
                    }
                } else {
                    resultMsg = `[Action create_file(${filePath}) User Denied]`;
                }
            }
            else if (action.type === 'delete_file') {
                const filePath = action.path || '';
                tui.log.warning(`🗑️ Delete file: ${colors.bold(filePath)}`);

                let approved = isAuto;
                if (!approved) {
                    approved = await tui.confirm({ message: `Approve delete_file changes to ${filePath}?` });
                }

                if (approved) {
                    try {
                        const resolvedPath = path.resolve(projectRoot, filePath);
                        if (fs.existsSync(resolvedPath)) {
                            fs.rmSync(resolvedPath, { force: true });
                        }
                        resultMsg = `[Action delete_file(${filePath}) Success]`;
                    } catch (e: any) {
                        resultMsg = `[Action delete_file(${filePath}) Failed]: ${e.message}`;
                    }
                } else {
                    resultMsg = `[Action delete_file(${filePath}) User Denied]`;
                }
            }
            else if (action.type === 'run_command') {
                const cmd = action.command || '';
                tui.log.info(`💻 Executing: ${colors.dim(cmd)}`);

                let approved = isAuto;
                if (!approved) {
                    approved = await tui.confirm({ message: `Execute run_command: ${cmd}?` });
                }

                if (approved) {
                    try {
                        const output = await handleRunCommand(cmd);
                        resultMsg = `[Action run_command(${cmd}) Success]:\n${output}`;
                    } catch (e: any) {
                        resultMsg = `[Action run_command(${cmd}) Failed]: ${e.message}`;
                    }
                } else {
                    resultMsg = `[Action run_command(${cmd}) User Denied]`;
                }
            }
            else if (action.type === 'talk_with_user') {
                tui.log.info(colors.primary('🤖 Shark Dev:'));
                console.log(action.content);
                const userReply = await tui.text({ message: 'Your answer:' });
                if (tui.isCancel(userReply)) {
                    keepGoing = false;
                    break;
                }
                resultMsg = `User Reply: ${userReply}`;
            }
            else {
                resultMsg = `[Unsupported action type: ${action.type}]`;
            }

            nextPrompt = resultMsg;

        } catch (e: any) {
            tui.log.error(e.message);
            keepGoing = false;
            return { success: false, summary: `Error: ${e.message}` };
        }
    }

    tui.log.success('✅ Task Scope Completed');
    return { success: true, summary: finalSummary || "Task completed without summary." };
}
