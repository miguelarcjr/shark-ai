# Cronjob Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the autonomous `cronjob` tool in Shark Dev, enabling the agent to schedule one-shot, interval, and recurring cron tasks in background processes with atomic disk storage, overlap prevention, offline catch-up, and channel-agnostic delivery.

**Architecture:** A decoupled core subsystem under `src/core/cron/` with atomic file storage (`.shark/cron/jobs.json`), a 60-second ticker (`CronScheduler`), process-isolated execution using `fork` and `execFile` (`CronExecutor`), and a tool handler plugged into `AgentActionExecutor` and `AgentEngine`.

**Tech Stack:** TypeScript, Node.js (>=22.0.0, `node:child_process`, `node:fs`, `node:crypto`), Commander.js, Vitest.

## Global Constraints

- Storage path must be workspace-scoped: `<projectRoot>/.shark/cron/jobs.json`
- Lock file path must be `<projectRoot>/.shark/cron/.tick.lock`
- Output markdown files must be stored in `<projectRoot>/.shark/cron/output/<jobId>-<timestamp>.md`
- Recurring jobs must never run in backfill storms (coalesce to exactly 1 execution on catch-up)
- One-shot jobs have a 120-second grace period (`ONESHOT_GRACE_SECONDS = 120000`); expire if overdue
- Jobs with status `running` must prevent overlap on subsequent tick cycles
- Agent-backed jobs must execute in an isolated child process with `--skip-memory` and `--auto`
- Action `cronjob` must NOT be available in `SUBAGENT_ACTION_SCHEMAS` or inside cron sessions
- Token `[SILENT]` must completely suppress external notifications
- Use Vitest with `npm test` or `npx vitest run <path>` for testing

---

### Task 1: Core Types and Data Models

**Files:**
- Create: `src/core/cron/cron-types.ts`
- Create: `src/core/cron/index.ts`

**Interfaces:**
- Consumes: Nothing
- Produces: `CronJobStatus`, `CronJob`, `CronDatabase`, `CronToolAction`, `CronToolArgs`, `CronToolResult`

- [ ] **Step 1: Write `src/core/cron/cron-types.ts`**

```typescript
export type CronJobStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';

export interface CronJob {
    id: string;
    name?: string;
    schedule: string;
    status: CronJobStatus;
    prompt?: string;
    script?: string;
    no_agent?: boolean;
    monitor_script?: string;
    last_monitor_hash?: string;
    skills?: string[];
    deliver: 'origin' | 'local' | string;
    origin_channel?: string;
    origin_recipient_id?: string;
    created_at: number;
    next_run_at: number;
    last_run_at?: number;
    run_count: number;
    catch_up_occurrences?: number;
    last_status?: string;
    last_output_file?: string;
}

export interface CronDatabase {
    version: 1;
    jobs: Record<string, CronJob>;
}

export type CronToolAction = 'create' | 'list' | 'update' | 'pause' | 'resume' | 'run' | 'remove';

export interface CronToolArgs {
    action: CronToolAction;
    id?: string;
    name?: string;
    schedule?: string;
    prompt?: string;
    script?: string;
    monitor_script?: string;
    no_agent?: boolean;
    skills?: string[];
    deliver?: string;
}

export interface CronToolResult {
    success: boolean;
    message: string;
    scheduler_running?: boolean;
    job?: CronJob;
    jobs?: CronJob[];
    count?: number;
}
```

- [ ] **Step 2: Write `src/core/cron/index.ts`**

```typescript
export * from './cron-types.js';
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/core/cron/cron-types.ts src/core/cron/index.ts
git commit -m "feat(cron): add cron data models and type definitions"
```

---

### Task 2: Atomic Storage and Lock Manager

**Files:**
- Create: `src/core/cron/cron-storage.ts`
- Test: `src/core/cron/cron-storage.test.ts`

**Interfaces:**
- Consumes: `CronDatabase`, `CronJob` from `src/core/cron/cron-types.js`
- Produces: `CronStorage` with methods `loadDatabase()`, `saveDatabase()`, `acquireLock()`, `releaseLock()`, `withLock<T>()`

- [ ] **Step 1: Write failing test in `src/core/cron/cron-storage.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-storage.test.ts`
Expected: FAIL (Cannot find module `./cron-storage.js`)

- [ ] **Step 3: Write implementation in `src/core/cron/cron-storage.ts`**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { CronDatabase } from './cron-types.js';

