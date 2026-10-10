import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronStorage } from './cron-storage.js';
import { CronScheduler, parseScheduleDelay, calculateNextRunAt } from './cron-scheduler.js';
import type { CronJob } from './cron-types.js';

describe('CronScheduler', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-scheduler');
    let storage: CronStorage;
    let scheduler: CronScheduler;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        storage = new CronStorage(testDir);
        scheduler = new CronScheduler({ storage, tickIntervalMs: 50 });
    });

    afterEach(() => {
        scheduler.stop();
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    it('should parse relative delays accurately', () => {
        expect(parseScheduleDelay('30s')).toBe(30000);
        expect(parseScheduleDelay('15m')).toBe(15 * 60 * 1000);
        expect(parseScheduleDelay('2h')).toBe(2 * 60 * 60 * 1000);
        expect(parseScheduleDelay('1d')).toBe(24 * 60 * 60 * 1000);
        expect(parseScheduleDelay('invalid')).toBeNull();
    });

    it('should calculate next run for intervals and timestamps', () => {
        const now = 1728590000000;
        const nextRelative = calculateNextRunAt('30m', now);
        expect(nextRelative).toBe(now + 30 * 60 * 1000);

        const nextInterval = calculateNextRunAt('every 2h', now);
        expect(nextInterval).toBe(now + 2 * 60 * 60 * 1000);

        const iso = '2026-10-11T12:00:00.000Z';
        const nextIso = calculateNextRunAt(iso, now);
        expect(nextIso).toBe(new Date(iso).getTime());
    });

    it('should coalesce overdue recurring jobs into 1 execution', async () => {
        const now = Date.now();
        const db = storage.loadDatabase();
        const job: CronJob = {
            id: 'job-coalesce',
            schedule: 'every 1h',
            status: 'scheduled',
            prompt: 'hourly audit',
            deliver: 'local',
            created_at: now - 10 * 3600 * 1000,
            next_run_at: now - 5 * 3600 * 1000, // 5 hours overdue
            run_count: 0
        };
        db.jobs[job.id] = job;
        storage.saveDatabase(db);

        const executedJobs: string[] = [];
        scheduler.setJobDispatcher(async (j) => {
            executedJobs.push(j.id);
        });

        await scheduler.tick();

        expect(executedJobs).toEqual(['job-coalesce']);
        const updatedDb = storage.loadDatabase();
        const updatedJob = updatedDb.jobs['job-coalesce'];
        expect(updatedJob.catch_up_occurrences).toBe(1);
        expect(updatedJob.next_run_at).toBeGreaterThan(now);
    });

    it('should expire overdue one-shot jobs if past grace period', async () => {
        const now = Date.now();
        const db = storage.loadDatabase();
        const job: CronJob = {
            id: 'job-oneshot-late',
            schedule: '30m',
            status: 'scheduled',
            prompt: 'reminder',
            deliver: 'local',
            created_at: now - 3600 * 1000,
            next_run_at: now - 500 * 1000, // Overdue by 500s (> 120s grace)
            run_count: 0
        };
        db.jobs[job.id] = job;
        storage.saveDatabase(db);

        const executedJobs: string[] = [];
        scheduler.setJobDispatcher(async (j) => {
            executedJobs.push(j.id);
        });

        await scheduler.tick();

        expect(executedJobs).toHaveLength(0); // Did not execute
        const updatedDb = storage.loadDatabase();
        const updatedJob = updatedDb.jobs['job-oneshot-late'];
        expect(updatedJob.status).toBe('completed');
        expect(updatedJob.last_status).toContain('expired');
    });

    it('should prevent overlap if job is already marked running', async () => {
        const now = Date.now();
        const db = storage.loadDatabase();
        const job: CronJob = {
            id: 'job-overlap',
            schedule: 'every 1m',
            status: 'running', // already running
            prompt: 'long task',
            deliver: 'local',
            created_at: now - 60000,
            next_run_at: now - 1000,
            run_count: 0
        };
        db.jobs[job.id] = job;
        storage.saveDatabase(db);

        const executedJobs: string[] = [];
        scheduler.setJobDispatcher(async (j) => {
            executedJobs.push(j.id);
        });

        await scheduler.tick();
        expect(executedJobs).toHaveLength(0); // Skipped due to running state
    });
});
