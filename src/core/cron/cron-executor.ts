import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { exec, fork } from 'node:child_process';
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