export class CronStorage {
    private readonly cronDir: string;
    private readonly dbPath: string;
    private readonly lockPath: string;

    constructor(baseDir?: string) {
        const root = baseDir || path.resolve(process.cwd(), '.shark', 'cron');
        this.cronDir = root;
        this.dbPath = path.join(this.cronDir, 'jobs.json');
        this.lockPath = path.join(this.cronDir, '.tick.lock');
        this.ensureDirectories();
    }

    public ensureDirectories(): void {
        fs.mkdirSync(this.cronDir, { recursive: true });
        fs.mkdirSync(path.join(this.cronDir, 'output'), { recursive: true });
        fs.mkdirSync(path.join(this.cronDir, 'tasks'), { recursive: true });
    }

    public loadDatabase(): CronDatabase {
        this.ensureDirectories();
        if (!fs.existsSync(this.dbPath)) {
            return { version: 1, jobs: {} };
        }
        try {
            const raw = fs.readFileSync(this.dbPath, 'utf-8');
            const data = JSON.parse(raw);
            if (data && typeof data === 'object' && data.version === 1 && data.jobs) {
                return data as CronDatabase;
            }
        } catch {
            // Safe fallback on read or parse failure
        }
        return { version: 1, jobs: {} };
    }

    public saveDatabase(db: CronDatabase): void {
        this.ensureDirectories();
        const tmpPath = path.join(this.cronDir, `jobs.json.tmp.${crypto.randomUUID()}`);
        const content = JSON.stringify(db, null, 2);
        fs.writeFileSync(tmpPath, content, 'utf-8');
        try {
            fs.renameSync(tmpPath, this.dbPath);
        } catch (e) {
            // Windows retry fallback
            let retries = 3;
            let success = false;
            while (retries > 0) {
                try {
                    fs.renameSync(tmpPath, this.dbPath);
                    success = true;
                    break;
                } catch {
                    retries--;
                    const waitTill = new Date(new Date().getTime() + 50);
                    while (waitTill > new Date()) {}
                }
            }
            if (!success) {
                fs.copyFileSync(tmpPath, this.dbPath);
                try { fs.unlinkSync(tmpPath); } catch {}
            }
        }
    }

    public acquireLock(): boolean {
        this.ensureDirectories();
        if (fs.existsSync(this.lockPath)) {
            try {
                const stats = fs.statSync(this.lockPath);
                const ageMs = Date.now() - stats.mtimeMs;
                if (ageMs > 120000) {
                    // Stale lock reclamation
                    this.releaseLock();
                } else {
                    return false;
                }
            } catch {
                return false;
            }
        }
        try {
            fs.writeFileSync(this.lockPath, JSON.stringify({ pid: process.pid, time: Date.now() }), { flag: 'wx' });
            return true;
        } catch {
            return false;
        }
    }

    public releaseLock(): void {
        try {
            if (fs.existsSync(this.lockPath)) {
                fs.unlinkSync(this.lockPath);
            }
        } catch {}
    }

    public async withLock<T>(action: () => Promise<T> | T): Promise<T | null> {
        if (!this.acquireLock()) {
            return null;
        }
        try {
            return await action();
        } finally {
            this.releaseLock();
        }
    }

    public getOutputDir(): string {
        return path.join(this.cronDir, 'output');
    }

    public getTasksDir(): string {
        return path.join(this.cronDir, 'tasks');
    }
}
```

- [ ] **Step 4: Update `src/core/cron/index.ts` to export CronStorage**

```typescript
export * from './cron-types.js';
export * from './cron-storage.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/cron/cron-storage.test.ts`
Expected: PASS (4 tests passing)

- [ ] **Step 6: Commit**

```bash
git add src/core/cron/cron-storage.ts src/core/cron/cron-storage.test.ts src/core/cron/index.ts
git commit -m "feat(cron): add atomic cron storage and file lock manager"
```

---

### Task 3: Scheduler Engine with Parser, Overlap Prevention & Catch-up Policy

**Files:**
- Create: `src/core/cron/cron-scheduler.ts`
- Test: `src/core/cron/cron-scheduler.test.ts`

**Interfaces:**
- Consumes: `CronStorage`, `CronJob`, `CronDatabase` from `src/core/cron/`
- Produces: `CronScheduler` with `parseSchedule()`, `calculateNextRun()`, `tick()`, `start()`, `stop()`, `isRunning()`

