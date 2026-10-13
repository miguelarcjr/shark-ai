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

function parseCronField(field: string, min: number, max: number): Set<number> {
    const values = new Set<number>();
    const parts = field.split(',');
    for (const part of parts) {
        if (part === '*') {
            for (let i = min; i <= max; i++) values.add(i);
        } else if (part.startsWith('*/')) {
            const step = parseInt(part.slice(2), 10) || 1;
            for (let i = min; i <= max; i += step) values.add(i);
        } else if (part.includes('-')) {
            const [startStr, endStr] = part.split('-');
            const start = parseInt(startStr, 10);
            const end = parseInt(endStr, 10);
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = Math.max(min, start); i <= Math.min(max, end); i++) {
                    values.add(i);
                }
            }
        } else {
            const val = parseInt(part, 10);
            if (!isNaN(val) && val >= min && val <= max) {
                values.add(val);
            }
        }
    }
    return values;
}

function calculateNextCronOccurrence(expression: string, fromTimestamp: number): number {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) {
        return fromTimestamp + 3600 * 1000;
    }

    const minutes = parseCronField(fields[0], 0, 59);
    const hours = parseCronField(fields[1], 0, 23);
    const doms = parseCronField(fields[2], 1, 31);
    const months = parseCronField(fields[3], 1, 12);
    const dows = parseCronField(fields[4], 0, 7);
    if (dows.has(7)) dows.add(0);

    const next = new Date(fromTimestamp);
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() + 1);

    const maxIterations = 525600;
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations++;

        if (!months.has(next.getMonth() + 1)) {
            next.setMonth(next.getMonth() + 1, 1);
            next.setHours(0, 0, 0, 0);
            continue;
        }

        const isDomMatch = doms.has(next.getDate());
        const isDowMatch = dows.has(next.getDay());

        const domWild = fields[2] === '*';
        const dowWild = fields[4] === '*';

        let dayMatch = false;
        if (domWild && dowWild) {
            dayMatch = true;
        } else if (!domWild && !dowWild) {
            dayMatch = isDomMatch || isDowMatch;
        } else if (!domWild) {
            dayMatch = isDomMatch;
        } else {
            dayMatch = isDowMatch;
        }

        if (!dayMatch) {
            next.setDate(next.getDate() + 1);
            next.setHours(0, 0, 0, 0);
            continue;
        }

        if (!hours.has(next.getHours())) {
            next.setHours(next.getHours() + 1, 0, 0, 0);
            continue;
        }

        if (!minutes.has(next.getMinutes())) {
            next.setMinutes(next.getMinutes() + 1, 0, 0);
            continue;
        }

        return next.getTime();
    }

    return fromTimestamp + 3600 * 1000;
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

    // 3. Standard 5-field cron syntax
    const fields = trimmed.split(/\s+/);
    if (fields.length === 5) {
        return calculateNextCronOccurrence(trimmed, fromTimestamp);
    }

    // 4. ISO timestamp
    const parsedDate = Date.parse(trimmed);
    if (!isNaN(parsedDate)) {
        return parsedDate;
    }

    // Default fallback: 1 hour from now
    return fromTimestamp + 3600 * 1000;
}

export interface CronSchedulerOptions {
    storage?: CronStorage;
    storageProvider?: () => CronStorage[];
    tickIntervalMs?: number;
    maxConcurrentJobs?: number;
}

export class CronScheduler {
    private storage: CronStorage;
    private storageProvider?: () => CronStorage[];
    private tickIntervalMs: number;
    private maxConcurrentJobs: number;
    private timerId: NodeJS.Timeout | null = null;
    private runningJobIds = new Set<string>();
    private jobDispatcher: ((job: CronJob) => Promise<void>) | null = null;

    constructor(options: CronSchedulerOptions = {}) {
        this.storage = options.storage || new CronStorage();
        this.storageProvider = options.storageProvider;
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

    private getStorages(): CronStorage[] {
        const list: CronStorage[] = [];
        if (this.storageProvider) {
            try {
                list.push(...this.storageProvider());
            } catch {}
        }
        if (!list.some(s => s.getDbPath() === this.storage.getDbPath())) {
            list.unshift(this.storage);
        }
        const seen = new Set<string>();
        const deduped: CronStorage[] = [];
        for (const s of list) {
            const p = s.getDbPath();
            if (!seen.has(p)) {
                seen.add(p);
                deduped.push(s);
            }
        }
        return deduped;
    }

    public async tick(): Promise<void> {
        const storages = this.getStorages();
        for (const storage of storages) {
            await this.tickStorage(storage);
        }
    }

    private async tickStorage(storage: CronStorage): Promise<void> {
        const dispatchedJobs = await storage.withLock(async () => {
            const db = storage.loadDatabase();
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

            storage.saveDatabase(db);
            return toDispatch;
        });

        // Dispatch jobs outside storage lock
        if (dispatchedJobs && dispatchedJobs.length > 0) {
            for (const job of dispatchedJobs) {
                this.executeJob(job, storage).catch(() => {});
            }
        }
    }

    private async executeJob(job: CronJob, storage: CronStorage): Promise<void> {
        try {
            if (this.jobDispatcher) {
                await this.jobDispatcher(job);
            }
        } finally {
            this.runningJobIds.delete(job.id);
            // Update job status after execution
            await storage.withLock(async () => {
                const db = storage.loadDatabase();
                const current = db.jobs[job.id];
                if (current && current.status === 'running') {
                    if (isOneShotSchedule(current.schedule)) {
                        current.status = 'completed';
                    } else {
                        current.status = 'scheduled';
                    }
                    storage.saveDatabase(db);
                }
            });
        }
    }
}
