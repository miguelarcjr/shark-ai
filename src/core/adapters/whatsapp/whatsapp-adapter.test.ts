import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppAdapter, type WhatsAppTransport } from './whatsapp-adapter.js';

describe('WhatsAppAdapter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces rapid burst messages into a single user message event', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn(),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport, { debounceMs: 800 });

        let receivedCount = 0;
        let lastText = '';
        adapter.onInbound(async (event) => {
            if (event.type === 'user_message') {
                receivedCount++;
                lastText = event.text;
            }
        });

        // 3 mensagens em rajada rápida
        adapter.receiveRawFromTransport('u123', 'Oi');
        adapter.receiveRawFromTransport('u123', 'Crie um endpoint');
        adapter.receiveRawFromTransport('u123', 'com Zod');

        expect(receivedCount).toBe(0);

        // Avança 800ms do temporizador
        vi.advanceTimersByTime(800);

        expect(receivedCount).toBe(1);
        expect(lastText).toBe('Oi\nCrie um endpoint\ncom Zod');
    });

    it('bypasses debounce immediately for abort commands', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn(),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport, { debounceMs: 800 });

        let aborted = false;
        adapter.onInbound(async (event) => {
            if (event.type === 'abort_command') {
                aborted = true;
            }
        });

        adapter.receiveRawFromTransport('u123', '/stop');
        expect(aborted).toBe(true);
    });
});