- [ ] **Step 1: Write failing test in `src/core/cron/cron-scheduler.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-scheduler.test.ts`
Expected: FAIL (Cannot find module `./cron-scheduler.js`)

- [ ] **Step 3: Write implementation in `src/core/cron/cron-scheduler.ts`**

```typescript
import { CronStorage } from './cron-storage.js';
import type { CronJob, CronDatabase } from './cron-types.js';

export const ONESHOT_GRACE_MS = 120 * 1000; // 120s tolerance

export function parseScheduleDelay(expression: string): number | null {
    const trimmed = expression.trim().toLowerCase();
    const match = trimmed.match(/^(\d+)\s*(s|m|h|d)$/);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

export function isOneShotSchedule(expression: string): boolean {
    const trimmed = expression.trim().toLowerCase();
    if (trimmed.startsWith('every ')) return false;
    if (trimmed.split(/\s+/).length === 5) return false;
    return true;
}

export function calculateNextRunAt(expression: string, fromTimestamp: number = Date.now()): number {
    const trimmed = expression.trim();
    const lower = trimmed.toLowerCase();

    // 1. Interval syntax: "every 2h", "every 30m"
    if (lower.startsWith('every ')) {
        const remainder = lower.replace(/^every\s+/, '').trim();
        const delay = parseScheduleDelay(remainder);
        if (delay !== null) {
            return fromTimestamp + delay;
        }
    }

    // 2. Relative delay: "30m", "2h"
    const relativeDelay = parseScheduleDelay(lower);
    if (relativeDelay !== null) {
        return fromTimestamp + relativeDelay;
    }

    // 3. ISO timestamp
    const parsedDate = Date.parse(trimmed);
    if (!isNaN(parsedDate)) {
        return parsedDate;
    }

    // 4. Fallback 5-field cron basic approximation (hourly if 0 * * * *)
    const fields = trimmed.split(/\s+/);
    if (fields.length === 5) {
        // Simple step interval fallback: */15 * * * *
        if (fields[0].startsWith('*/')) {
            const stepMinutes = parseInt(fields[0].replace('*/', ''), 10) || 15;
            return fromTimestamp + stepMinutes * 60 * 1000;
        }
        // Default recurring 1 hour fallback for valid 5-field crons
        return fromTimestamp + 3600 * 1000;
    }

    // Default fallback: 1 hour from now
    return fromTimestamp + 3600 * 1000;
}

export interface CronSchedulerOptions {
    storage?: CronStorage;
    tickIntervalMs?: number;
    maxConcurrentJobs?: number;
}

export class CronScheduler {
    private storage: CronStorage;
    private tickIntervalMs: number;
    private maxConcurrentJobs: number;
    private timerId: NodeJS.Timeout | null = null;
    private runningJobIds = new Set<string>();
    private jobDispatcher: ((job: CronJob) => Promise<void>) | null = null;

    constructor(options: CronSchedulerOptions = {}) {
        this.storage = options.storage || new CronStorage();
        this.tickIntervalMs = options.tickIntervalMs || 60000;
        this.maxConcurrentJobs = options.maxConcurrentJobs || 3;
    }

    public setJobDispatcher(dispatcher: (job: CronJob) => Promise<void>): void {
        this.jobDispatcher = dispatcher;
    }

    public isRunning(): boolean {
        return this.timerId !== null;
    }

    public start(): void {
        if (this.timerId) return;
        this.timerId = setInterval(() => {
            this.tick().catch(() => {});
        }, this.tickIntervalMs);
        if (typeof this.timerId.unref === 'function') {
            this.timerId.unref();
        }
    }

    public stop(): void {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }

    public async tick(): Promise<void> {
        await this.storage.withLock(async () => {
            const db = this.storage.loadDatabase();
            const now = Date.now();
            const eligibleJobs: CronJob[] = [];

            for (const job of Object.values(db.jobs)) {
                if (job.status !== 'scheduled') continue;
                if (job.next_run_at > now) continue;

                // Overlap prevention: skip if already active
                if (this.runningJobIds.has(job.id)) {
                    continue;
                }

                const isOneShot = isOneShotSchedule(job.schedule);
                const overdueBy = now - job.next_run_at;

                if (isOneShot && overdueBy > ONESHOT_GRACE_MS) {
                    // Grace period expired for one-shot
                    job.status = 'completed';
                    job.last_status = 'expired: grace period exceeded';
                    continue;
                }

                // Recurring catch-up coalescing
                if (!isOneShot && overdueBy > 3600000) {
                    job.catch_up_occurrences = (job.catch_up_occurrences || 0) + 1;
                }

                eligibleJobs.push(job);
            }

            // Cap concurrency
            const availableSlots = Math.max(0, this.maxConcurrentJobs - this.runningJobIds.size);
            const toDispatch = eligibleJobs.slice(0, availableSlots);

            for (const job of toDispatch) {
                job.status = 'running';
                job.last_run_at = now;
                job.run_count = (job.run_count || 0) + 1;

                if (isOneShotSchedule(job.schedule)) {
                    job.next_run_at = 0;
                } else {
                    job.next_run_at = calculateNextRunAt(job.schedule, now);
                }

                this.runningJobIds.add(job.id);
            }

            this.storage.saveDatabase(db);

            // Dispatch jobs outside storage lock
            for (const job of toDispatch) {
                this.executeJob(job).catch(() => {});
            }
        });
    }

    private async executeJob(job: CronJob): Promise<void> {
        try {
            if (this.jobDispatcher) {
                await this.jobDispatcher(job);
            }
        } finally {
            this.runningJobIds.delete(job.id);
            // Update job status after execution
            await this.storage.withLock(async () => {
                const db = this.storage.loadDatabase();
                const current = db.jobs[job.id];
                if (current && current.status === 'running') {
                    if (isOneShotSchedule(current.schedule)) {
                        current.status = 'completed';
                    } else {
                        current.status = 'scheduled';
                    }
                    this.storage.saveDatabase(db);
                }
            });
        }
    }
}
```

