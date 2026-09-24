import type { AgentChannelAdapter } from '../adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from '../../engine/events.js';
import { splitWhatsAppMessage } from './chunker.js';

export interface WhatsAppTransport {
    sendText(chatId: string, text: string): Promise<void>;
    editMessage?(chatId: string, messageId: string, text: string): Promise<void>;
    onRawMessage(handler: (chatId: string, text: string, senderId: string) => void): void;
}

export interface WhatsAppAdapterOptions {
    debounceMs?: number;
    throttleMs?: number;
}

export class WhatsAppAdapter implements AgentChannelAdapter {
    readonly channelId = 'whatsapp';
    private inboundHandler?: (event: AgentInboundEvent) => Promise<void>;
    private debounceBuffers = new Map<string, { timer: any; messages: string[] }>();
    private debounceMs: number;

    constructor(
        private transport: WhatsAppTransport,
        options: WhatsAppAdapterOptions = {}
    ) {
        this.debounceMs = options.debounceMs ?? 800;
        this.transport.onRawMessage((chatId, text, senderId) => {
            this.receiveRawFromTransport(chatId, text, senderId);
        });
    }

    public onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void {
        this.inboundHandler = handler;
    }

    public receiveRawFromTransport(chatId: string, text: string, senderId: string = chatId) {
        // Comandos de interrupção furam a fila
        if (text === '/stop' || text === '/abort') {
            this.inboundHandler?.({
                type: 'abort_command',
                sessionId: `whatsapp:dm:${chatId}`,
                reason: 'user_requested_via_whatsapp'
            });
            return;
        }

        const existing = this.debounceBuffers.get(chatId);
        if (existing) {
            clearTimeout(existing.timer);
            existing.messages.push(text);
        } else {
            this.debounceBuffers.set(chatId, {
                messages: [text],
                timer: null
            });
        }

        const buffer = this.debounceBuffers.get(chatId)!;
        buffer.timer = setTimeout(() => {
            const combined = buffer.messages.join('\n');
            this.debounceBuffers.delete(chatId);
            this.inboundHandler?.({
                type: 'user_message',
                sessionId: `whatsapp:dm:${chatId}`,
                text: combined,
                role: 'user',
                origin: { channelId: 'whatsapp', senderId }
            });
        }, this.debounceMs);
    }

    public async emit(event: AgentOutboundEvent): Promise<void> {
        const chatId = event.sessionId.replace(/^whatsapp:dm:/, '');
        if (event.type === 'turn_completed') {
            const chunks = splitWhatsAppMessage(event.summary);
            for (const chunk of chunks) {
                await this.transport.sendText(chatId, chunk);
            }
        } else if (event.type === 'action_approval_request') {
            const text = `⚠️ *Aprovação Solicitada*\nFerramenta: \`${event.toolName}\`\n\n${event.fallbackText}\n_Responda 1 para Aprovar ou 2 para Rejeitar_`;
            await this.transport.sendText(chatId, text);
        }
    }
}
