import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronStorage } from './cron-storage.js';

describe('CronStorage', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-storage');
    let storage: CronStorage;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        storage = new CronStorage(testDir);
    });

    afterEach(() => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    it('should initialize an empty database when jobs.json does not exist', () => {
        const db = storage.loadDatabase();
        expect(db.version).toBe(1);
        expect(db.jobs).toEqual({});
    });

    it('should perform atomic save and reload jobs accurately', () => {
        const db = storage.loadDatabase();
        db.jobs['job-1'] = {
            id: 'job-1',
            schedule: '30m',
            status: 'scheduled',
            prompt: 'run tests',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 1800000,
            run_count: 0
        };
        storage.saveDatabase(db);

        const reloaded = storage.loadDatabase();
        expect(reloaded.jobs['job-1']).toBeDefined();
        expect(reloaded.jobs['job-1'].prompt).toBe('run tests');
    });

    it('should acquire lock, prevent concurrent lock, and release lock', () => {
        const acquiredFirst = storage.acquireLock();
        expect(acquiredFirst).toBe(true);

        const acquiredSecond = storage.acquireLock();
        expect(acquiredSecond).toBe(false);

        storage.releaseLock();
        const acquiredThird = storage.acquireLock();
        expect(acquiredThird).toBe(true);
        storage.releaseLock();
    });

    it('should automatically release stale locks older than 120 seconds', () => {
        storage.acquireLock();
        const lockFile = path.join(testDir, '.tick.lock');
        expect(fs.existsSync(lockFile)).toBe(true);

        // Manually backdate the mtime by 130 seconds
        const pastTime = (Date.now() - 130000) / 1000;
        fs.utimesSync(lockFile, pastTime, pastTime);

        // A new lock attempt should reclaim the stale lock
        const reacquired = storage.acquireLock();
        expect(reacquired).toBe(true);
        storage.releaseLock();
    });
});