- [ ] **Step 4: Update `src/core/cron/index.ts`**

```typescript
export * from './cron-types.js';
export * from './cron-storage.js';
export * from './cron-scheduler.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/cron/cron-scheduler.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 6: Commit**

```bash
git add src/core/cron/cron-scheduler.ts src/core/cron/cron-scheduler.test.ts src/core/cron/index.ts
git commit -m "feat(cron): add scheduler engine with overlap prevention and catch-up policy"
```

---

### Task 4: Subprocess & Script Executor with Watchdog and Diff Monitor

**Files:**
- Create: `src/core/cron/cron-executor.ts`
- Test: `src/core/cron/cron-executor.test.ts`

**Interfaces:**
- Consumes: `CronStorage`, `CronJob` from `src/core/cron/`
- Produces: `CronExecutor` with `execute(job: CronJob): Promise<{ success: boolean, output: string, silent: boolean }>`

- [ ] **Step 1: Write failing test in `src/core/cron/cron-executor.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-executor.test.ts`
Expected: FAIL (Cannot find module `./cron-executor.js`)

- [ ] **Step 3: Write implementation in `src/core/cron/cron-executor.ts`**

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CronStorage } from './cron-storage.js';
import type { CronJob } from './cron-types.js';

export interface ExecutorRunResult {
    success: boolean;
    output: string;
    silent: boolean;
    diffDetected?: boolean;
    outputFilePath?: string;
}

export interface CronExecutorOptions {
    storage?: CronStorage;
    projectRoot?: string;
    timeoutMs?: number;
}

export class CronExecutor {
    private storage: CronStorage;
    private projectRoot: string;
    private timeoutMs: number;

    constructor(options: CronExecutorOptions = {}) {
        this.storage = options.storage || new CronStorage();
        this.projectRoot = options.projectRoot || process.cwd();
        this.timeoutMs = options.timeoutMs || 180000; // 3 minutes hard timeout
    }

    public async execute(job: CronJob): Promise<ExecutorRunResult> {
        // 1. Check Diff Watchdog if monitor_script is present
        if (job.monitor_script) {
            const monitorResult = await this.executeScriptCommand(job.monitor_script);
            const currentHash = crypto.createHash('sha256').update(monitorResult.output.trim()).digest('hex');

            if (job.last_monitor_hash && job.last_monitor_hash === currentHash) {
                // No change detected: suppress LLM execution
                return {
                    success: true,
                    output: '[SILENT]',
                    silent: true,
                    diffDetected: false
                };
            }
            job.last_monitor_hash = currentHash;
        }

        // 2. Direct script execution (no_agent = true)
        if (job.no_agent && job.script) {
            const scriptResult = await this.executeScriptCommand(job.script);
            const isSilent = scriptResult.output.includes('[SILENT]');
            const savedPath = this.saveOutputFile(job.id, scriptResult.output);
            job.last_output_file = savedPath;
            return {
                success: scriptResult.success,
                output: scriptResult.output,
                silent: isSilent,
                outputFilePath: savedPath,
                diffDetected: true
            };
        }

        // 3. Agent-backed execution (fresh session subprocess)
        const agentResult = await this.executeAgentSubprocess(job);
        const isSilent = agentResult.output.includes('[SILENT]');
        const savedPath = this.saveOutputFile(job.id, agentResult.output);
        job.last_output_file = savedPath;

        return {
            success: agentResult.success,
            output: agentResult.output,
            silent: isSilent,
            outputFilePath: savedPath,
            diffDetected: true
        };
    }

    private executeScriptCommand(command: string): Promise<{ success: boolean; output: string }> {
        return new Promise((resolve) => {
            exec(command, { cwd: this.projectRoot, timeout: this.timeoutMs }, (err, stdout, stderr) => {
                const output = (stdout || '') + (stderr ? `\n${stderr}` : '');
                resolve({
                    success: !err,
                    output: output.trim()
                });
            });
        });
    }

    private async executeAgentSubprocess(job: CronJob): Promise<{ success: boolean; output: string }> {
        const tasksDir = this.storage.getTasksDir();
        const briefFile = path.join(tasksDir, `task-${job.id}-${Date.now()}.md`);

        let briefContent = `# Cronjob Task Execution: ${job.id}\n\n`;
        if (job.skills && job.skills.length > 0) {
            briefContent += `> Injected Skills: ${job.skills.join(', ')}\n\n`;
        }
        briefContent += `${job.prompt || 'Execute scheduled maintenance.'}\n`;
        fs.writeFileSync(briefFile, briefContent, 'utf-8');

        const cliPath = this.resolveSharkCli();
        const args = ['dev', '--task-file', briefFile, '--taskId', `cron-${job.id}`, '--auto', '--skip-memory'];

        return new Promise((resolve) => {
            let stdoutBuffer = '';
            const child = fork(cliPath, args, {
                cwd: this.projectRoot,
                silent: true,
                env: {
                    ...process.env,
                    SHARK_CRON_EXECUTION: 'true'
                }
            });

            child.stdout?.on('data', (d) => { stdoutBuffer += d.toString(); });
            child.stderr?.on('data', (d) => { stdoutBuffer += d.toString(); });

            const timer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
                resolve({
                    success: false,
                    output: `Execution timed out after ${this.timeoutMs}ms.\n${stdoutBuffer}`
                });
            }, this.timeoutMs);

            child.on('exit', (code) => {
                clearTimeout(timer);
                try { fs.unlinkSync(briefFile); } catch {}
                resolve({
                    success: code === 0,
                    output: stdoutBuffer.trim() || `Job finished with exit code ${code}`
                });
            });
        });
    }

    private resolveSharkCli(): string {
        const root = this.projectRoot;
        const candidateDist = path.resolve(root, 'dist', 'bin', 'shark.js');
        if (fs.existsSync(candidateDist)) return candidateDist;
        return path.resolve(root, 'node_modules', '.bin', 'shark');
    }

    private saveOutputFile(jobId: string, output: string): string {
        const outputDir = this.storage.getOutputDir();
        const fileName = `${jobId}-${Date.now()}.md`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, output, 'utf-8');
        return filePath;
    }
}
```

- [ ] **Step 4: Update `src/core/cron/index.ts`**

```typescript
export * from './cron-types.js';
export * from './cron-storage.js';
export * from './cron-scheduler.js';
export * from './cron-executor.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/cron/cron-executor.test.ts`
Expected: PASS (3 tests passing)

