import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEngine } from './agent-engine.js';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
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

    const cleanDb = () => {
        for (const f of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
            if (fs.existsSync(f)) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    };

    beforeEach(() => {
        cleanDb();
        leaseMgr = new SessionLeaseManager(testDbPath);
        approvalsMgr = new PendingApprovalsManager(testDbPath);
    });

    afterEach(() => {
        leaseMgr.close();
        approvalsMgr.close();
        cleanDb();
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

    it('should deliver cron execution result to matching adapter', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-cron-delivery',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.deliverCronResult({
            id: 'job-1',
            schedule: 'every 1h',
            status: 'scheduled',
            deliver: 'origin',
            origin_channel: 'mock',
            origin_recipient_id: 'chat-999',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: true,
            output: 'Backup finished successfully.',
            silent: false,
            outputFilePath: '.shark/cron/output/job-1.md'
        });

        const turnCompleted = adapter.emittedEvents.find(e => e.type === 'turn_completed') as any;
        expect(turnCompleted).toBeDefined();
        expect(turnCompleted.sessionId).toBe('mock:dm:chat-999');
        expect(turnCompleted.summary).toBe('[Cron: job-1]\nBackup finished successfully.');
    });

    it('should format remote delivery with [Cron: name] header when job has name', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-cron-named',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.deliverCronResult({
            id: 'job-named-1',
            name: 'Relatório Diário',
            schedule: 'every 1h',
            status: 'scheduled',
            deliver: 'origin',
            origin_channel: 'mock',
            origin_recipient_id: 'chat-999',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: true,
            output: 'Tudo operacional.',
            cleanOutput: 'Tudo operacional.',
            silent: false
        });

        const turnCompleted = adapter.emittedEvents.find(e => e.type === 'turn_completed') as any;
        expect(turnCompleted).toBeDefined();
        expect(turnCompleted.summary).toBe('[Cron: Relatório Diário]\nTudo operacional.');
    });

    it('should deliver failure alert when cronjob execution fails', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-cron-fail',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.deliverCronResult({
            id: 'job-err',
            schedule: 'every 1h',
            status: 'failed',
            deliver: 'mock',
            origin_channel: 'mock',
            origin_recipient_id: 'chat-err',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: false,
            output: 'Database connection refused',
            silent: false
        });

        const turnCompleted = adapter.emittedEvents.find(e => e.type === 'turn_completed') as any;
        expect(turnCompleted).toBeDefined();
        expect(turnCompleted.summary).toContain("⚠️ Cron 'job-err' falhou: Database connection refused");
    });

    it('should suppress external delivery when output contains [SILENT]', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-cron-silent',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.deliverCronResult({
            id: 'job-sil',
            schedule: 'every 1h',
            status: 'scheduled',
            deliver: 'origin',
            origin_channel: 'mock',
            origin_recipient_id: 'chat-sil',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: true,
            output: 'Nothing changed [SILENT]',
            cleanOutput: '[SILENT]',
            silent: true
        });

        expect(adapter.emittedEvents.length).toBe(0);
    });

    it('clears conversationId and aborts active turn on resetSessionConversation', async () => {
        const engine = new AgentEngine({
            sessionId: 'test-sess-reset',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });

        const clearSpy = vi.spyOn(conversationManager, 'clearConversationId').mockResolvedValue();
        const result = await engine.resetSessionConversation('test-sess-reset');

        expect(result).toBe(true);
        expect(clearSpy).toHaveBeenCalledWith('session_test-sess-reset');
    });

    it('should mirror delivered cron result to session when adapter emits successfully', async () => {
        const { CronDeliveryMirror } = await import('../cron/cron-delivery-mirror.js');
        const mirrorSpy = vi.spyOn(CronDeliveryMirror, 'mirrorToSession').mockResolvedValue(true);

        const adapter = new MockAdapter();
        const engine = new AgentEngine({
            sessionId: 'test-cron-mirror',
            leaseManager: leaseMgr,
            approvalsManager: approvalsMgr
        });
        engine.attachAdapter(adapter);

        await engine.deliverCronResult({
            id: 'job-mirror-test',
            schedule: '10m',
            status: 'scheduled',
            deliver: 'mock',
            origin_channel: 'mock',
            origin_recipient_id: 'chat-mirror',
            created_at: Date.now(),
            next_run_at: Date.now() + 600000,
            run_count: 1
        }, {
            success: true,
            output: 'Mirror test output',
            silent: false
        });

        expect(mirrorSpy).toHaveBeenCalled();
        const callArgs = mirrorSpy.mock.calls[0][0];
        expect(callArgs.job.id).toBe('job-mirror-test');
        expect(callArgs.deliverySuccess).toBe(true);
        expect(callArgs.deliveredText).toContain('Mirror test output');
    });

    it('should discover workspace cron storages via getAllCronStorages', async () => {
        const rootDir = path.resolve(process.cwd(), '.shark', 'test-engine-root');
        const wsUserDir = path.resolve(rootDir, 'workspaces', 'user_test123');
        const wsCronDir = path.resolve(wsUserDir, '.shark', 'cron');
        fs.mkdirSync(wsCronDir, { recursive: true });
        fs.writeFileSync(path.join(wsCronDir, 'jobs.json'), JSON.stringify({ version: 1, jobs: {} }), 'utf-8');

        try {
            const engine = new AgentEngine({
                sessionId: 'test-multistorages',
                projectRoot: rootDir,
                leaseManager: leaseMgr,
                approvalsManager: approvalsMgr
            });

            const storages = engine.getAllCronStorages();
            const dbPaths = storages.map(s => s.getDbPath());
            expect(dbPaths).toContain(path.join(rootDir, '.shark', 'cron', 'jobs.json'));
            expect(dbPaths).toContain(path.join(wsCronDir, 'jobs.json'));
        } finally {
            try {
                fs.rmSync(rootDir, { recursive: true, force: true });
            } catch {}
        }
    });
});
