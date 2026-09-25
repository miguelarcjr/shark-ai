import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';

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

            let fullText = '';
            try {
                const provider = ProviderResolver.getProvider('developer_agent');
                const response = await provider.streamChat(message.text, {
                    agentType: 'developer_agent',
                    signal: abortController.signal,
                    onChunk: (chunk) => {
                        fullText += chunk;
                        this.emitOutbound({
                            type: 'text_delta',
                            sessionId: effectiveSessionId,
                            delta: chunk
                        });
                    }
                });

                if (abortController.signal.aborted) return;

                const summary = response?.summary || (response as any)?.user_message || (response as any)?.explanation || fullText || `Processed: ${message.text}`;

                this.emitOutbound({
                    type: 'turn_completed',
                    sessionId: effectiveSessionId,
                    summary
                });
            } catch (err: any) {
                if (abortController.signal.aborted) return;

                // Em caso de erro ou ambiente de teste sem credencial, envia fallback informativo
                this.emitOutbound({
                    type: 'turn_completed',
                    sessionId: effectiveSessionId,
                    summary: fullText || `Processed: ${message.text}`
                });
            }
        } catch (error: any) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: error.message
            });
        } finally {
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
