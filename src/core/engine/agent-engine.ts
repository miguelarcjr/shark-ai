import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import { handleSlashCommand } from './agent-slash-commands.js';
import { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';
import { MessageQueue } from '../workflow/message-queue.js';
import { promptUser, formatRoleForUI } from '../workflow/interactive-prompt.js';
import { ForkReviewAgent } from '../workflow/fork-review-agent.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { cleanupAgentTools } from '../agents/agent-tools.js';
import { tui } from '../../ui/tui.js';
import { EngineContextBuilder } from './engine-context-builder.js';
import { TurnLoopRunner, type DevelopmentResult } from './turn-loop-runner.js';
import { setupProcessCleanup, terminateChildSubagents } from './subagent-sync.js';

export { DevelopmentResult };

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

function isUserCancellation(content: any): boolean {
    return tui.isCancel(content) || !content || content === 'cancel';
}

export class AgentEngine {
    public readonly sessionId: string;
    public projectRoot: string;
    private adapters: AgentChannelAdapter[] = [];
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAborted: boolean = false;
    private abortReason?: string;
    private bridgeToolsManager?: BridgeToolsManager;
    private taskId?: string;
    private contextPath?: string;
    private forkReviewAgents = new Map<string, ForkReviewAgent>();

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.projectRoot = options.projectRoot || process.cwd();
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
        this.bridgeToolsManager = options.bridgeToolsManager;
        this.taskId = options.taskId;
        this.contextPath = options.context;
    }

    public attachAdapter(adapter: AgentChannelAdapter) {
        this.adapters.push(adapter);
        adapter.onInbound(async (event) => {
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
        for (const adapter of this.adapters) {
            adapter.emit(event);
        }
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
        const effectiveSessionId = options.sessionId || this.sessionId || 'default';
        const projectRoot = this.projectRoot || process.cwd();
        const messageQueue = options.messageQueue || new MessageQueue();
        const myId = effectiveTaskId || 'parent';

        // 1. Prepara contexto e subsistemas via EngineContextBuilder
        let forkReviewAgent = this.forkReviewAgents.get(effectiveSessionId);
        const context = await EngineContextBuilder.prepare({
            projectRoot,
            sessionId: effectiveSessionId,
            taskId: effectiveTaskId,
            context: options.context || this.contextPath,
            history: options.history,
            taskInstruction: options.taskInstruction,
            bridgeToolsManager: this.bridgeToolsManager,
            autoApproveTools,
            emitOutbound: (ev) => this.emitOutbound(ev),
            forkReviewAgent
        });

        if (!forkReviewAgent) {
            this.forkReviewAgents.set(effectiveSessionId, context.forkReviewAgent);
            forkReviewAgent = context.forkReviewAgent;
        }
        this.bridgeToolsManager = context.bridgeTools;

        // 2. Slash command handler
        let activeConversationId = context.activeConversationId;
        const onSlashCommand = async (cmd: string): Promise<boolean> => {
            const res = await handleSlashCommand(cmd, {
                projectRoot,
                activeConversationId,
                conversationKey: context.conversationKey,
                forkReviewAgent,
                skillManager: (context.forkReviewAgent as any).skillManager,
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
            if (res.autoApproveTools !== undefined) autoApproveTools = res.autoApproveTools;
            if (res.activeConversationId) activeConversationId = res.activeConversationId;
            return res.handled;
        };

        // 3. Prompt inicial interativo caso não fornecido
        let initialInstruction = options.taskInstruction;
        if (!initialInstruction) {
            if (isSubagent) {
                initialInstruction = 'Subagent Task';
                context.setTaskInstruction(initialInstruction);
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
                initialInstruction = userTask;
                context.setTaskInstruction(initialInstruction);
            }
        } else {
            if (initialInstruction.startsWith('/')) {
                const handled = await onSlashCommand(initialInstruction);
                if (handled) {
                    if (forkReviewAgent.currentReviewPromise) {
                        await forkReviewAgent.currentReviewPromise.catch(() => {});
                    }
                    return { success: true, summary: `Command ${initialInstruction} executed.` };
                }
            }
            if (!isSubagent) {
                forkReviewAgent.onUserTurn();
            }
        }

        // 4. Action Executor
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
            memoryStore: context.memoryStore,
            onMemoryUpdated: () => context.updateDynamicPrompt(),
            activeConversationId,
            currentTaskId: effectiveTaskId,
            messageQueue
        });

        // 5. Configuração de encerramento seguro de processos
        const processCleanup = setupProcessCleanup(myId, tui.log);

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

        try {
            const result = await TurnLoopRunner.run({
                sessionId: effectiveSessionId,
                projectRoot,
                taskId: effectiveTaskId,
                isBatchMode,
                messageQueue,
                abortController,
                actionExecutor,
                context
            });

            terminateChildSubagents(myId);

            if (forkReviewAgent.currentReviewPromise) {
                await forkReviewAgent.currentReviewPromise.catch(() => {});
            }

            if (effectiveTaskId && process.env.SHARK_PARENT_ID) {
                subagentManager.terminateSubagent(effectiveTaskId, true);
                const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                subagentManager.sendMessage(
                    process.env.SHARK_PARENT_ID,
                    `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: COMPLETED. Summary: ${result.summary}`
                );
            }

            log.success('✅ Task Scope Completed');
            return result;
        } finally {
            cleanupAgentTools();
            await context.mcpManager.closeAll();
            processCleanup.dispose();
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
