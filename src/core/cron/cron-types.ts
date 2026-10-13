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
    attach_to_session?: boolean;
    origin_channel?: string;
    origin_recipient_id?: string;
    created_at: number;
    next_run_at: number;
    last_run_at?: number;
    run_count: number;
    catch_up_occurrences?: number;
    last_status?: string;
    last_output_file?: string;
    project_root?: string;
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
    attach_to_session?: boolean;
}

export interface CronToolResult {
    success: boolean;
    message: string;
    scheduler_running?: boolean;
    job?: CronJob;
    jobs?: CronJob[];
    count?: number;
}
