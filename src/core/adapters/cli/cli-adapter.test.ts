import { describe, it, expect, vi } from 'vitest';
import { CliAdapter } from './cli-adapter.js';
import type { AgentOutboundEvent } from '../../engine/events.js';

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
});
