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

    it('emits tool_progress notifications to WhatsApp chat', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport);

        await adapter.emit({
            type: 'tool_progress',
            sessionId: 'whatsapp:dm:u123',
            toolName: 'read_file',
            status: 'starting',
            details: 'File: src/index.ts'
        });

        expect(transport.sendText).toHaveBeenCalledWith('u123', expect.stringContaining('[read_file]'));
    });

    it('emits turn_interrupted notification when aborted', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport);

        await adapter.emit({
            type: 'turn_interrupted',
            sessionId: 'whatsapp:dm:u123',
            reason: 'Task cancelled by user'
        });

        expect(transport.sendText).toHaveBeenCalledWith('u123', expect.stringContaining('Turno interrompido'));
    });

    it('emits media_attachment via transport.sendMedia when available', async () => {
        const sendMedia = vi.fn().mockResolvedValue(undefined);
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            sendMedia,
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport);

        await adapter.emit({
            type: 'media_attachment',
            sessionId: 'whatsapp:dm:u123',
            filePath: '/path/to/video.webm',
            mimeType: 'video/webm',
            caption: 'Video da execucao'
        });

        expect(sendMedia).toHaveBeenCalledWith('u123', {
            filePath: '/path/to/video.webm',
            mimeType: 'video/webm',
            caption: 'Video da execucao',
            fileName: 'video.webm'
        });
    });

    it('emits media_attachment fallback via sendText when sendMedia is not implemented', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport);

        await adapter.emit({
            type: 'media_attachment',
            sessionId: 'whatsapp:dm:u123',
            filePath: '/path/to/report.pdf',
            mimeType: 'application/pdf',
            caption: 'Relatorio mensal'
        });

        expect(transport.sendText).toHaveBeenCalledWith(
            'u123',
            expect.stringContaining('/path/to/report.pdf')
        );
        expect(transport.sendText).toHaveBeenCalledWith(
            'u123',
            expect.stringContaining('Relatorio mensal')
        );
    });
});
