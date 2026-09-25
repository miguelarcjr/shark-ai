import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEngine } from './agent-engine.js';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
        vi.restoreAllMocks();
    });

    it('attaches adapter, dispatches presence, and executes turn lifecycle', async () => {
        const adapter = new MockAdapter();
        const mockProvider = {
            streamChat: vi.fn().mockResolvedValue({
                message: 'TASK_COMPLETED: Finished test task',
                summary: 'Finished test task'
            })
        };
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue(mockProvider as any);

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

        const types = adapter.emittedEvents.map(e => e.type);
        expect(types).toContain('presence_status');
        expect(types).toContain('turn_completed');

        const turnCompleted = adapter.emittedEvents.find(e => e.type === 'turn_completed') as any;
        expect(turnCompleted?.summary).toContain('Finished test task');
    });

    it('executes tool iteration and emits tool_progress before completion', async () => {
        const adapter = new MockAdapter();
        let turn = 0;
        const mockProvider = {
            streamChat: vi.fn().mockImplementation(async () => {
                turn++;
                if (turn === 1) {
                    return {
                        action: { type: 'list_files', args: { path: '.' } },
                        summary: 'Listing files'
                    };
                }
                return {
                    message: 'TASK_COMPLETED: Analyzed directory structure',
                    summary: 'Analyzed directory structure'
                };
            })
        };
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue(mockProvider as any);

        const engine = new AgentEngine({
            sessionId: 'test-sess-tool',
            auto: true,
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.processMessage({
            type: 'user_message',
            sessionId: 'test-sess-tool',
            text: 'Investigate directory',
            role: 'user',
            origin: { channelId: 'mock', senderId: 'u1' }
        });

        const progressEvents = adapter.emittedEvents.filter(e => e.type === 'tool_progress') as any[];
        expect(progressEvents.length).toBeGreaterThanOrEqual(2);
        expect(progressEvents.some(p => p.toolName === 'list_files' && p.status === 'starting')).toBe(true);
        expect(progressEvents.some(p => p.toolName === 'list_files' && p.status === 'completed')).toBe(true);

        const completed = adapter.emittedEvents.find(e => e.type === 'turn_completed') as any;
        expect(completed?.summary).toContain('Analyzed directory structure');
    });

    it('cancels active turn immediately on abort_command', async () => {
        const adapter = new MockAdapter();
        const mockProvider = {
            streamChat: vi.fn().mockImplementation(async (_prompt, opts) => {
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, 200);
                    opts.signal?.addEventListener('abort', () => {
                        clearTimeout(timer);
                        resolve(null);
                    });
                });
                return { message: 'Never reached' };
            })
        };
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue(mockProvider as any);

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
