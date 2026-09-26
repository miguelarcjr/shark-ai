import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentEngine } from '../../src/core/engine/agent-engine.js';
import { WhatsAppAdapter, type WhatsAppTransport, type WhatsAppMediaPayload } from '../../src/core/adapters/whatsapp/whatsapp-adapter.js';
import { CliAdapter } from '../../src/core/adapters/cli/cli-adapter.js';
import { AgentActionExecutor } from '../../src/core/engine/agent-action-executor.js';
import { tui } from '../../src/ui/tui.js';

describe('WhatsApp and Multi-Channel Media Attachments Integration', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-media-integration');
    const videoFile = path.resolve(testDir, 'video-2026-09-26T03-00-37-403Z.webm');
    const imageFile = path.resolve(testDir, 'screenshot.png');
    const pdfFile = path.resolve(testDir, 'execution-summary.pdf');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(videoFile, 'fake-webm-binary-content');
        fs.writeFileSync(imageFile, 'fake-png-binary-content');
        fs.writeFileSync(pdfFile, 'fake-pdf-content');
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            try {
                fs.rmSync(testDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
    });

    it('end-to-end: AgentActionExecutor emits media_attachment and WhatsAppAdapter dispatches via transport.sendMedia', async () => {
        const sentMediaList: { chatId: string; media: WhatsAppMediaPayload }[] = [];
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            sendMedia: vi.fn(async (chatId, media) => {
                sentMediaList.push({ chatId, media });
            }),
            onRawMessage: vi.fn()
        };

        const whatsappAdapter = new WhatsAppAdapter(transport);
        const engine = new AgentEngine({
            sessionId: '*',
            projectRoot: testDir
        });
        engine.attachAdapter(whatsappAdapter);

        // Instancia o executor emitindo para a sessão whatsapp:dm:551199999999
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            sessionId: 'whatsapp:dm:551199999999',
            emitOutbound: (ev) => engine.emitOutbound(ev)
        });

        // 1. Executa send_file para o vídeo .webm do Playwright
        const videoResult = await executor.executeAction({
            type: 'send_file',
            args: {
                path: videoFile,
                caption: 'Gravação da automação do Playwright'
            }
        });

        expect(videoResult.success).toBe(true);
        expect(videoResult.output).toContain('video/webm');
        expect(sentMediaList.length).toBe(1);
        expect(sentMediaList[0].chatId).toBe('551199999999');
        expect(sentMediaList[0].media.filePath).toBe(videoFile);
        expect(sentMediaList[0].media.mimeType).toBe('video/webm');
        expect(sentMediaList[0].media.fileName).toBe('video-2026-09-26T03-00-37-403Z.webm');
        expect(sentMediaList[0].media.caption).toBe('Gravação da automação do Playwright');

        // 2. Executa send_file para imagem screenshot.png
        const imgResult = await executor.executeAction({
            type: 'send_file',
            args: {
                path: imageFile,
                caption: 'Screenshot do formulário'
            }
        });

        expect(imgResult.success).toBe(true);
        expect(sentMediaList.length).toBe(2);
        expect(sentMediaList[1].media.mimeType).toBe('image/png');
        expect(sentMediaList[1].media.fileName).toBe('screenshot.png');

        // 3. Executa send_file para pdf
        const docResult = await executor.executeAction({
            type: 'send_file',
            args: {
                path: pdfFile,
                caption: 'Relatório de execução'
            }
        });

        expect(docResult.success).toBe(true);
        expect(sentMediaList.length).toBe(3);
        expect(sentMediaList[2].media.mimeType).toBe('application/pdf');
    });

    it('multi-channel: simultaneous CliAdapter and WhatsAppAdapter receive media_attachment gracefully', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn().mockResolvedValue(undefined),
            sendMedia: vi.fn().mockResolvedValue(undefined),
            onRawMessage: vi.fn()
        };

        const whatsappAdapter = new WhatsAppAdapter(transport);
        const cliAdapter = new CliAdapter();
        const tuiInfoSpy = vi.spyOn(tui.log, 'info').mockReturnValue(undefined as any);

        const engine = new AgentEngine({
            sessionId: '*',
            projectRoot: testDir
        });
        engine.attachAdapter(whatsappAdapter);
        engine.attachAdapter(cliAdapter);

        // Despacha evento de media attachment pelo engine
        await engine.emitOutbound({
            type: 'media_attachment',
            sessionId: 'whatsapp:dm:551188888888',
            filePath: videoFile,
            mimeType: 'video/webm',
            caption: 'Vídeo simultâneo'
        });

        // WhatsApp recebeu o payload
        expect(transport.sendMedia).toHaveBeenCalledWith('551188888888', expect.objectContaining({
            mimeType: 'video/webm',
            caption: 'Vídeo simultâneo'
        }));

        // CLI logou a mídia com ícone de vídeo e link
        expect(tuiInfoSpy).toHaveBeenCalled();
        const logContent = tuiInfoSpy.mock.calls.map(c => c[0]).join('\n');
        expect(logContent).toContain('video-2026-09-26T03-00-37-403Z.webm');
        expect(logContent).toContain('Vídeo simultâneo');
        expect(logContent).toContain('file:');

        tuiInfoSpy.mockRestore();
    });

    it('fallback: sends textual notification if WhatsApp transport does not implement sendMedia', async () => {
        const sendTextSpy = vi.fn().mockResolvedValue(undefined);
        const transport: WhatsAppTransport = {
            sendText: sendTextSpy,
            onRawMessage: vi.fn()
        };

        const whatsappAdapter = new WhatsAppAdapter(transport);
        const engine = new AgentEngine({
            sessionId: '*',
            projectRoot: testDir
        });
        engine.attachAdapter(whatsappAdapter);

        await engine.emitOutbound({
            type: 'media_attachment',
            sessionId: 'whatsapp:dm:551177777777',
            filePath: pdfFile,
            mimeType: 'application/pdf',
            caption: 'Arquivo de log'
        });

        expect(sendTextSpy).toHaveBeenCalledWith(
            '551177777777',
            expect.stringContaining(pdfFile)
        );
        expect(sendTextSpy).toHaveBeenCalledWith(
            '551177777777',
            expect.stringContaining('Arquivo de log')
        );
    });
});
