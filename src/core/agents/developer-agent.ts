import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { handleRunCommand, handleListFiles, handleSearchFile, handleSearchCode } from './agent-tools.js';
import { skillManager } from '../workflow/skill-manager.js';

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
    
    let currentTask = options.taskInstruction;
    if (!currentTask) {
        const userTask = await tui.text({
            message: 'O que você gostaria que o Shark Dev fizesse?',
            placeholder: 'ex: crie uma API REST simples ou me explique como funciona a estrutura do projeto'
        });
        if (tui.isCancel(userTask) || !userTask) {
            return { success: false, summary: 'Task execution cancelled by user.' };
        }
        currentTask = userTask as string;
    }

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

Your goal is to address the user's request:
- If the request is a question, a request for explanation, or a discussion, answer the user using the 'talk_with_user' action. You can search the codebase or read files first to answer accurately. Once the explanation/discussion is complete, output a final response starting with "TASK_COMPLETED:" followed by a brief summary.
- If the request is to implement changes, debug, or write code:
  1. Implement the necessary changes.
  2. Verify (compile/test).
  3. When you are confident the task is done, output a final response starting with "TASK_COMPLETED:" followed by a brief technical summary of what you did.
`;

    skillManager.reset();
    let nextPrompt = basePrompt + skillManager.getSystemInstructionExtension();
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
                    tui.log.warning('No action or message returned by the agent.');
                    const userReply = await tui.text({ message: 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:' });
                    if (tui.isCancel(userReply)) {
                        keepGoing = false;
                        break;
                    }
                    nextPrompt = userReply as string;
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
            else if (action.type === 'list_files') {
                const dirPath = action.path || '.';
                tui.log.info(`📂 Scanning: ${colors.dim(dirPath)}`);
                try {
                    const result = handleListFiles(dirPath);
                    resultMsg = `[Action list_files(${dirPath}) Success]:\n${result}`;
                } catch (e: any) {
                    resultMsg = `[Action list_files(${dirPath}) Failed]: ${e.message}`;
                }
            }
            else if (action.type === 'search_file') {
                const pattern = action.path || '';
                tui.log.info(`🔍 Searching files: ${colors.dim(pattern)}`);
                try {
                    const result = handleSearchFile(pattern);
                    resultMsg = `[Action search_file(${pattern}) Success]:\n${result}`;
                } catch (e: any) {
                    resultMsg = `[Action search_file(${pattern}) Failed]: ${e.message}`;
                }
            }
            else if (action.type === 'search_code') {
                const glob = action.path || 'src/**/*';
                const query = action.query || '';
                const isRegex = action.is_regex === true;
                tui.log.info(`🔎 Search code: ${colors.dim(`"${query}" in ${glob}`)}`);
                try {
                    const result = handleSearchCode(glob, query, isRegex);
                    resultMsg = `[Action search_code("${query}" in "${glob}") Success]:\n${result}`;
                } catch (e: any) {
                    resultMsg = `[Action search_code("${query}" in "${glob}") Failed]: ${e.message}`;
                }
            }
            else if (action.type === 'use_mcp_tool') {
                resultMsg = `[Action use_mcp_tool Failed]: MCP tools are not configured/available in this agent.`;
            }
            else if (action.type === 'activate_skill') {
                const name = action.skill_name || '';
                tui.log.info(`⚡ Activating skill: ${colors.bold(name)}`);
                try {
                    await skillManager.activateSkill(name);
                    resultMsg = `[System]: Skill '${name}' activated successfully.`;
                } catch (e: any) {
                    resultMsg = `[System]: Failed to activate skill '${name}': ${e.message}`;
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

            nextPrompt = resultMsg + skillManager.getSystemInstructionExtension();

        } catch (e: any) {
            tui.log.error(e.message);
            keepGoing = false;
            return { success: false, summary: `Error: ${e.message}` };
        }
    }

    tui.log.success('✅ Task Scope Completed');
    return { success: true, summary: finalSummary || "Task completed without summary." };
}
