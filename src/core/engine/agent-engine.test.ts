import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEngine } from './agent-engine.js';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

vi.mock('../agents/developer-agent.js', () => ({
    interactiveDeveloperAgent: vi.fn().mockImplementation(async (opts) => {
        if (opts.taskInstruction?.includes('long running')) {
            await new Promise((r) => setTimeout(r, 200));
        }
        return { success: true, summary: `Processed: ${opts.taskInstruction}` };
    })
}));

class MockAdapter implements AgentChannelAdapter {
    readonly channelId = 'mock';
    public emittedEvents: AgentOutboundEvent[] = [];
    public inboundHandler?: (event: AgentInboundEvent) => Promise<void>;

    emit(event: AgentOutboundEvent) {
        this.emittedEvents.push(event);
    }

    onInbound(handler: (event: AgentInboundEvent) => Promise<void>) {
        this.inboundHandler = handler;
    }
}

describe('AgentEngine Core', () => {
    const testDbPath = path.resolve(process.cwd(), '.shark', 'test-engine.db');
    let leaseMgr: SessionLeaseManager;
    let approvalsMgr: PendingApprovalsManager;

    beforeEach(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        leaseMgr = new SessionLeaseManager(testDbPath);
        approvalsMgr = new PendingApprovalsManager(testDbPath);
    });

    afterEach(() => {
        leaseMgr.close();
        approvalsMgr.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('attaches adapter, dispatches presence, and executes turn lifecycle', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-sess-1',
            auto: true,
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.processMessage({
            type: 'user_message',
            sessionId: 'test-sess-1',
            text: 'ping',
            role: 'user',
            origin: { channelId: 'mock', senderId: 'u1' }
        });

        // Verifica emissão de presença e conclusão
        const types = adapter.emittedEvents.map(e => e.type);
        expect(types).toContain('presence_status');
        expect(types).toContain('turn_completed');
    });

    it('cancels active turn immediately on abort_command', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-sess-abort',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        const runPromise = engine.processMessage({
            type: 'user_message',
            sessionId: 'test-sess-abort',
            text: 'long running task',
            role: 'user',
            origin: { channelId: 'mock', senderId: 'u1' }
        });

        // Emite aborto via inbound
        await adapter.inboundHandler?.({
            type: 'abort_command',
            sessionId: 'test-sess-abort',
            reason: 'user_cancelled'
        });

        await runPromise;

        const interrupted = adapter.emittedEvents.find(e => e.type === 'turn_interrupted');
        expect(interrupted).toBeDefined();
        expect(interrupted?.type === 'turn_interrupted' && interrupted.reason).toContain('user_cancelled');
    });
});
