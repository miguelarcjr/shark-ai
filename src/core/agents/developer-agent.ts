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
import { HistoryManager } from '../workflow/history-manager.js';
import { MemboxManager } from '../workflow/membox-manager.js';
import { ConfigManager } from '../config-manager.js';
import { encode } from 'gpt-tokenizer';
import { UNIFIED_SYSTEM_PROMPT } from '../api/prompts.js';

export function truncateToolOutput(output: string, maxTokens: number = 2000): string {
    const tokens = encode(output);
    if (tokens.length <= maxTokens) {
        return output;
    }
    const lines = output.split('\n');
    if (lines.length <= 80) {
        return output;
    }
    const head = lines.slice(0, 40).join('\n');
    const tail = lines.slice(-40).join('\n');
    return `${head}\n\n... [TRUNCADO PARA ECONOMIZAR CONTEXTO - ${lines.length - 80} LINHAS OCULTAS] ...\n\n${tail}`;
}

let activeOnCommandHandler: ((command: string) => Promise<boolean>) | undefined = undefined;

const AGENT_TYPE = 'developer_agent';

async function promptUser(message: string, initialValue?: string, placeholder?: string, prefix: string = ''): Promise<string> {
    let userReply = await tui.text({ message: `${prefix}${message}`, initialValue, placeholder });
    
    while (userReply && userReply.startsWith('/')) {
        let handled = false;
        if (activeOnCommandHandler) {
            handled = await activeOnCommandHandler(userReply);
        }
        if (!handled && userReply === '/skills') {
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
            handled = true;
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
    timeoutMs?: number,
    isAuto: boolean = false
): Promise<QueueMessage> {
    let cancelled = false;
    let resolvePromptPromise: ((value: QueueMessage) => void) | null = null;
    let timerId: any = null;

    const promises: Promise<QueueMessage>[] = [];

    if (!isAuto) {
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
        promises.push(promptPromise);
    }

    const queuePromise = queue.next();
    promises.push(queuePromise);

    if (timeoutMs !== undefined && timeoutMs !== null) {
        const timeoutPromise = new Promise<QueueMessage>((resolve) => {
            timerId = setTimeout(() => {
                if (resolvePromptPromise) {
                    cancelled = true;
                }
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
        if (!isAuto) {
            process.stdin.emit('data', '\r');
            await new Promise(r => setTimeout(r, 50));
            if (process.stdout.isTTY) {
                process.stdout.write('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');
            }
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
- If the request is a question, a request for explanation, or a discussion, answer the user using the 'talk_with_user' action. You can search the codebase or read files first to answer accurately. Once the explanation/discussion is complete, execute the 'complete_task' action with a brief summary in the 'summary' field and the full explanation in the 'content' field.
- If the request is to implement changes, debug, or write code:
  1. Implement the necessary changes.
  2. Verify (compile/test).
  3. When you are confident the task is done, execute the 'complete_task' action with a brief technical summary of what you did in the 'summary' field and any additional details in the 'content' field.

- Handling Subagent Notifications:
  - When you receive notifications about subagent progress or completion in your mailbox, do NOT invoke the 'talk_with_user' action just to relay this information to the user if you still have other subagents running, or if you have further steps to execute yourself.
  - Instead, process the subagent's output, update your task progress in the 'summary' field of your next action, and proceed with executing your next planned steps (or use the 'wait' action to continue waiting for other running subagents).
  - Only use 'talk_with_user' if you genuinely require the user's input/decision to proceed, or when the entire task is ready for final discussion.
`;

    let nextPrompt = basePrompt;
    let keepGoing = true;
    let finalSummary = "";
    const conversationKey = options.taskId ? `dev_agent_${options.taskId}` : `dev_agent_${Date.now()}`;
    const anchorManager = new AnchorStateManager();

    const onCommandHandler = async (command: string): Promise<boolean> => {
        if (command === '/compact') {
            tui.log.info('🦈 Compactando memória de forma manual...');
            const memboxManager = new MemboxManager();
            const existingConversationId = await conversationManager.getConversationId(conversationKey);
            if (existingConversationId) {
                try {
                    const rawHistory = await HistoryManager.getRawHistory(existingConversationId);
                    const provider = ProviderResolver.getProvider('developer_agent');
                    const truncatedHistory = await memboxManager.compactHistory(rawHistory, provider, existingConversationId, true);
                    await HistoryManager.saveRawHistory(existingConversationId, truncatedHistory);
                    tui.log.success('✔ Memória compactada e truncada com sucesso!');
                } catch (error: any) {
                    tui.log.error(`Erro durante a compactação: ${error.message}`);
                }
            } else {
                tui.log.warning('Nenhuma conversação ativa para compactar.');
            }
            return true;
        }
        if (command === '/context') {
            const existingConversationId = await conversationManager.getConversationId(conversationKey);
            if (existingConversationId) {
                const rawHistory = await HistoryManager.getRawHistory(existingConversationId);
                const totalTokensEst = Math.ceil(JSON.stringify(rawHistory).length / 4);
                tui.log.info(`📊 Histórico ativo: ${rawHistory.length} mensagens`);
                tui.log.info(`📊 Tamanho estimado: ${totalTokensEst} / 8000 tokens (${Math.round((totalTokensEst / 8000) * 100)}% do limite)`);
            } else {
                tui.log.warning('Nenhuma conversação ativa para analisar.');
            }
            return true;
        }
        return false;
    };
    activeOnCommandHandler = onCommandHandler;

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
            const promptToSend = currentTurnPrompt;

            try {
                const activeSubagents = subagentManager.getActiveSubagents();
                const activeCount = activeSubagents.length;
                const spinnerText = activeCount > 0
                    ? `🦈 Shark Dev working... (Active subagents: ${activeCount})`
                    : '🦈 Shark Dev working...';
                spinner.start(spinnerText);

                const existingConversationId = await conversationManager.getConversationId(conversationKey);
                
                if (existingConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(existingConversationId);
                    const memboxManager = new MemboxManager();
                    const searchQuery = nextPrompt || '';
                    const retrievedContext = await memboxManager.retrieveContext(searchQuery, rawHistory);
                    const skillExtension = skillManager.getSystemInstructionExtension();
                    
                    let fullTextForEstimation = UNIFIED_SYSTEM_PROMPT;
                    if (retrievedContext) {
                        fullTextForEstimation += '\n' + retrievedContext;
                    }
                    if (skillExtension) {
                        fullTextForEstimation += '\n' + skillExtension;
                    }
                    for (const msg of rawHistory) {
                        fullTextForEstimation += `\n${msg.role}: ${msg.content}`;
                    }
                    if (promptToSend) {
                        fullTextForEstimation += `\nuser: ${promptToSend}`;
                    }

                    const totalTokens = encode(fullTextForEstimation).length;
                    const compactionTokenLimit = ConfigManager.getInstance().getConfig().memory?.compactionTokenLimit ?? 8000;
                    const effectiveLimit = compactionTokenLimit - 1000; // 1000 token output margin

                    if (totalTokens >= effectiveLimit * 0.85) {
                        if (rawHistory.length >= 10) {
                            try {
                                log.info('🦈 Limite de context/tokens atingido. Iniciando compactação automática...');
                                const providerInstance = ProviderResolver.getProvider('developer_agent');
                                const truncatedHistory = await memboxManager.compactHistory(rawHistory, providerInstance, existingConversationId);
                                await HistoryManager.saveRawHistory(existingConversationId, truncatedHistory);
                                log.success('✔ Compactação automática concluída!');
                            } catch (error: any) {
                                log.error(`⚠️ Falha na compactação automática: ${error.message}. Prosseguindo sem compactação.`);
                            }
                        } else {
                            // Alerta de saturação do contexto estático (regras + skills)
                            log.warning(`⚠️ Alerta: O contexto estático (regras, prompts e skills ativas) está utilizando ${totalTokens} tokens. Isso representa mais de 85% do limite configurado (teto efetivo: ${effectiveLimit}). Para evitar erros de estouro de contexto, por favor desative algumas skills ou aumente o "compactionTokenLimit" no arquivo '.sharkrc'.`);
                        }
                    }
                }

                const provider = ProviderResolver.getProvider('developer_agent');
                const response = await provider.streamChat(promptToSend, {
                    conversationId: existingConversationId,
                    agentType: 'developer_agent',
                    searchQuery: nextPrompt,
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
                    const mainContent = response.message.split('TASK_COMPLETED:')[0].trim();
                    if (mainContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(mainContent);
                    }

                    finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                    log.success(`✔ Task Completed: ${finalSummary}`);
                    
                    if (options.taskId) {
                        subagentManager.updateSubagentSummary(options.taskId, finalSummary);
                        subagentManager.terminateSubagent(options.taskId, true);
                        if (process.env.SHARK_PARENT_ID) {
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${options.taskId}) completed.\nResult Details:\n${mainContent || finalSummary}`
                            );
                        }
                        keepGoing = false;
                        break;
                    }

                    if (!options.auto || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
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
                    const mainContent = response.message.split('TASK_FAILED:')[0].trim();
                    if (mainContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(mainContent);
                    }

                    const failureReason = response.message.split('TASK_FAILED:')[1].trim();
                    log.error(`❌ Agent reported task failure: ${failureReason}`);
                    
                    if (options.taskId) {
                        subagentManager.terminateSubagent(options.taskId, false);
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

                    if (!options.auto || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
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

                if (action && options.taskId) {
                    subagentManager.updateSubagentAction(options.taskId, action.type, action);
                }

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
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
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
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:', subagentPrefix, undefined, isAuto);
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

                    // Immediate Safety Truncation if the command output is colossally large
                    const safetyLimit = 100000; // Increased to ensure MML is lossless
                    if (encode(resultMsg).length > safetyLimit) {
                        resultMsg = truncateToolOutput(resultMsg, safetyLimit);
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
                                    nextMsg = await waitForInputOrNotification(messageQueue, 'Seu prompt alternativo para o agente:', subagentPrefix, undefined, isAuto);
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
                            if (process.env.SHARK_PARENT_ID) {
                                const mainContent = hasCompleted ? contentStr.split('TASK_COMPLETED:')[0].trim() : contentStr;
                                subagentManager.sendMessage(
                                    process.env.SHARK_PARENT_ID,
                                    `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${options.taskId}) completed.\nResult Details:\n${mainContent}`
                                );
                            }
                            finalSummary = summary;
                            keepGoing = false;
                            break;
                        }

                        if (hasCompleted) {
                            // Print explanation content preceding TASK_COMPLETED
                            const mainContent = contentStr.split('TASK_COMPLETED:')[0].trim();
                            if (mainContent) {
                                log.info(colors.primary('🤖 Shark Dev:'));
                                console.log(mainContent);
                            }

                            finalSummary = contentStr.split('TASK_COMPLETED:')[1].trim();
                            log.success(`✔ Task Completed: ${finalSummary}`);
                            if (!options.auto || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                                let nextMsg: QueueMessage;
                                if (!messageQueue.isEmpty()) {
                                    nextMsg = await messageQueue.next();
                                } else {
                                    nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
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
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
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
                else if (action.type === 'invoke_subagent') {
                    const subagentsToInvoke = action.Subagents || [];
                    log.info(`🚀 Invoking ${subagentsToInvoke.length} subagent(s)`);
                    const parentId = options.taskId || 'parent';
                    const invoked = await subagentManager.invokeSubagents(subagentsToInvoke, parentId, messageQueue);
                    resultMsg = `[Action invoke_subagent Success]: Invoked subagents:\n${invoked.map(s => `- ID: ${s.id}, Type: ${s.TypeName}, Role: ${s.Role}`).join('\n')}`;
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
                        finalSummary = taskSummary;
                        keepGoing = false;
                        break;
                    } else {
                        if (detailedContent) {
                            log.info(colors.primary('🤖 Shark Dev:'));
                            console.log(detailedContent);
                        }
                        
                        log.success(`✔ Task Completed: ${taskSummary}`);
                        
                        if (!options.auto || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                            let nextMsg: QueueMessage;
                            if (!messageQueue.isEmpty()) {
                                nextMsg = await messageQueue.next();
                            } else {
                                nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isAuto);
                            }
                            if (nextMsg.type === 'user') {
                                if (tui.isCancel(nextMsg.content)) {
                                    finalSummary = taskSummary;
                                    keepGoing = false;
                                    break;
                                }
                            }
                            nextPrompt = nextMsg.content;
                            continue;
                        } else {
                            finalSummary = taskSummary;
                            keepGoing = false;
                            break;
                        }
                    }
                }
                else if (action.type === 'wait') {
                    const durationSeconds = action.duration_seconds || 0;
                    const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                    log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);
                    
                    let nextMsg: QueueMessage;
                    if (!messageQueue.isEmpty()) {
                        nextMsg = await messageQueue.next();
                    } else {
                        nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs, isAuto);
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
        activeOnCommandHandler = undefined;
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
