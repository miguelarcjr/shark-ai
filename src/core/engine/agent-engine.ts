import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
    projectRoot?: string;
    bridgeToolsManager?: BridgeToolsManager;
}

export class AgentEngine {
    public readonly sessionId: string;
    public projectRoot: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAuto: boolean;
    private bridgeToolsManager?: BridgeToolsManager;
    private activeConversationId?: string;

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.projectRoot = options.projectRoot || process.cwd();
        this.isAuto = options.auto === true;
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
        this.bridgeToolsManager = options.bridgeToolsManager;
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
        if (this.currentTurnAbort) {
            this.currentTurnAbort.abort(reason);
            this.currentTurnAbort = undefined;
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason
            });
        }
    }

    public emitOutbound(event: AgentOutboundEvent) {
        this.adapter?.emit(event);
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

        const abortController = new AbortController();
        this.currentTurnAbort = abortController;

        this.emitOutbound({
            type: 'presence_status',
            sessionId: effectiveSessionId,
            status: 'typing',
            emojiReaction: '👀'
        });

        const originalCwd = process.cwd();
        try {
            if (abortController.signal.aborted) {
                return;
            }

            if (this.projectRoot && this.projectRoot !== originalCwd) {
                try {
                    process.chdir(this.projectRoot);
                } catch (e: any) {
                    console.error(`Falha ao mudar para projectRoot ${this.projectRoot}:`, e.message);
                }
            }

            const actionExecutor = new AgentActionExecutor({
                projectRoot: this.projectRoot,
                sessionId: effectiveSessionId,
                autoApprove: this.isAuto,
                emitOutbound: (ev) => this.emitOutbound(ev),
                requestApproval: async (toolName, toolArgs) => {
                    const approval = this.approvalsManager.createApproval({
                        sessionId: effectiveSessionId,
                        checkpointMessageId: `msg_${Date.now()}`,
                        toolName,
                        toolArgs,
                        ttlMs: 300000
                    });

                    this.emitOutbound({
                        type: 'action_approval_request',
                        sessionId: effectiveSessionId,
                        approvalId: approval.id,
                        toolName,
                        toolArgs,
                        riskLevel: 'medium',
                        ttlMs: 300000,
                        fallbackText: `Aprovar execução de ${toolName}?`
                    });

                    // Em modo não interativo ou com adapter, espera resposta
                    return false;
                },
                bridgeToolsManager: this.bridgeToolsManager
            });

            const provider = ProviderResolver.getProvider('developer_agent');
            let nextPrompt: string = message.text;
            let keepGoing = true;
            let iterations = 0;
            const maxIterations = 25;
            let finalSummary = '';

            while (keepGoing && iterations < maxIterations) {
                iterations++;

                if (abortController.signal.aborted) {
                    return;
                }

                const response = await provider.streamChat(nextPrompt, {
                    conversationId: this.activeConversationId,
                    agentType: 'developer_agent',
                    signal: abortController.signal,
                    onChunk: (chunk: string) => {
                        this.emitOutbound({
                            type: 'text_delta',
                            sessionId: effectiveSessionId,
                            delta: chunk
                        });
                    }
                });

                if (abortController.signal.aborted) {
                    return;
                }

                if (response.conversation_id) {
                    this.activeConversationId = response.conversation_id;
                }

                // Tarefa completada explicitamente
                if (response.message && response.message.includes('TASK_COMPLETED:')) {
                    finalSummary = response.message.split('TASK_COMPLETED:')[1]?.trim() || response.summary || 'Tarefa concluída com sucesso.';
                    keepGoing = false;
                    break;
                }

                // Tarefa falhou
                if (response.message && response.message.includes('TASK_FAILED:')) {
                    const failureReason = response.message.split('TASK_FAILED:')[1]?.trim() || 'A tarefa falhou.';
                    this.emitOutbound({
                        type: 'turn_interrupted',
                        sessionId: effectiveSessionId,
                        reason: failureReason
                    });
                    keepGoing = false;
                    return;
                }

                // Execução de ação / ferramenta
                if (response.action) {
                    const actionResult = await actionExecutor.executeAction(response.action);
                    nextPrompt = actionResult.output;
                    continue;
                }

                // Resposta conversacional direta sem ação
                if (response.message) {
                    finalSummary = response.message;
                    keepGoing = false;
                    break;
                }

                if (response.summary) {
                    finalSummary = response.summary;
                    keepGoing = false;
                    break;
                }

                keepGoing = false;
            }

            if (abortController.signal.aborted) {
                return;
            }

            this.emitOutbound({
                type: 'turn_completed',
                sessionId: effectiveSessionId,
                summary: finalSummary || `Tarefa finalizada.`
            });

        } catch (error: any) {
            if (abortController.signal.aborted) {
                return;
            }
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: error.message
            });
        } finally {
            if (process.cwd() !== originalCwd) {
                try {
                    process.chdir(originalCwd);
                } catch {}
            }
            this.leaseManager.releaseLease(effectiveSessionId, holderId);
            if (this.currentTurnAbort === abortController) {
                this.currentTurnAbort = undefined;
            }
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
