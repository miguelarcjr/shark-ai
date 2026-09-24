import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
}

export class AgentEngine {
    public readonly sessionId: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAuto: boolean;

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.isAuto = options.auto === true;
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
    }

    public attachAdapter(adapter: AgentChannelAdapter) {
        this.adapter = adapter;
        this.adapter.onInbound(async (event) => {
            if (event.type === 'abort_command' && event.sessionId === this.sessionId) {
                this.abortCurrentTurn(event.reason);
                return;
            }
            if (event.type === 'action_approval_response') {
                this.handleApprovalResponse(event);
                return;
            }
            if (event.type === 'user_message' && event.sessionId === this.sessionId) {
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
        const holderId = randomUUID();
        const acquired = this.leaseManager.acquireLease(this.sessionId, holderId);
        if (!acquired) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason: 'Session is busy with another active turn'
            });
            return;
        }

        const abortController = new AbortController();
        this.currentTurnAbort = abortController;

        this.emitOutbound({
            type: 'presence_status',
            sessionId: this.sessionId,
            status: 'typing',
            emojiReaction: '👀'
        });

        try {
            if (abortController.signal.aborted) {
                return;
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

            // Ponto de integração do ciclo de raciocínio da LLM
            this.emitOutbound({
                type: 'turn_completed',
                sessionId: this.sessionId,
                summary: `Processed: ${message.text}`
            });
        } catch (error: any) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason: error.message
            });
        } finally {
            this.leaseManager.releaseLease(this.sessionId, holderId);
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
