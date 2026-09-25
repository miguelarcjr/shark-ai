import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import { handleSlashCommand } from './agent-slash-commands.js';
import { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';
import { ToolCatalogSearch } from '../tools/bridge/tool-catalog-search.js';
import { generateTieredManifest } from '../tools/bridge/tiered-disclosure.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { loadSharkRC } from '../config/sharkrc-loader.js';
import { MemoryStore } from '../memory/memory-store.js';
import { skillManager } from '../workflow/skill-manager.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { ContextCompressor } from '../workflow/context-compressor.js';
import { ConfigManager } from '../config-manager.js';
import { ForkReviewAgent } from '../workflow/fork-review-agent.js';
import { buildUnifiedSystemPrompt } from '../api/prompts.js';
import { MessageQueue, type QueueMessage } from '../workflow/message-queue.js';
import { promptUser, waitForInputOrNotification, formatRoleForUI } from '../workflow/interactive-prompt.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { cleanupAgentTools } from '../agents/agent-tools.js';

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
    projectRoot?: string;
    bridgeToolsManager?: BridgeToolsManager;
    taskId?: string;
    context?: string;
}

export interface EngineRunOptions {
    taskInstruction?: string;
    taskId?: string;
    context?: string;
    history?: string;
    auto?: boolean;
    messageQueue?: MessageQueue;
    sessionId?: string;
}

export interface DevelopmentResult {
    success: boolean;
    summary: string;
}

function isUserCancellation(content: any): boolean {
    return tui.isCancel(content) || !content || content === 'cancel';
}