- [ ] **Step 6: Commit**

```bash
git add src/core/cron/cron-executor.ts src/core/cron/cron-executor.test.ts src/core/cron/index.ts
git commit -m "feat(cron): add subprocess and script executor with watchdog and diff monitor"
```

---

### Task 5: Cron Tool Handler & Action Validation

**Files:**
- Create: `src/core/cron/cron-tool-handler.ts`
- Test: `src/core/cron/cron-tool-handler.test.ts`

**Interfaces:**
- Consumes: `CronStorage`, `CronScheduler`, `CronToolArgs` from `src/core/cron/`
- Produces: `CronToolHandler` with `handleAction(args: CronToolArgs): Promise<CronToolResult>`

- [ ] **Step 1: Write failing test in `src/core/cron/cron-tool-handler.test.ts`**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-tool-handler.test.ts`
Expected: FAIL (Cannot find module `./cron-tool-handler.js`)

- [ ] **Step 3: Write implementation in `src/core/cron/cron-tool-handler.ts`**

```typescript
import * as crypto from 'node:crypto';
import { CronStorage } from './cron-storage.js';
import { CronScheduler, calculateNextRunAt } from './cron-scheduler.js';
import type { CronToolArgs, CronToolResult, CronJob } from './cron-types.js';

export interface CronToolHandlerOptions {
    storage?: CronStorage;
    scheduler?: CronScheduler;
}

