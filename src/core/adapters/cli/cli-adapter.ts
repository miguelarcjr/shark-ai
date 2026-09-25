import type { AgentChannelAdapter } from '../adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from '../../engine/events.js';
import { tui } from '../../../ui/tui.js';
import { colors } from '../../../ui/colors.js';

export interface CliAdapterOptions {
    auto?: boolean;
}

export class CliAdapter implements AgentChannelAdapter {
    readonly channelId = 'cli';
    private inboundHandler?: (event: AgentInboundEvent) => Promise<void>;
    private isAuto: boolean;

    constructor(options: CliAdapterOptions = {}) {
        this.isAuto = options.auto === true;
    }

    public onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void {
        this.inboundHandler = handler;
    }

    public async dispatchUserText(text: string, sessionId: string = 'cli:local') {
        if (!this.inboundHandler) return;
        await this.inboundHandler({
            type: 'user_message',
            sessionId,
            text,
            role: 'user',
            origin: { channelId: 'cli', senderId: 'local' }
        });
    }

    public emit(event: AgentOutboundEvent): void {
        switch (event.type) {
            case 'text_delta':
                process.stdout.write(event.delta);
                break;
            case 'reasoning_delta':
                process.stdout.write(colors.dim(event.delta));
                break;
            case 'tool_progress':
                if (event.status === 'starting' || event.status === 'running') {
                    tui.log.info(colors.primary(`⚙️ [${event.toolName}] ${event.details || 'executando...'}`));
                } else if (event.status === 'completed') {
                    tui.log.success(colors.success(`✅ [${event.toolName}] concluído`));
                } else if (event.status === 'failed') {
                    tui.log.error(colors.error(`❌ [${event.toolName}] falhou: ${event.error || event.details || ''}`));
                }
                break;
            case 'action_approval_request':
                if (this.isAuto) {
                    this.inboundHandler?.({
                        type: 'action_approval_response',
                        sessionId: event.sessionId,
                        approvalId: event.approvalId,
                        decision: 'approved'
                    });
                } else {
                    tui.confirm({ message: `${event.fallbackText || `Approve ${event.toolName}?`}` }).then((approved) => {
                        this.inboundHandler?.({
                            type: 'action_approval_response',
                            sessionId: event.sessionId,
                            approvalId: event.approvalId,
                            decision: approved ? 'approved' : 'rejected'
                        });
                    });
                }
                break;
            case 'turn_completed':
                tui.box(event.summary, 'Tarefa Concluída');
                break;
            case 'turn_interrupted':
                tui.log.warn(colors.warning(`🛑 Turno interrompido: ${event.reason}`));
                break;
        }
    }
}
