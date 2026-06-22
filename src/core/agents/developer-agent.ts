import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { handleRunCommand, handleListFiles, handleSearchFile, handleSearchCode } from './agent-tools.js';
import { skillManager } from '../workflow/skill-manager.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { FileLogger } from '../debug/file-logger.js';
import { MessageQueue, QueueMessage } from '../workflow/message-queue.js';

const AGENT_TYPE = 'developer_agent';

async function promptUser(message: string, initialValue?: string, placeholder?: string, prefix: string = ''): Promise<string> {
    let userReply = await tui.text({ message: `${prefix}${message}`, initialValue, placeholder });
    
    while (userReply === '/skills') {
        const availableSkills = await skillManager.listAvailableSkills();
        const options = availableSkills.map(name => ({ value: name, label: name }));
        if (options.length === 0) {
            tui.log.warning('Nenhuma skill encontrada. Execute `shark super` para instalar as skills.');
        } else {
            const selectedSkill = await tui.select({
                message: 'Selecione a Skill do Superpowers para ativar:',
                options
            });
            if (!tui.isCancel(selectedSkill)) {
                await skillManager.activateSkill(selectedSkill as string);
                tui.log.success(`✔ Skill '${selectedSkill}' ativada com sucesso!`);
            }
        }
        userReply = await tui.text({ 
            message: `${prefix}${message}`, 
            initialValue, 
            placeholder: 'digite a instrução da tarefa...' 
        });
    }
    
    return userReply as string;
}

export async function waitForInputOrNotification(
    queue: MessageQueue,
    promptMessage: string = 'Your answer:',
    subagentPrefix: string = '',
    timeoutMs?: number
): Promise<QueueMessage> {
    let cancelled = false;
    let resolvePromptPromise: ((value: QueueMessage) => void) | null = null;
    let timerId: any = null;

    const promptPromise = new Promise<QueueMessage>((resolve) => {
        resolvePromptPromise = resolve;
    });

    const runPrompt = async () => {
        try {
            const userReply = await promptUser(promptMessage, undefined, undefined, subagentPrefix);
            if (!cancelled && resolvePromptPromise) {
                resolvePromptPromise({
                    type: 'user',
                    content: userReply,
                    timestamp: Date.now()
                });
            }
        } catch (e) {}
    };
    runPrompt();

    const queuePromise = queue.next();

    const promises: Promise<QueueMessage>[] = [promptPromise, queuePromise];

    if (timeoutMs !== undefined && timeoutMs !== null) {
        const timeoutPromise = new Promise<QueueMessage>((resolve) => {
            timerId = setTimeout(() => {
                resolve({
                    type: 'timeout',
                    content: 'Wait timeout expired.',
                    timestamp: Date.now()
                });
            }, timeoutMs);
        });
        promises.push(timeoutPromise);
    }

    const winner = await Promise.race(promises);

    if (timerId) {
        clearTimeout(timerId);
    }

    if (winner.type === 'subagent_notification' || winner.type === 'timeout') {
        cancelled = true;
        process.stdin.emit('data', '\r');
        await new Promise(r => setTimeout(r, 50));
        if (process.stdout.isTTY) {
            process.stdout.write('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');
        }
    }

    return winner;
}