export class CronToolHandler {
    private storage: CronStorage;
    private scheduler?: CronScheduler;

    constructor(options: CronToolHandlerOptions = {}) {
        this.storage = options.storage || new CronStorage();
        this.scheduler = options.scheduler;
    }

    public async handleAction(args: CronToolArgs): Promise<CronToolResult> {
        // Recursion guard
        if (process.env.SHARK_CRON_EXECUTION === 'true') {
            return {
                success: false,
                message: 'Action blocked: Scheduled cronjobs cannot create or modify cronjobs recursively.'
            };
        }

        switch (args.action) {
            case 'create': return this.createJob(args);
            case 'list': return this.listJobs();
            case 'update': return this.updateJob(args);
            case 'pause': return this.pauseJob(args.id);
            case 'resume': return this.resumeJob(args.id);
            case 'run': return this.forceRunJob(args.id);
            case 'remove': return this.removeJob(args.id);
            default:
                return { success: false, message: `Unknown cron action: ${args.action}` };
        }
    }

    private async createJob(args: CronToolArgs): Promise<CronToolResult> {
        if (!args.schedule) {
            return { success: false, message: 'Parameter "schedule" is required for create action.' };
        }
        if (args.no_agent && !args.script) {
            return { success: false, message: 'Parameter "script" is required when no_agent is true.' };
        }
        if (!args.no_agent && !args.prompt && !args.script) {
            return { success: false, message: 'Either "prompt" or "script" must be provided.' };
        }

        const now = Date.now();
        const nextRunAt = calculateNextRunAt(args.schedule, now);
        const jobId = `job-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

        const newJob: CronJob = {
            id: jobId,
            name: args.name,
            schedule: args.schedule,
            status: 'scheduled',
            prompt: args.prompt,
            script: args.script,
            monitor_script: args.monitor_script,
            no_agent: args.no_agent,
            skills: args.skills,
            deliver: args.deliver || 'origin',
            created_at: now,
            next_run_at: nextRunAt,
            run_count: 0
        };

        const db = this.storage.loadDatabase();
        db.jobs[jobId] = newJob;
        this.storage.saveDatabase(db);

        const isSchedulerRunning = this.scheduler ? this.scheduler.isRunning() : false;

        return {
            success: true,
            message: `Cronjob '${jobId}' created successfully. Next run: ${new Date(nextRunAt).toISOString()}`,
            scheduler_running: isSchedulerRunning,
            job: newJob
        };
    }

    private async listJobs(): Promise<CronToolResult> {
        const db = this.storage.loadDatabase();
        const jobs = Object.values(db.jobs);
        return {
            success: true,
            message: `Found ${jobs.length} registered jobs.`,
            count: jobs.length,
            jobs
        };
    }

    private async updateJob(args: CronToolArgs): Promise<CronToolResult> {
        if (!args.id) return { success: false, message: 'Parameter "id" is required for update.' };
        const db = this.storage.loadDatabase();
        const job = db.jobs[args.id];
        if (!job) return { success: false, message: `Job '${args.id}' not found.` };

        if (args.schedule) {
            job.schedule = args.schedule;
            job.next_run_at = calculateNextRunAt(args.schedule);
        }
        if (args.prompt !== undefined) job.prompt = args.prompt;
        if (args.script !== undefined) job.script = args.script;
        if (args.monitor_script !== undefined) job.monitor_script = args.monitor_script;
        if (args.skills !== undefined) job.skills = args.skills;
        if (args.deliver !== undefined) job.deliver = args.deliver;

        this.storage.saveDatabase(db);
        return { success: true, message: `Job '${args.id}' updated.`, job };
    }

    private async pauseJob(id?: string): Promise<CronToolResult> {
        if (!id) return { success: false, message: 'Parameter "id" is required for pause.' };
        const db = this.storage.loadDatabase();
        const job = db.jobs[id];
        if (!job) return { success: false, message: `Job '${id}' not found.` };

        job.status = 'paused';
        this.storage.saveDatabase(db);
        return { success: true, message: `Job '${id}' paused.`, job };
    }

    private async resumeJob(id?: string): Promise<CronToolResult> {
        if (!id) return { success: false, message: 'Parameter "id" is required for resume.' };
        const db = this.storage.loadDatabase();
        const job = db.jobs[id];
        if (!job) return { success: false, message: `Job '${id}' not found.` };

        job.status = 'scheduled';
        job.next_run_at = calculateNextRunAt(job.schedule);
        this.storage.saveDatabase(db);
        return { success: true, message: `Job '${id}' resumed. Next run: ${new Date(job.next_run_at).toISOString()}`, job };
    }

    private async forceRunJob(id?: string): Promise<CronToolResult> {
        if (!id) return { success: false, message: 'Parameter "id" is required for run.' };
        const db = this.storage.loadDatabase();
        const job = db.jobs[id];
        if (!job) return { success: false, message: `Job '${id}' not found.` };

        job.next_run_at = Date.now() - 1000;
        job.status = 'scheduled';
        this.storage.saveDatabase(db);

        if (this.scheduler) {
            this.scheduler.tick().catch(() => {});
        }

        return { success: true, message: `Job '${id}' triggered for immediate execution.`, job };
    }

    private async removeJob(id?: string): Promise<CronToolResult> {
        if (!id) return { success: false, message: 'Parameter "id" is required for remove.' };
        const db = this.storage.loadDatabase();
        if (!db.jobs[id]) return { success: false, message: `Job '${id}' not found.` };

        delete db.jobs[id];
        this.storage.saveDatabase(db);
        return { success: true, message: `Job '${id}' permanently removed.` };
    }
}
```

- [ ] **Step 4: Update `src/core/cron/index.ts`**

```typescript
export * from './cron-types.js';
export * from './cron-storage.js';
export * from './cron-scheduler.js';
export * from './cron-executor.js';
export * from './cron-tool-handler.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/core/cron/cron-tool-handler.test.ts`
Expected: PASS (5 tests passing)

- [ ] **Step 6: Commit**

```bash
git add src/core/cron/cron-tool-handler.ts src/core/cron/cron-tool-handler.test.ts src/core/cron/index.ts
git commit -m "feat(cron): add tool handler with parameter validation and recursion guards"
```

---

### Task 6: Prompt & Schema Registration

**Files:**
- Modify: `src/core/api/prompts.ts`
- Test: `src/commands/export-schema.test.ts`

**Interfaces:**
- Consumes: `defineAction`, `COORDINATOR_ACTION_SCHEMAS`, `buildUnifiedSystemPrompt`
- Produces: `cronjob` action schema in coordinator schemas and prompt instructions

- [ ] **Step 1: Check existing schema tests**

Run: `npx vitest run src/commands/export-schema.test.ts`
Expected: PASS

- [ ] **Step 2: Add `cronjob` section to `buildUnifiedSystemPrompt` in `src/core/api/prompts.ts`**

In `src/core/api/prompts.ts`, add the section before `SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:`:
```typescript
🕒 AGENDAMENTO DE TAREFAS AUTÔNOMAS ('cronjob'):
- Para criar rotinas, lembretes, monitoramentos e tarefas recorrentes que executam em segundo plano, utilize a ação 'cronjob'.
- PARÂMETROS DE 'cronjob':
  - action: 'create' | 'list' | 'update' | 'pause' | 'resume' | 'run' | 'remove'
  - schedule: '30m' (relativo), 'every 2h' (intervalo), '0 9 * * *' (cron), ou data ISO '2026-10-15T10:00:00Z'
  - prompt: 'instrução técnica auto-contida para execução com LLM'
  - script: 'comando a ser executado diretamente' (obrigatório se no_agent: true)
  - monitor_script: 'script de pré-coleta; acorda a LLM apenas quando a saída alterar'
  - deliver: 'origin' (devolve onde foi criado), 'local' (salva silenciosamente em arquivo markdown), ou canal nomeado
- SUPRESSÃO SILENCIOSA COM '[SILENT]': Se a resposta do job contiver o token '[SILENT]', nenhuma notificação externa é emitida.
```

- [ ] **Step 3: Register `defineAction("cronjob", ...)` in `COORDINATOR_ACTION_SCHEMAS`**

In `src/core/api/prompts.ts`, add:
```typescript
  defineAction("cronjob", {
    action: { type: "string", enum: ["create", "list", "update", "pause", "resume", "run", "remove"] },
    id: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    schedule: { type: ["string", "null"] },
    prompt: { type: ["string", "null"] },
    script: { type: ["string", "null"] },
    monitor_script: { type: ["string", "null"] },
    no_agent: { type: ["boolean", "null"] },
    skills: { type: ["array", "null"], items: { type: "string" } },
    deliver: { type: ["string", "null"] }
  }),
```
And add `"cronjob"` to the action enum in `buildUnifiedSystemPrompt`:
`"type": "create_file" | ... | "cronjob"`

- [ ] **Step 4: Run export-schema tests to verify validity**

Run: `npx vitest run src/commands/export-schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/prompts.ts
git commit -m "feat(cron): register cronjob action in prompts and coordinator json schema"
```

---

### Task 7: CLI `--skip-memory` flag and Memory Isolation

**Files:**
- Modify: `src/commands/dev.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/engine/agent-action-executor.ts`

**Interfaces:**
- Consumes: Commander options in `dev.ts`
- Produces: `skipMemory` boolean passed to `interactiveDeveloperAgent` and `AgentActionExecutor`

- [ ] **Step 1: Add `--skip-memory` option in `src/commands/dev.ts`**

```typescript
    .option('--skip-memory', 'Skip persistent memory modifications during task execution', false)
```
Pass `skipMemory: options.skipMemory` to `interactiveDeveloperAgent`.

- [ ] **Step 2: Update `DeveloperAgentOptions` in `src/core/agents/developer-agent.ts`**

Add `skipMemory?: boolean` to `DeveloperAgentOptions` and pass it to `AgentEngine` constructor and options.

- [ ] **Step 3: Honor `skipMemory` in `src/core/engine/agent-action-executor.ts`**

In `executeAction(action)` for `memory` action:
```typescript
if (this.skipMemory) {
    return {
        success: true,
        message: 'Aviso: Escrita em memória persistente ignorada (skip_memory ativo nesta sessão).'
    };
}
```

- [ ] **Step 4: Run dev tests**

Run: `npx vitest run src/commands/dev.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/dev.ts src/core/agents/developer-agent.ts src/core/engine/agent-action-executor.ts
git commit -m "feat(cron): add --skip-memory flag and memory isolation"
```

---

### Task 8: Engine Integration & Delivery Router

**Files:**
- Modify: `src/core/engine/agent-action-executor.ts`
- Modify: `src/core/engine/agent-engine.ts`
- Test: `src/core/engine/agent-action-executor.test.ts`

**Interfaces:**
- Consumes: `CronToolHandler`, `CronScheduler`, `CronExecutor`
- Produces: Seamless execution of `cronjob` from LLM responses and delivery routing to adapters

- [ ] **Step 1: Write integration test in `src/core/engine/agent-action-executor.test.ts`**

```typescript
it('should execute cronjob tool action successfully', async () => {
    const executor = new AgentActionExecutor({
        projectRoot: testDir
    });
    const result = await executor.executeAction({
        type: 'cronjob',
        args: {
            action: 'create',
            schedule: 'every 1h',
            prompt: 'monitor server'
        }
    });

    expect(result.success).toBe(true);
    expect(result.job).toBeDefined();
    expect(result.job.schedule).toBe('every 1h');
});
```

- [ ] **Step 2: Integrate `CronToolHandler` and `CronScheduler` into `AgentEngine`**

In `src/core/engine/agent-engine.ts`:
- Instantiate `CronStorage`, `CronScheduler`, `CronExecutor`, and `CronToolHandler` per session/project.
- Connect the scheduler dispatcher to `CronExecutor.execute(job)`.
- Connect the output delivery to registered adapters matching `job.origin_channel` or `job.deliver`.
- In `runInteractive()`, start `cronScheduler.start()` and stop on termination.

- [ ] **Step 3: Connect `cronjob` in `AgentActionExecutor.ts`**

In `executeAction(action)`:
```typescript
if (action.type === 'cronjob') {
    return await this.cronToolHandler.handleAction(action.args);
}
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS with zero regressions

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/agent-engine.ts src/core/engine/agent-action-executor.ts src/core/engine/agent-action-executor.test.ts
git commit -m "feat(cron): integrate cron scheduler and tool handler into AgentEngine"
```
