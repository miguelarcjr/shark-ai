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
        if (fields[0].startsWith('*/')) {
            const stepMinutes = parseInt(fields[0].replace('*/', ''), 10) || 15;
            return fromTimestamp + stepMinutes * 60 * 1000;
        }
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