function formatRoleForUI(role: string): string {
    const limit = 20;
    if (role.length <= limit) return role;
    return role.substring(0, limit - 3) + '...';
}

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
    const isSubagent = !!options.taskId && (options.taskId.startsWith('subagent-') || subagentManager.hasSubagent(options.taskId));
    const projectRoot = process.cwd();
    const messageQueue = new MessageQueue();
    
    let currentTask = options.taskInstruction;
    if (!currentTask) {
        if (isSubagent) {
            currentTask = 'Subagent Task';
        } else {
            const userTask = await promptUser(
                'O que você gostaria que o Shark Dev fizesse?',
                undefined,
                'ex: crie uma API REST simples ou digite /skills para ativar diretrizes'
            );
            if (tui.isCancel(userTask) || !userTask) {
                return { success: false, summary: 'Task execution cancelled.' };
            }
            currentTask = userTask;
        }
    }

    let subagentPrefix = '';
    if (options.taskId) {
        const subState = subagentManager.getSubagentState(options.taskId);
        if (subState) {
            subagentPrefix = `[Subagent: ${formatRoleForUI(subState.role)}] `;
        }
    }

    const log = {
        info: (msg: string) => tui.log.info(`${subagentPrefix}${msg}`),
        warning: (msg: string) => tui.log.warning(`${subagentPrefix}${msg}`),
        error: (msg: string) => tui.log.error(`${subagentPrefix}${msg}`),
        success: (msg: string) => tui.log.success(`${subagentPrefix}${msg}`),
        message: (msg: string) => tui.log.message(`${subagentPrefix}${msg}`),
    };

    // Load context if available
    let contextContent = '';
    const defaultContextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
    const specificContextPath = options.context ? path.resolve(projectRoot, options.context) : defaultContextPath;

    if (fs.existsSync(specificContextPath)) {
        try {
            contextContent = fs.readFileSync(specificContextPath, 'utf-8');
        } catch (e) {
            log.warning(`Failed to read context file: ${e}`);
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

    let nextPrompt = basePrompt;
    let keepGoing = true;
    let finalSummary = "";
    const conversationKey = options.taskId ? `dev_agent_${options.taskId}` : `dev_agent_${Date.now()}`;
    const anchorManager = new AnchorStateManager();

    const spinner = tui.spinner();

    const handleCleanupSignal = (exitCode: number) => {
        const currentId = options.taskId || 'parent';
        const active = subagentManager.getActiveSubagentsForParent(currentId);
        if (active.length > 0) {
            for (const sub of active) {
                subagentManager.killSubagent(sub.id);
            }
        }
        process.exit(exitCode);
    };
    const sigIntHandler = () => handleCleanupSignal(130);
    const sigTermHandler = () => handleCleanupSignal(143);

    process.on('SIGINT', sigIntHandler);
    process.on('SIGTERM', sigTermHandler);

    try {
        while (keepGoing) {
            // Check if this subagent has been terminated by parent (only if it is a registered subagent)
            if (options.taskId && subagentManager.hasSubagent(options.taskId) && !subagentManager.isSubagentActive(options.taskId)) {
                log.warning(`Subagent ${options.taskId} was terminated.`);
                return { success: false, summary: 'Subagent terminated by manager.' };
            }

            // Retrieve incoming mailbox messages for this subagent or parent
            const recipientId = options.taskId || 'parent';
            const mailboxMessages = subagentManager.retrieveMessages(recipientId);
            let currentTurnPrompt = nextPrompt;
            if (mailboxMessages.length > 0) {
                currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${mailboxMessages.map(m => `- ${m}`).join('\n')}\n`;
            }

            // Inject active subagent status panel
            const myId = options.taskId || 'parent';
            const allSubagents = subagentManager.getActiveSubagentsForParent(myId);
            if (allSubagents.length > 0) {
                let panel = `\n\n--- CURRENT ACTIVE SUBAGENTS ---\n`;
                panel += `You have ${allSubagents.length} active subagent(s) running in the background:\n`;
                for (const sub of allSubagents) {
                    panel += `- ID: ${sub.id} | Role: ${sub.role} | Status: ${sub.status}\n`;
                }
                panel += `Use the 'wait' action if you have no other work and are waiting for these subagents to complete.\n`;
                panel += `--------------------------------\n`;
                currentTurnPrompt += panel;
            }

            // Append skill extension to this turn's prompt
            const promptToSend = currentTurnPrompt + skillManager.getSystemInstructionExtension();

            try {
                const activeSubagents = subagentManager.getActiveSubagents();
                const activeCount = activeSubagents.length;
                const spinnerText = activeCount > 0
                    ? `🦈 Shark Dev working... (Active subagents: ${activeCount})`
                    : '🦈 Shark Dev working...';
                spinner.start(spinnerText);

                const existingConversationId = await conversationManager.getConversationId(conversationKey);
                const provider = ProviderResolver.getProvider('developer_agent');
                const response = await provider.streamChat(promptToSend, {
                    conversationId: existingConversationId,
                    agentType: 'developer_agent',
                    onChunk: () => {}
                });

                if (response.conversation_id) {
                    await conversationManager.saveConversationId(conversationKey, response.conversation_id);
                }

                spinner.stop('Response received');

                if (response.summary) {
                    if (options.taskId) {
                        subagentManager.updateSubagentSummary(options.taskId, response.summary);
                    }
                    log.info(`📌 Status: ${response.summary}`);
                }

                // Handle completion/failure messages
                if (response.message && response.message.includes('TASK_COMPLETED:')) {
                    finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                    log.success(`✔ Task Completed: ${finalSummary}`);
                    
                    if (options.taskId) {
                        subagentManager.updateSubagentSummary(options.taskId, finalSummary);
                        keepGoing = false;
                        break;
                    }

                    if (!options.taskInstruction) {
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix);
                        }
                        if (nextMsg.type === 'user') {
                            if (tui.isCancel(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                        }
                        nextPrompt = nextMsg.content;
                        continue;
                    } else {
                        keepGoing = false;
                        break;
                    }
                }

                if (response.message && response.message.includes('TASK_FAILED:')) {
                    const failureReason = response.message.split('TASK_FAILED:')[1].trim();
                    log.error(`❌ Agent reported task failure: ${failureReason}`);
                    
                    if (options.taskId) {
                        if (process.env.SHARK_PARENT_ID) {
                            const parentId = process.env.SHARK_PARENT_ID;
                            const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                            subagentManager.sendMessage(
                                parentId,
                                `[Subagent Notification] Subagent ${role} (${options.taskId}) has finished with status: FAILED. Summary: ${failureReason}`
                            );
                        }
                        return { success: false, summary: failureReason };
                    }

                    if (!options.taskInstruction) {
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix);
                        }
                        if (nextMsg.type === 'user') {
                            if (tui.isCancel(nextMsg.content)) {
                                return { success: false, summary: failureReason };
                            }
                        }
                        nextPrompt = nextMsg.content;
                        continue;
                    } else {
                        return { success: false, summary: failureReason };
                    }
                }

                const action = response.action;

                if (!action) {
                    if (isSubagent) {
                        log.warning('No action returned by the subagent. Exiting loop.');
                        keepGoing = false;
                        break;
                    }

                    if (response.message) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(response.message);
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix);
                        }
                        if (nextMsg.type === 'user') {
                            if (tui.isCancel(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                        }
                        nextPrompt = nextMsg.content;
                    } else {
                        log.warning('No action or message returned by the agent.');
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:', subagentPrefix);
                        }
                        if (nextMsg.type === 'user') {
                            if (tui.isCancel(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                        }
                        nextPrompt = nextMsg.content;
                    }
                    continue;
                }

                let resultMsg = "";

                if (action.type === 'read_file') {
                    const filePath = action.path || '';
                    log.info(`📖 Reading (Anchored): ${colors.dim(filePath)}`);
                    try {
                        const content = anchorManager.getAnchoredContent(filePath);
                        resultMsg = `[Action read_file(${filePath}) Success]:\n${content}`;
                    } catch (e: any) {
                        resultMsg = `[Action read_file(${filePath}) Failed]: ${e.message}`;
                    }
                }
                else if (action.type === 'modify_file') {
                    const filePath = action.path || '';
                    log.warning(`📝 Modify (Anchored): ${colors.bold(filePath)}`);

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
                    log.warning(`📝 Create file: ${colors.bold(filePath)}`);

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
                    log.warning(`🗑️ Delete file: ${colors.bold(filePath)}`);

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
                    log.info(`💻 Executing: ${colors.dim(cmd)}`);

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
                    log.info(`📂 Scanning: ${colors.dim(dirPath)}`);
                    try {
                        const result = handleListFiles(dirPath);
                        resultMsg = `[Action list_files(${dirPath}) Success]:\n${result}`;
                    } catch (e: any) {
                        resultMsg = `[Action list_files(${dirPath}) Failed]: ${e.message}`;
                    }
                }
                else if (action.type === 'search_file') {
                    const pattern = action.path || '';
                    log.info(`🔍 Searching files: ${colors.dim(pattern)}`);
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
                    log.info(`🔎 Search code: ${colors.dim(`"${query}" in ${glob}`)}`);
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
                    log.info(`⚡ Activating skill: ${colors.bold(name)}`);
                    try {
                        await skillManager.activateSkill(name);
                        resultMsg = `[System]: Skill '${name}' activated successfully.`;
                    } catch (e: any) {
                        resultMsg = `[System]: Failed to activate skill '${name}': ${e.message}`;
                    }
                }
                else if (action.type === 'talk_with_user') {
                    const isSystemError = action.content?.startsWith('[SYSTEM ERROR]');
                    if (isSystemError) {
                        log.error(`⚠️ Detectado erro na resposta do Agente (truncado ou inválido).`);
                        log.info(colors.dim(action.content || ''));
                        if (isSubagent) {
                            resultMsg = action.content || '';
                            nextPrompt = resultMsg;
                            continue; // Retry loop
                        } else {
                            let approved = isAuto;
                            if (!approved) {
                                approved = await tui.confirm({ message: `Enviar notificação de erro para o agente tentar se recuperar automaticamente?` });
                            }
                            if (approved) {
                                resultMsg = action.content || '';
                            } else {
                                let nextMsg: QueueMessage;
                                if (!messageQueue.isEmpty()) {
                                    nextMsg = await messageQueue.next();
                                } else {
                                    nextMsg = await waitForInputOrNotification(messageQueue, 'Seu prompt alternativo para o agente:', subagentPrefix);
                                }
                                if (nextMsg.type === 'user') {
                                    if (tui.isCancel(nextMsg.content)) {
                                        keepGoing = false;
                                        break;
                                    }
                                }
                                resultMsg = nextMsg.content;
                            }
                        }
                    } else {
                        const contentStr = action.content || '';
                        const hasCompleted = contentStr.includes('TASK_COMPLETED:');
                        
                        if (isSubagent) {
                            // Subagents cannot prompt the user. Treat talk_with_user as completion
                            const summary = hasCompleted ? contentStr.split('TASK_COMPLETED:')[1].trim() : contentStr;
                            subagentManager.updateSubagentSummary(options.taskId!, summary);
                            finalSummary = summary;
                            keepGoing = false;
                            break;
                        }

                        if (hasCompleted) {
                            finalSummary = contentStr.split('TASK_COMPLETED:')[1].trim();
                            log.success(`✔ Task Completed: ${finalSummary}`);
                            if (!options.taskInstruction) {
                                let nextMsg: QueueMessage;
                                if (!messageQueue.isEmpty()) {
                                    nextMsg = await messageQueue.next();
                                } else {
                                    nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix);
                                }
                                if (nextMsg.type === 'user') {
                                    if (tui.isCancel(nextMsg.content)) {
                                        keepGoing = false;
                                        break;
                                    }
                                }
                                nextPrompt = nextMsg.content;
                                continue;
                            } else {
                                keepGoing = false;
                                break;
                            }
                        }

                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(contentStr);
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix);
                        }
                        if (nextMsg.type === 'user') {
                            if (tui.isCancel(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                            resultMsg = `User Reply: ${nextMsg.content}`;
                        } else {
                            resultMsg = nextMsg.content;
                        }
                    }
                }
                else if (action.type === 'define_subagent') {
                    const name = action.name || '';
                    const desc = action.description || '';
                    const sysPrompt = action.system_prompt || '';
                    const opts = {
                        enableWriteTools: action.enable_write_tools ?? undefined,
                        enableSubagentTools: action.enable_subagent_tools ?? undefined,
                        enableMcpTools: action.enable_mcp_tools ?? undefined
                    };
                    log.info(`🛠️ Defining subagent type: ${colors.bold(name)}`);
                    subagentManager.defineSubagentType(name, desc, sysPrompt, opts);
                    resultMsg = `[Action define_subagent Success]: Defined subagent type '${name}'`;
                }
                else if (action.type === 'invoke_subagent') {
                    const subagentsToInvoke = action.Subagents || [];
                    log.info(`🚀 Invoking ${subagentsToInvoke.length} subagent(s)`);
                    const parentId = options.taskId || 'parent';
                    const invoked = await subagentManager.invokeSubagents(subagentsToInvoke, parentId, messageQueue);
                    resultMsg = `[Action invoke_subagent Success]: Invoked subagents:\n${invoked.map(s => `- ID: ${s.id}, Type: ${s.TypeName}, Role: ${s.Role}`).join('\n')}`;
                }
                else if (action.type === 'send_message') {
                    const recipient = action.Recipient || '';
                    const message = action.Message || '';
                    log.info(`✉️ Sending message to ${colors.bold(recipient)}`);
                    subagentManager.sendMessage(recipient, message);
                    resultMsg = `[Action send_message Success]: Message sent to '${recipient}'`;
                }
                else if (action.type === 'manage_subagents') {
                    const subAction = action.Action || '';
                    const ids = action.ConversationIds || [];
                    log.info(`⚙️ Managing subagents. Action: ${colors.bold(subAction)}`);

                    if (subAction === 'list') {
                        const active = subagentManager.getActiveSubagents();
                        resultMsg = `[Action manage_subagents Success]: Active subagents:\n${active.map(s => `- ID: ${s.id}, Type: ${s.type}, Role: ${s.role}`).join('\n')}`;
                    } else if (subAction === 'read_logs') {
                        const id = ids[0];
                        if (!id) {
                            resultMsg = `[Action manage_subagents Failed]: No subagent ID provided in ConversationIds.`;
                        } else {
                            try {
                                const logs = subagentManager.getSubagentLogs(id);
                                resultMsg = `[Action manage_subagents Success]: Last log lines for subagent ${id}:\n\`\`\`\n${logs}\n\`\`\``;
                            } catch (e: any) {
                                resultMsg = `[Action manage_subagents Failed]: ${e.message}`;
                            }
                        }
                    } else if (subAction === 'kill') {
                        for (const id of ids) {
                            subagentManager.killSubagent(id);
                        }
                        resultMsg = `[Action manage_subagents Success]: Terminated subagents: ${ids.join(', ')}`;
                    } else if (subAction === 'kill_all') {
                        subagentManager.killAllSubagents();
                        resultMsg = `[Action manage_subagents Success]: Terminated all active subagents`;
                    } else {
                        resultMsg = `[Action manage_subagents Failed]: Unknown action '${subAction}'`;
                    }
                }
                else if (action.type === 'complete_task') {
                    const detailedContent = action.content || '';
                    const taskSummary = action.summary || 'Task completed successfully.';
                    
                    if (isSubagent) {
                        subagentManager.updateSubagentSummary(options.taskId!, taskSummary);
                        // Send the detailed markdown content to parent mailbox instead of just a 1-sentence summary
                        if (process.env.SHARK_PARENT_ID) {
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${options.taskId}) completed.\nResult Details:\n${detailedContent}`
                            );
                        }
                    }
                    
                    finalSummary = taskSummary;
                    keepGoing = false;
                    break;
                }
                else if (action.type === 'wait') {
                    const durationSeconds = action.duration_seconds || 0;
                    const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                    log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);
                    
                    let nextMsg: QueueMessage;
                    if (!messageQueue.isEmpty()) {
                        nextMsg = await messageQueue.next();
                    } else {
                        nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs);
                    }

                    if (nextMsg.type === 'timeout') {
                        resultMsg = `[System]: Wait duration of ${durationSeconds} seconds expired. No notifications received.`;
                    } else if (nextMsg.type === 'user') {
                        if (tui.isCancel(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                        resultMsg = `User Reply: ${nextMsg.content}`;
                    } else {
                        resultMsg = nextMsg.content;
                    }
                }
                else if (action.type === 'notify_user') {
                    const messageContent = action.content || '';
                    if (messageContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(messageContent);
                    }
                    resultMsg = `[Action notify_user Success]: Notificação exibida com sucesso para o usuário.`;
                }
                else {
                    resultMsg = `[Unsupported action type: ${action.type}]`;
                }

                FileLogger.log('TOOL_EXECUTION', `Action: ${action.type}`, { action, result: resultMsg });
                nextPrompt = resultMsg;

            } catch (e: any) {
                log.error(e.message);
                if (options.taskId && process.env.SHARK_PARENT_ID) {
                    const parentId = process.env.SHARK_PARENT_ID;
                    const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                    subagentManager.sendMessage(
                        parentId,
                        `[Subagent Notification] Subagent ${role} (${options.taskId}) has finished with status: FAILED. Summary: Error: ${e.message}`
                    );
                }
                keepGoing = false;
                return { success: false, summary: `Error: ${e.message}` };
            }
        }

        const finalResult = { success: true, summary: finalSummary || "Task completed without summary." };
        if (options.taskId && process.env.SHARK_PARENT_ID) {
            const parentId = process.env.SHARK_PARENT_ID;
            const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
            subagentManager.sendMessage(
                parentId,
                `[Subagent Notification] Subagent ${role} (${options.taskId}) has finished with status: COMPLETED. Summary: ${finalResult.summary}`
            );
        }

        log.success('✅ Task Scope Completed');
        return finalResult;
    } finally {
        process.off('SIGINT', sigIntHandler);
        process.off('SIGTERM', sigTermHandler);

        // Auto terminate active subagents created by this parent to prevent leaks on exit
        const currentId = options.taskId || 'parent';
        const myActiveSubagents = subagentManager.getActiveSubagentsForParent(currentId);
        if (myActiveSubagents.length > 0) {
            log.info(`🧹 Terminating ${myActiveSubagents.length} active child subagent(s) before exit...`);
            for (const sub of myActiveSubagents) {
                subagentManager.killSubagent(sub.id);
            }
        }
    }
}
