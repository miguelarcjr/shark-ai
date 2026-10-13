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
    cleanOutput?: string;
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
        const effectiveRoot = job.project_root || this.projectRoot;
        if (job.monitor_script) {
            const monitorResult = await this.executeScriptCommand(job.monitor_script, effectiveRoot);
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
            const scriptResult = await this.executeScriptCommand(job.script, effectiveRoot);
            const isSilent = isExecutionSilent(scriptResult.output);
            const cleanOutput = extractCleanFinalResponse(scriptResult.output);
            const savedPath = this.saveOutputFile(job.id, scriptResult.output, job.project_root);
            job.last_output_file = savedPath;
            return {
                success: scriptResult.success,
                output: scriptResult.output,
                cleanOutput,
                silent: isSilent,
                outputFilePath: savedPath,
                diffDetected: true
            };
        }

        // 3. Pre-run script execution if script is defined and no_agent is false
        let preScriptOutput: string | undefined;
        if (job.script && !job.no_agent) {
            const scriptResult = await this.executeScriptCommand(job.script, effectiveRoot);
            preScriptOutput = scriptResult.output;
        }

        // 4. Agent-backed execution (fresh session subprocess)
        const agentResult = await this.executeAgentSubprocess(job, effectiveRoot, preScriptOutput);
        job.last_output_file = agentResult.outputFilePath;

        return agentResult;
    }

    public buildTaskBriefContent(job: CronJob, preScriptOutput?: string): string {
        let content = `# Scheduled Cron Task: ${job.name || job.id}\n\n`;
        content += `[IMPORTANT: You are running as a scheduled cron job.\n`;
        content += `DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest.\n`;
        content += `SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]" (nothing else) to suppress delivery. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more.\n`;
        content += `AUTONOMY: Do not ask questions or prompt the user for confirmation; complete the required task autonomously.]\n\n`;

        if (job.skills && job.skills.length > 0) {
            content += `> Injected Skills: ${job.skills.join(', ')}\n\n`;
        }

        if (preScriptOutput && preScriptOutput.trim()) {
            content += `## Dados Coletados pelo Script de Monitoramento / Pré-Execução:\n\`\`\`\n${preScriptOutput.trim()}\n\`\`\`\n\n`;
        }

        content += `## Instrução da Tarefa:\n${job.prompt || 'Execute scheduled maintenance.'}\n`;
        return content;
    }

    private executeScriptCommand(command: string, cwd: string = this.projectRoot): Promise<{ success: boolean; output: string }> {
        return new Promise((resolve) => {
            exec(command, { cwd, timeout: this.timeoutMs }, (err, stdout, stderr) => {
                const output = (stdout || '') + (stderr ? `\n${stderr}` : '');
                resolve({
                    success: !err,
                    output: output.trim()
                });
            });
        });
    }

    private async executeAgentSubprocess(job: CronJob, cwd: string = this.projectRoot, preScriptOutput?: string): Promise<ExecutorRunResult> {
        const tasksDir = job.project_root
            ? path.join(job.project_root, '.shark', 'cron', 'tasks')
            : this.storage.getTasksDir();
        if (!fs.existsSync(tasksDir)) {
            try { fs.mkdirSync(tasksDir, { recursive: true }); } catch {}
        }
        const briefFile = path.join(tasksDir, `task-${job.id}-${Date.now()}.md`);
        const resultFile = path.join(tasksDir, `result-${job.id}-${Date.now()}.json`);

        const briefContent = this.buildTaskBriefContent(job, preScriptOutput);
        fs.writeFileSync(briefFile, briefContent, 'utf-8');

        const cliPath = this.resolveSharkCli();
        const args = ['dev', '--task-file', briefFile, '--taskId', `cron-${job.id}`, '--auto', '--skip-memory', '--result-file', resultFile];

        const outputDir = job.project_root
            ? path.join(job.project_root, '.shark', 'cron', 'output')
            : this.storage.getOutputDir();
        if (!fs.existsSync(outputDir)) {
            try { fs.mkdirSync(outputDir, { recursive: true }); } catch {}
        }
        const consoleLogFile = path.join(outputDir, `${job.id}-${Date.now()}-console.log`);
        const logStream = fs.createWriteStream(consoleLogFile, { flags: 'a' });

        return new Promise((resolve) => {
            let ipcSummary: string | undefined;
            let ipcSuccess: boolean | undefined;

            const child = fork(cliPath, args, {
                cwd,
                silent: true,
                env: {
                    ...process.env,
                    SHARK_CRON_EXECUTION: 'true'
                }
            });

            if (child.stdout) child.stdout.pipe(logStream);
            if (child.stderr) child.stderr.pipe(logStream);

            child.on('message', (msg: any) => {
                if (msg && msg.type === 'cron_completion') {
                    ipcSummary = msg.summary;
                    ipcSuccess = msg.success;
                }
            });

            const timer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
                logStream.end();
                try { fs.unlinkSync(briefFile); } catch {}
                try { fs.unlinkSync(resultFile); } catch {}
                resolve({
                    success: false,
                    output: `Execution timed out after ${this.timeoutMs}ms.`,
                    cleanOutput: `Execution timed out after ${this.timeoutMs}ms.`,
                    silent: false,
                    outputFilePath: consoleLogFile,
                    diffDetected: true
                });
            }, this.timeoutMs);

            child.on('exit', (code) => {
                clearTimeout(timer);
                logStream.end();
                try { fs.unlinkSync(briefFile); } catch {}

                let finalSummary = ipcSummary;
                let finalSuccess = ipcSuccess !== undefined ? ipcSuccess : (code === 0);

                if (!finalSummary && fs.existsSync(resultFile)) {
                    try {
                        const fileData = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
                        finalSummary = fileData.summary;
                        if (fileData.success !== undefined) finalSuccess = fileData.success;
                    } catch {}
                }
                try { fs.unlinkSync(resultFile); } catch {}

                if (!finalSummary && fs.existsSync(consoleLogFile)) {
                    try {
                        const rawLogs = fs.readFileSync(consoleLogFile, 'utf-8');
                        if (rawLogs.trim()) {
                            finalSummary = extractCleanFinalResponse(rawLogs);
                        }
                    } catch {}
                }

                const resolvedOutput = finalSummary || (code === 0 ? 'Cron task completed successfully.' : `Cron task finished with exit code ${code}`);

                resolve({
                    success: finalSuccess,
                    output: resolvedOutput,
                    cleanOutput: resolvedOutput,
                    silent: isExecutionSilent(resolvedOutput),
                    outputFilePath: consoleLogFile,
                    diffDetected: true
                });
            });
        });
    }

    private resolveSharkCli(): string {
        if (process.argv[1] && fs.existsSync(process.argv[1]) && process.argv[1].endsWith('shark.js')) {
            return process.argv[1];
        }

        const findSharkInAncestors = (startDir: string): string | null => {
            let cur = path.resolve(startDir);
            while (cur && cur !== path.dirname(cur)) {
                const target = path.join(cur, 'dist', 'bin', 'shark.js');
                if (fs.existsSync(target)) return target;
                cur = path.dirname(cur);
            }
            return null;
        };

        // 1. Tenta a partir do módulo atual (import.meta.url)
        try {
            const thisDir = path.dirname(fileURLToPath(import.meta.url));
            const foundFromMeta = findSharkInAncestors(thisDir);
            if (foundFromMeta) return foundFromMeta;
        } catch {}

        // 2. Tenta a partir do projectRoot
        const foundFromRoot = findSharkInAncestors(this.projectRoot);
        if (foundFromRoot) return foundFromRoot;

        // 3. Tenta a partir do process.cwd()
        const foundFromCwd = findSharkInAncestors(process.cwd());
        if (foundFromCwd) return foundFromCwd;

        return path.resolve(this.projectRoot, 'node_modules', '.bin', 'shark');
    }

    private saveOutputFile(jobId: string, output: string, projectRoot?: string): string {
        let outputDir = this.storage.getOutputDir();
        if (projectRoot) {
            outputDir = path.join(projectRoot, '.shark', 'cron', 'output');
            if (!fs.existsSync(outputDir)) {
                try {
                    fs.mkdirSync(outputDir, { recursive: true });
                } catch {}
            }
        }
        const fileName = `${jobId}-${Date.now()}.md`;
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, output, 'utf-8');
        return filePath;
    }
}

