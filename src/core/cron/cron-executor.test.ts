import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronStorage } from './cron-storage.js';
import { CronExecutor } from './cron-executor.js';
import type { CronJob } from './cron-types.js';

describe('CronExecutor', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-executor');
    let storage: CronStorage;
    let executor: CronExecutor;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        storage = new CronStorage(testDir);
        executor = new CronExecutor({ storage, projectRoot: testDir });
    });

    afterEach(() => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    it('should execute direct scripts in no_agent mode without LLM', async () => {
        const job: CronJob = {
            id: 'job-script',
            schedule: '10m',
            status: 'running',
            no_agent: true,
            script: 'node -e "console.log(\'hello from script\')"',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 600000,
            run_count: 1
        };

        const result = await executor.execute(job);
        expect(result.success).toBe(true);
        expect(result.output).toContain('hello from script');
        expect(result.silent).toBe(false);

        // Verify report file was saved
        const outputFiles = fs.readdirSync(storage.getOutputDir());
        expect(outputFiles.length).toBeGreaterThan(0);
    });

    it('should detect [SILENT] token and set silent flag', async () => {
        const job: CronJob = {
            id: 'job-silent',
            schedule: '10m',
            status: 'running',
            no_agent: true,
            script: 'node -e "console.log(\'[SILENT]\')"',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 600000,
            run_count: 1
        };

        const result = await executor.execute(job);
        expect(result.silent).toBe(true);
    });

    it('should skip agent execution when monitor_script output hash has not changed', async () => {
        const monitorScript = 'node -e "console.log(\'healthy\')"';
        const job: CronJob = {
            id: 'job-monitor',
            schedule: '5m',
            status: 'running',
            monitor_script: monitorScript,
            prompt: 'inspect system',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 300000,
            run_count: 1
        };

        // First execution sets the hash
        const firstRun = await executor.execute(job);
        expect(firstRun.diffDetected).toBe(true);
        expect(job.last_monitor_hash).toBeDefined();

        // Second execution with identical output skips agent
        const secondRun = await executor.execute(job);
        expect(secondRun.diffDetected).toBe(false);
        expect(secondRun.silent).toBe(true);
    });
});
