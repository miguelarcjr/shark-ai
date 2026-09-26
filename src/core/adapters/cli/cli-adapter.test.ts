import { describe, it, expect, vi } from 'vitest';
import { CliAdapter } from './cli-adapter.js';
import type { AgentOutboundEvent } from '../../engine/events.js';
import { tui } from '../../../ui/tui.js';

describe('CliAdapter', () => {
    it('dispatches inbound user message when input is submitted', async () => {
        const adapter = new CliAdapter();
        let receivedInbound: any = null;
        adapter.onInbound(async (event) => {
            receivedInbound = event;
        });

        await adapter.dispatchUserText('Minha nova tarefa', 'session-cli');
        expect(receivedInbound).toBeDefined();
        expect(receivedInbound.type).toBe('user_message');
        expect(receivedInbound.text).toBe('Minha nova tarefa');
    });

    it('renders text_delta to stdout stream without error', () => {
        const adapter = new CliAdapter();
        const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true as any);

        adapter.emit({
            type: 'text_delta',
            sessionId: 'session-cli',
            delta: 'Chunk de texto'
        });

        expect(writeSpy).toHaveBeenCalledWith('Chunk de texto');
        writeSpy.mockRestore();
    });

    it('handles action_approval_request and prompts user', async () => {
        const adapter = new CliAdapter({ auto: true });
        let dispatchedInbound: any = null;
        adapter.onInbound(async (event) => {
            dispatchedInbound = event;
        });

        await adapter.emit({
            type: 'action_approval_request',
            sessionId: 'session-cli',
            approvalId: 'appr-123',
            toolName: 'run_command',
            toolArgs: { command: 'ls' },
            riskLevel: 'medium',
            ttlMs: 60000,
            fallbackText: 'Approve?'
        });

        expect(dispatchedInbound).toBeDefined();
        expect(dispatchedInbound.type).toBe('action_approval_response');
        expect(dispatchedInbound.approvalId).toBe('appr-123');
        expect(dispatchedInbound.decision).toBe('approved');
    });

    it('renders media_attachment event with formatted info and file URL', () => {
        const adapter = new CliAdapter();
        const infoSpy = vi.spyOn(tui.log, 'info').mockReturnValue(undefined as any);

        adapter.emit({
            type: 'media_attachment',
            sessionId: 'session-cli',
            filePath: 'd:/recordings/video.webm',
            mimeType: 'video/webm',
            caption: 'Vídeo do teste'
        });

        expect(infoSpy).toHaveBeenCalled();
        const lastCallArg = infoSpy.mock.calls[0][0];
        expect(lastCallArg).toContain('video.webm');
        expect(lastCallArg).toContain('Vídeo do teste');
        expect(lastCallArg).toContain('file:');
        infoSpy.mockRestore();
    });
});