export function isExecutionSilent(output: string): boolean {
    const trimmed = output.trim();
    if (trimmed === '[SILENT]' || /^\s*\[SILENT\]\s*$/i.test(trimmed)) {
        return true;
    }
    const devMatch = output.match(/🤖\s*Shark\s*Dev:\s*([\s\S]*?)(?:\[SUCCESS\]|\n\n\[|$)/i);
    if (devMatch && devMatch[1]) {
        const botText = devMatch[1].trim();
        if (botText === '[SILENT]' || /^\s*\[SILENT\]\s*$/i.test(botText)) {
            return true;
        }
    }
    const completedMatch = output.match(/Task Completed:\s*(.*)/i);
    if (completedMatch && completedMatch[1]) {
        const completedText = completedMatch[1].trim();
        if (completedText === '[SILENT]' || /^\s*\[SILENT\]\s*$/i.test(completedText)) {
            return true;
        }
    }
    return false;
}

export function extractCleanFinalResponse(output: string): string {
    // 1. Remove códigos de escape ANSI
    const noAnsi = output.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // 2. Tenta capturar o bloco final após "🤖 Shark Dev:" e antes de "[SUCCESS]"
    const devMatch = noAnsi.match(/🤖\s*Shark\s*Dev:\s*([\s\S]*?)(?:\[SUCCESS\]|\n\n\[|$)/i);
    if (devMatch && devMatch[1] && devMatch[1].trim()) {
        return devMatch[1].trim();
    }

    // 3. Tenta capturar do resumo de conclusão "Task Completed:"
    const completedMatch = noAnsi.match(/Task Completed:\s*(.*)/i);
    if (completedMatch && completedMatch[1] && completedMatch[1].trim()) {
        return completedMatch[1].trim();
    }

    // 4. Fallback: filtra linhas de sistema, warnings de runtime e tags de progresso
    const cleanLines = noAnsi
        .split('\n')
        .filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('(node:') || trimmed.startsWith('(Use `node')) return false;
            if (trimmed.startsWith('[START]') || trimmed.startsWith('[DONE]') || trimmed.startsWith('[INFO]')) return false;
            if (trimmed.startsWith('[SUCCESS]')) return false;
            return true;
        })
        .join('\n')
        .trim();

    return cleanLines || noAnsi.trim();
}

