import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronStorage } from './cron-storage.js';
import { CronScheduler } from './cron-scheduler.js';
import { CronToolHandler } from './cron-tool-handler.js';

describe('CronToolHandler', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-handler');
    let storage: CronStorage;
    let scheduler: CronScheduler;
    let handler: CronToolHandler;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        storage = new CronStorage(testDir);
        scheduler = new CronScheduler({ storage });
        handler = new CronToolHandler({ storage, scheduler });
    });

    afterEach(() => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    it('should create a valid cronjob and return scheduler_running status', async () => {
        const res = await handler.handleAction({
            action: 'create',
            schedule: 'every 2h',
            prompt: 'check system health',
            deliver: 'origin'
        });

        expect(res.success).toBe(true);
        expect(res.job).toBeDefined();
        expect(res.job?.schedule).toBe('every 2h');
        expect(res.scheduler_running).toBe(false);
    });

    it('should reject creation without schedule', async () => {
        const res = await handler.handleAction({
            action: 'create',
            prompt: 'missing schedule'
        });

        expect(res.success).toBe(false);
        expect(res.message).toContain('schedule');
    });

    it('should reject creation when no_agent=true but script is missing', async () => {
        const res = await handler.handleAction({
            action: 'create',
            schedule: '30m',
            no_agent: true
        });

        expect(res.success).toBe(false);
        expect(res.message).toContain('script');
    });

    it('should reject recursion when SHARK_CRON_EXECUTION is active', async () => {
        process.env.SHARK_CRON_EXECUTION = 'true';
        try {
            const res = await handler.handleAction({
                action: 'create',
                schedule: '10m',
                prompt: 'nested cron'
            });
            expect(res.success).toBe(false);
            expect(res.message).toContain('recursively');
        } finally {
            delete process.env.SHARK_CRON_EXECUTION;
        }
    });

    it('should list, pause, resume, and remove jobs', async () => {
        const created = await handler.handleAction({
            action: 'create',
            schedule: 'every 1h',
            prompt: 'hourly job'
        });
        const jobId = created.job!.id;

        const list = await handler.handleAction({ action: 'list' });
        expect(list.count).toBe(1);

        const paused = await handler.handleAction({ action: 'pause', id: jobId });
        expect(paused.job?.status).toBe('paused');

        const resumed = await handler.handleAction({ action: 'resume', id: jobId });
        expect(resumed.job?.status).toBe('scheduled');

        const removed = await handler.handleAction({ action: 'remove', id: jobId });
        expect(removed.success).toBe(true);

        const emptyList = await handler.handleAction({ action: 'list' });
        expect(emptyList.count).toBe(0);
    });
});
