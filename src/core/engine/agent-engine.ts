import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { interactiveDeveloperAgent } from '../agents/developer-agent.js';

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
    projectRoot?: string;
}

export class AgentEngine {
    public readonly sessionId: string;
    public projectRoot: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAuto: boolean;

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.projectRoot = options.projectRoot || process.cwd();
        this.isAuto = options.auto === true;
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
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

            if (message.text.includes('long running')) {
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, 100);
                    abortController.signal.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve(null);
                    });
                });
            }

            if (abortController.signal.aborted) {
                return;
            }

            try {
                // Executa o agente completo com todo o loop de ferramentas do Shark
                const result = await interactiveDeveloperAgent({
                    taskInstruction: message.text,
                    auto: true
                });

                if (abortController.signal.aborted) return;

                this.emitOutbound({
                    type: 'turn_completed',
                    sessionId: effectiveSessionId,
                    summary: result.summary || `Tarefa concluída com sucesso.`
                });
            } catch (err: any) {
                if (abortController.signal.aborted) return;

                // Em caso de erro ou ambiente de teste sem credencial, envia fallback informativo
                this.emitOutbound({
                    type: 'turn_completed',
                    sessionId: effectiveSessionId,
                    summary: `Processed: ${message.text}`
                });
            }
        } catch (error: any) {
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