export class AgentEngine {
    public readonly sessionId: string;
    public projectRoot: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAborted: boolean = false;
    private abortReason?: string;
    private isAuto: boolean;
    private bridgeToolsManager?: BridgeToolsManager;
    private taskId?: string;
    private contextPath?: string;
    private forkReviewAgents = new Map<string, ForkReviewAgent>();

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.projectRoot = options.projectRoot || process.cwd();
        this.isAuto = options.auto === true;
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
        this.bridgeToolsManager = options.bridgeToolsManager;
        this.taskId = options.taskId;
        this.contextPath = options.context;
    }

    public attachAdapter(adapter: AgentChannelAdapter) {
        this.adapter = adapter;
        this.adapter.onInbound(async (event) => {
            const isTargetSession = !this.sessionId || this.sessionId === '*' || event.sessionId === this.sessionId;
            if (event.type === 'abort_command' && isTargetSession) {
                this.abortCurrentTurn(event.reason);
                return;
            }
            if (event.type === 'action_approval_response') {
                this.handleApprovalResponse(event);
                return;
            }
            if (event.type === 'user_message' && isTargetSession) {
                await this.processMessage(event);
            }
        });
    }

    public abortCurrentTurn(reason: string = 'Interrupted by user') {
        this.isAborted = true;
        this.abortReason = reason;
        if (this.currentTurnAbort) {
            this.currentTurnAbort.abort(reason);
            this.currentTurnAbort = undefined;
        }
        this.emitOutbound({
            type: 'turn_interrupted',
            sessionId: this.sessionId,
            reason
        });
    }

    public emitOutbound(event: AgentOutboundEvent) {
        this.adapter?.emit(event);
    }

    public async runInteractive(options: EngineRunOptions = {}): Promise<DevelopmentResult> {
        const abortController = new AbortController();
        this.currentTurnAbort = abortController;
        if (this.isAborted) {
            abortController.abort(this.abortReason || 'Interrupted by user');
            return { success: false, summary: this.abortReason || 'Interrupted by user' };
        }

        const isBatchMode = options.auto === true || process.argv.includes('--auto');
        let autoApproveTools = isBatchMode;
        const effectiveTaskId = options.taskId || this.taskId;
        const isSubagent = !!effectiveTaskId && (effectiveTaskId.startsWith('subagent-') || subagentManager.hasSubagent(effectiveTaskId));
        const projectRoot = this.projectRoot || process.cwd();
        const messageQueue = options.messageQueue || new MessageQueue();

        const spinner = tui.spinner();

        // 1. Inicializa subsistemas
        const rcConfig = loadSharkRC() || {};
        const mcpServers = process.env.VITEST && !process.env.SHARK_TEST_MCP ? {} : ((rcConfig as any)?.mcpServers || {});
        const mcpManager = new McpManager();
        const mcpTools = await mcpManager.initialize(mcpServers);
        const toolCatalog = new ToolCatalogSearch(mcpTools);
        const bridgeTools = this.bridgeToolsManager || new BridgeToolsManager(
            toolCatalog,
            (name, args) => mcpManager.executeTool(name, args),
            mcpTools
        );
        this.bridgeToolsManager = bridgeTools;

        const mcpManifest = mcpTools.length > 0 ? generateTieredManifest(mcpTools).manifestText : undefined;
        const memoryStore = new MemoryStore();
        let memorySnapshot = await memoryStore.loadSnapshot();
        const skillsMetadata = await skillManager.getAvailableSkillsMetadata();
        const skillsIndex = skillManager.formatSkillsIndex(skillsMetadata);
        let dynamicSystemPrompt = buildUnifiedSystemPrompt({
            snapshot: memorySnapshot,
            toolsCatalog: mcpManifest,
            skillsIndex: skillsIndex || undefined
        });

        const effectiveSessionId = options.sessionId || this.sessionId || 'default';
        const conversationKey = effectiveTaskId
            ? `dev_agent_${effectiveTaskId}`
            : (effectiveSessionId && effectiveSessionId !== '*' ? `session_${effectiveSessionId}` : `dev_agent_${Date.now()}`);
        let activeConversationId = await conversationManager.getConversationId(conversationKey);

        const activeProvider = ProviderResolver.getProvider('developer_agent');
        let forkReviewAgent = this.forkReviewAgents.get(effectiveSessionId);
        if (!forkReviewAgent) {
            forkReviewAgent = new ForkReviewAgent({
                memoryStore,
                skillManager,
                provider: activeProvider,
                onNotification: (msg) => {
                    tui.log.info(colors.dim(msg));
                    this.emitOutbound({
                        type: 'turn_completed',
                        sessionId: effectiveSessionId,
                        summary: msg
                    });
                }
            });
            this.forkReviewAgents.set(effectiveSessionId, forkReviewAgent);
        }

        const onSlashCommand = async (cmd: string): Promise<boolean> => {
            const res = await handleSlashCommand(cmd, {
                projectRoot,
                activeConversationId,
                conversationKey,
                forkReviewAgent,
                skillManager,
                autoApproveTools,
                onLog: (type, msg) => {
                    if (type === 'warning') tui.log.warning(msg);
                    else if (type === 'error') tui.log.error(msg);
                    else if (type === 'success') tui.log.success(msg);
                    else tui.log.info(msg);
                },
                onPromptSelect: async (opts) => {
                    const sel = await tui.select(opts);
                    return tui.isCancel(sel) ? null : (sel as string);
                }
            });
            if (res.autoApproveTools !== undefined) {
                autoApproveTools = res.autoApproveTools;
            }
            if (res.activeConversationId) {
                activeConversationId = res.activeConversationId;
            }
            return res.handled;
        };

        // Carrega instrução inicial da tarefa
        let currentPrompt = options.taskInstruction;
        if (!currentPrompt) {
            if (isSubagent) {
                currentPrompt = 'Subagent Task';
            } else {
                const userTask = await promptUser(
                    'O que você gostaria que o Shark Dev fizesse?',
                    undefined,
                    'ex: crie uma API REST simples ou digite /skills para ativar diretrizes',
                    '',
                    onSlashCommand
                );
                if (isUserCancellation(userTask)) {
                    return { success: false, summary: 'Task execution cancelled.' };
                }
                forkReviewAgent.onUserTurn();
                currentPrompt = userTask;
            }
        } else {
            if (currentPrompt.startsWith('/')) {
                const handled = await onSlashCommand(currentPrompt);
                if (handled) {
                    if (forkReviewAgent.currentReviewPromise) {
                        await forkReviewAgent.currentReviewPromise.catch(() => {});
                    }
                    return { success: true, summary: `Command ${currentPrompt} executed.` };
                }
            }
            if (!isSubagent) {
                forkReviewAgent.onUserTurn();
            }
        }

        let subagentPrefix = '';
        if (effectiveTaskId) {
            const subState = subagentManager.getSubagentState(effectiveTaskId);
            if (subState) {
                subagentPrefix = `[Subagent: ${formatRoleForUI(subState.role)}] `;
            }
        }

        const log = {
            info: (msg: string) => tui.log.info(`${subagentPrefix}${msg}`),
            warning: (msg: string) => tui.log.warning(`${subagentPrefix}${msg}`),
            error: (msg: string) => tui.log.error(`${subagentPrefix}${msg}`),
            success: (msg: string) => tui.log.success(`${subagentPrefix}${msg}`),
        };

        // Context file
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
        let basePrompt = '';
        if (contextContent) {
            basePrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
        }
        if (options.history) {
            basePrompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
        }
        basePrompt += `\n\n🟢 EXECUTION MODE\n
You are a highly skilled Developer Agent.
👉 **CURRENT TASK**: "${currentPrompt}"

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
        currentPrompt = basePrompt;

        const actionExecutor = new AgentActionExecutor({
            projectRoot,
            sessionId: this.sessionId,
            autoApprove: autoApproveTools,
            emitOutbound: (ev) => this.emitOutbound(ev),
            requestApproval: async (toolName, toolArgs, fallbackText) => {
                if (autoApproveTools) return true;
                const approved = await tui.confirm({ message: fallbackText });
                return !!approved;
            },
            bridgeToolsManager: this.bridgeToolsManager,
            memoryStore,
            onMemoryUpdated: async () => {
                memorySnapshot = await memoryStore.loadSnapshot();
                dynamicSystemPrompt = buildUnifiedSystemPrompt({
                    snapshot: memorySnapshot,
                    toolsCatalog: mcpManifest,
                    skillsIndex: skillsIndex || undefined
                });
            },
            activeConversationId,
            currentTaskId: effectiveTaskId,
            messageQueue
        });

        const handleCleanupSignal = (exitCode: number) => {
            const currentId = effectiveTaskId || 'parent';
            const myActiveSubagents = subagentManager.getActiveSubagentsForParent(currentId);
            if (myActiveSubagents.length > 0) {
                log.info(`🧹 Terminating ${myActiveSubagents.length} active child subagent(s) before exit...`);
                for (const sub of myActiveSubagents) {
                    subagentManager.killSubagent(sub.id);
                }
            }
            process.exit(exitCode);
        };
        const sigIntHandler = () => handleCleanupSignal(130);
        const sigTermHandler = () => handleCleanupSignal(143);

        process.on('SIGINT', sigIntHandler);
        process.on('SIGTERM', sigTermHandler);

        let keepGoing = true;
        let finalSummary = '';
        let userDraftBuffer = '';
        const myId = effectiveTaskId || 'parent';

        try {
            while (keepGoing) {
                if (abortController.signal.aborted) {
                    keepGoing = false;
                    return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
                }

                // Subagent mailbox check
                const recipientId = effectiveTaskId || 'parent';
                const diskMessages = subagentManager.retrieveMessages(recipientId);
                const queuedMessages: string[] = [];
                while (!messageQueue.isEmpty()) {
                    const qMsg = await messageQueue.next();
                    if (qMsg && qMsg.content) {
                        queuedMessages.push(qMsg.content);
                    }
                }

                const formatNotification = (msg: any): string => {
                    const text = typeof msg === 'object' && msg.message ? msg.message : String(msg);
                    if (text.startsWith('<subagent_notification')) return text;
                    let status = 'completed';
                    if (text.includes('FAILED') || text.includes('failed')) status = 'failed';
                    if (text.includes('CANCELLED') || text.includes('cancelled')) status = 'cancelled';
                    return `<subagent_notification status="${status}">\n${text}\n</subagent_notification>`;
                };

                const allIncomingMessages = [
                    ...diskMessages.map(formatNotification),
                    ...queuedMessages.map(formatNotification)
                ];

                let currentTurnPrompt = currentPrompt;
                if (allIncomingMessages.length > 0) {
                    currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${allIncomingMessages.join('\n\n')}\n`;
                }

                // Painel de subagentes ativos
                const activeSubs = subagentManager.getActiveSubagentsForParent(myId);
                if (activeSubs.length > 0) {
                    let panel = `\n--- ACTIVE SUBAGENTS ---\n`;
                    panel += `You have spawned the following subagents that are currently working in parallel:\n`;
                    for (const sub of activeSubs) {
                        panel += `- ID: ${sub.id} | Role: ${sub.role} | Status: ${sub.status}${sub.summary ? ` | Last Status: ${sub.summary}` : ''}\n`;
                    }
                    panel += `Use the 'wait' action if you have no other work and are waiting for these subagents to complete.\n`;
                    panel += `--------------------------------\n`;
                    currentTurnPrompt += panel;
                }

                const activeCount = subagentManager.getActiveSubagents().length;
                const spinnerText = activeCount > 0
                    ? `🦈 Shark Dev working... (Active subagents: ${activeCount})`
                    : '🦈 Shark Dev working...';
                spinner.start(spinnerText);

                // Compressão com Tail Protection
                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    const config = ConfigManager.getInstance().getConfig();
                    const compactionTokenLimit = config.memory?.compactionTokenLimit ?? 120000;
                    const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                        tokenLimit: compactionTokenLimit,
                        thresholdRatio: 0.8,
                        tailSize: 15
                    });
                    if (wasCompressed) {
                        await HistoryManager.saveRawHistory(activeConversationId, compressedHistory);
                    }
                }

                let response: any;
                try {
                    response = await activeProvider.streamChat(currentTurnPrompt, {
                        conversationId: activeConversationId,
                        agentType: 'developer_agent',
                        searchQuery: currentPrompt,
                        systemPrompt: dynamicSystemPrompt,
                        hasMcpServers: mcpTools.length > 0,
                        signal: abortController.signal,
                        onChunk: () => {}
                    });
                } catch (e: any) {
                    spinner.stop('Interrupted');
                    if (e.name === 'AbortError' || abortController.signal.aborted) {
                        log.warning('Interrupção solicitada via Esc. Retornando ao prompt...');
                        if (activeConversationId) {
                            await HistoryManager.saveRawHistory(activeConversationId, [
                                ...(await HistoryManager.getRawHistory(activeConversationId)),
                                { role: 'user', content: '[Execução interrompida pelo usuário via Esc. A ação anterior foi cancelada antes de sua conclusão.]' }
                            ]);
                        }
                        if (isBatchMode) {
                            return { success: false, summary: 'Interrupted by user' };
                        }
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        currentPrompt = nextMsg.content;
                        continue;
                    }
                    throw e;
                }

                spinner.stop('Response received');

                if (abortController.signal.aborted) {
                    keepGoing = false;
                    return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
                }

                if (response?.conversation_id) {
                    activeConversationId = response.conversation_id;
                    await conversationManager.saveConversationId(conversationKey, response.conversation_id);
                }

                if (response?.summary && effectiveTaskId) {
                    subagentManager.updateSubagentSummary(effectiveTaskId, response.summary);
                }

                // TASK_COMPLETED
                if (response?.message && response.message.includes('TASK_COMPLETED:') && !isSubagent) {
                    const mainContent = response.message.split('TASK_COMPLETED:')[0].trim();
                    if (mainContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(mainContent);
                    }

                    finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                    log.success(`✔ Task Completed: ${finalSummary}`);

                    if (effectiveTaskId) {
                        subagentManager.updateSubagentSummary(effectiveTaskId, finalSummary);
                        subagentManager.terminateSubagent(effectiveTaskId, true);
                        if (process.env.SHARK_PARENT_ID) {
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${effectiveTaskId}) completed.\nResult Details:\n${mainContent || finalSummary}`
                            );
                        }
                        keepGoing = false;
                        break;
                    }

                    if (activeConversationId) {
                        const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                        void forkReviewAgent.maybeTriggerReview(rawHistory);
                    }

                    if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        let nextMsg: QueueMessage;
                        if (!messageQueue.isEmpty()) {
                            nextMsg = await messageQueue.next();
                        } else {
                            nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                            userDraftBuffer = (nextMsg as any).draft || '';
                        }
                        if (nextMsg.type === 'user') {
                            forkReviewAgent.onUserTurn();
                            if (isUserCancellation(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                        }
                        currentPrompt = nextMsg.content;
                        continue;
                    } else {
                        keepGoing = false;
                        break;
                    }
                }

                // TASK_FAILED
                if (response?.message && response.message.includes('TASK_FAILED:')) {
                    const failReason = response.message.split('TASK_FAILED:')[1].trim();
                    log.error(`❌ Agent reported task failure: ${failReason}`);
                    if (effectiveTaskId) {
                        subagentManager.terminateSubagent(effectiveTaskId, false);
                        if (process.env.SHARK_PARENT_ID) {
                            const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: FAILED. Summary: ${failReason}`
                            );
                        }
                        return { success: false, summary: failReason };
                    }
                    if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                            return { success: false, summary: failReason };
                        }
                        currentPrompt = nextMsg.content;
                        continue;
                    } else {
                        return { success: false, summary: failReason };
                    }
                }

                const action = response?.action;
                if (!action) {
                    if (isSubagent) {
                        const summary = 'No action returned by the subagent.';
                        log.warning(summary);
                        subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                        subagentManager.terminateSubagent(effectiveTaskId!, false);
                        if (process.env.SHARK_PARENT_ID) {
                            const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: No action returned in response.`
                            );
                        }
                        return { success: false, summary };
                    }

                    if (response?.message) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(response.message);
                        if (activeConversationId) {
                            const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                            void forkReviewAgent.maybeTriggerReview(rawHistory);
                        }
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode);
                        if (nextMsg.type === 'user') {
                            forkReviewAgent.onUserTurn();
                            if (isUserCancellation(nextMsg.content)) {
                                keepGoing = false;
                                break;
                            }
                        }
                        currentPrompt = nextMsg.content;
                    } else {
                        log.warning('No action or message returned by the agent.');
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:', subagentPrefix, undefined, isBatchMode);
                        if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                            return { success: true, summary: 'Task completed without summary.' };
                        }
                        currentPrompt = nextMsg.content;
                    }
                    continue;
                }

                forkReviewAgent.onToolIteration();
                if (effectiveTaskId) {
                    subagentManager.updateSubagentAction(effectiveTaskId, action.type, action);
                }

                // complete_task action
                if (action.type === 'complete_task') {
                    const taskSummary = action.args?.summary || action.summary || response.summary || 'Task completed successfully.';
                    const detailedContent = action.args?.content || action.content || '';

                    if (activeConversationId) {
                        const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                        void forkReviewAgent.maybeTriggerReview(rawHistory);
                    }

                    if (isSubagent) {
                        subagentManager.updateSubagentSummary(effectiveTaskId!, taskSummary);
                        subagentManager.terminateSubagent(effectiveTaskId!, true);
                        if (process.env.SHARK_PARENT_ID) {
                            const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) completed.\nResult Details:\n${detailedContent}`
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
                        if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                            const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                            userDraftBuffer = (nextMsg as any).draft || '';
                            if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                                finalSummary = taskSummary;
                                keepGoing = false;
                                break;
                            }
                            currentPrompt = nextMsg.content;
                            continue;
                        } else {
                            finalSummary = taskSummary;
                            keepGoing = false;
                            break;
                        }
                    }
                }

                // wait action
                if (action.type === 'wait') {
                    const durationSeconds = action.args?.duration_seconds ?? action.duration_seconds ?? 0;
                    const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                    log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);

                    let nextMsg: QueueMessage;
                    if (!messageQueue.isEmpty()) {
                        nextMsg = await messageQueue.next();
                    } else {
                        nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs, isBatchMode, userDraftBuffer);
                        userDraftBuffer = (nextMsg as any).draft || '';
                    }

                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                        currentPrompt = nextMsg.content;
                    } else if (nextMsg.type === 'subagent_notification') {
                        currentPrompt = `[Subagent Notification Received]:\n${nextMsg.content}`;
                    } else if (nextMsg.type === 'timeout') {
                        currentPrompt = `[System]: Wait duration of ${durationSeconds} seconds expired. No notifications received.`;
                    }
                    continue;
                }

                // talk_with_user action
                if (action.type === 'talk_with_user') {
                    const talkContent = action.content || action.args?.content || action.message || action.args?.message || '';
                    const isSystemError = typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]');
                    if (isSystemError) {
                        if (isSubagent) {
                            currentPrompt = talkContent;
                            continue;
                        } else {
                            currentPrompt = talkContent;
                        }
                    } else {
                        if (isSubagent) {
                            const summary = `Subagent returned invalid response format or tried to talk with user. Content: ${talkContent}`;
                            subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                            subagentManager.terminateSubagent(effectiveTaskId!, false);
                            if (process.env.SHARK_PARENT_ID) {
                                const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                                subagentManager.sendMessage(
                                    process.env.SHARK_PARENT_ID,
                                    `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: Returned raw text or unsupported action instead of valid JSON.`
                                );
                            }
                            return { success: false, summary };
                        }

                        if (talkContent) {
                            log.info(colors.primary('🤖 Shark Dev:'));
                            console.log(talkContent);
                        }

                        if (activeConversationId) {
                            const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                            void forkReviewAgent.maybeTriggerReview(rawHistory);
                        }

                        if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                            const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                            userDraftBuffer = (nextMsg as any).draft || '';
                            if (nextMsg.type === 'user') {
                                forkReviewAgent.onUserTurn();
                                if (isUserCancellation(nextMsg.content)) {
                                    finalSummary = talkContent;
                                    keepGoing = false;
                                    break;
                                }
                            }
                            currentPrompt = nextMsg.content;
                            continue;
                        } else {
                            finalSummary = talkContent;
                            keepGoing = false;
                            break;
                        }
                    }
                    continue;
                }

                // Executa as demais ferramentas pelo ActionExecutor
                const actionResult = await actionExecutor.executeAction(action);
                currentPrompt = actionResult.output;
            }

            // Encerra subagentes filhos do pai ao sair
            const activeSubs = subagentManager.getActiveSubagentsForParent(myId);
            for (const sub of activeSubs) {
                subagentManager.killSubagent(sub.id);
            }

            if (forkReviewAgent.currentReviewPromise) {
                await forkReviewAgent.currentReviewPromise.catch(() => {});
            }

            const finalResult = {
                success: true,
                summary: finalSummary || 'Task completed without summary.'
            };

            if (effectiveTaskId && process.env.SHARK_PARENT_ID) {
                subagentManager.terminateSubagent(effectiveTaskId, true);
                const parentId = process.env.SHARK_PARENT_ID;
                const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                subagentManager.sendMessage(
                    parentId,
                    `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: COMPLETED. Summary: ${finalResult.summary}`
                );
            }

            log.success('✅ Task Scope Completed');
            return finalResult;
        } finally {
            cleanupAgentTools();
            await mcpManager.closeAll();
            process.off('SIGINT', sigIntHandler);
            process.off('SIGTERM', sigTermHandler);
            if (this.currentTurnAbort === abortController) {
                this.currentTurnAbort = undefined;
            }
        }
    }

    public async processMessage(message: InboundUserMessage): Promise<void> {
        const effectiveSessionId = message.sessionId || this.sessionId;
        const holderId = randomUUID();
        const acquired = this.leaseManager.acquireLease(effectiveSessionId, holderId);
        if (!acquired) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: 'Session is busy with another active turn'
            });
            return;
        }

        this.isAborted = false;
        this.abortReason = undefined;

        const originalCwd = process.cwd();
        try {
            if (this.projectRoot && this.projectRoot !== originalCwd) {
                try {
                    process.chdir(this.projectRoot);
                } catch {}
            }

            this.emitOutbound({
                type: 'presence_status',
                sessionId: effectiveSessionId,
                status: 'typing',
                emojiReaction: '👀'
            });

            const result = await this.runInteractive({
                taskInstruction: message.text,
                auto: true,
                sessionId: effectiveSessionId
            });

            if (!result.success && (result.summary.includes('Interrupted') || result.summary.includes('cancelled') || result.summary.includes('user_cancelled'))) {
                return;
            }

            this.emitOutbound({
                type: 'turn_completed',
                sessionId: effectiveSessionId,
                summary: result.summary
            });
        } catch (error: any) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: error.message
            });
        } finally {
            this.isAborted = false;
            this.abortReason = undefined;
            if (process.cwd() !== originalCwd) {
                try {
                    process.chdir(originalCwd);
                } catch {}
            }
            this.leaseManager.releaseLease(effectiveSessionId, holderId);
        }
    }

    private handleApprovalResponse(event: any) {
        this.approvalsManager.resolveApproval(event.approvalId, event.decision);
    }

    public getApprovalsManager(): PendingApprovalsManager {
        return this.approvalsManager;
    }

    public getLeaseManager(): SessionLeaseManager {
        return this.leaseManager;
    }
}
