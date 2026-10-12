import * as crypto from 'node:crypto';
import { CronStorage } from './cron-storage.js';
import { CronScheduler, calculateNextRunAt } from './cron-scheduler.js';
import type { CronToolArgs, CronToolResult, CronJob } from './cron-types.js';

export interface CronToolHandlerOptions {
    storage?: CronStorage;
    scheduler?: CronScheduler;
    originChannel?: string;
    originRecipientId?: string;
}

export class CronToolHandler {
    private storage: CronStorage;
    private scheduler?: CronScheduler;
    private originChannel?: string;
    private originRecipientId?: string;

    constructor(options: CronToolHandlerOptions = {}) {
        this.storage = options.storage || new CronStorage();
        this.scheduler = options.scheduler;
        this.originChannel = options.originChannel;
        this.originRecipientId = options.originRecipientId;
    }

    public setOrigin(originChannel?: string, originRecipientId?: string): void {
        this.originChannel = originChannel;
        this.originRecipientId = originRecipientId;
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

        const isOrigin = !args.deliver || args.deliver === 'origin';
        const attachToSession = args.attach_to_session !== undefined ? args.attach_to_session : isOrigin;

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
            attach_to_session: attachToSession,
            origin_channel: this.originChannel,
            origin_recipient_id: this.originRecipientId,
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
        if (args.attach_to_session !== undefined) job.attach_to_session = args.attach_to_session;

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
