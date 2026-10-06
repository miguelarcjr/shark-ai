import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { execa, type ExecaChildProcess } from 'execa';

const execAsync = promisify(exec);

export interface ManagedProcessInfo {
    id: string;
    pid: number;
    command: string;
    status: 'running' | 'completed' | 'failed' | 'killed';
    startTime: number;
    endTime?: number;
    exitCode?: number | null;
    logPath: string;
    totalLines: number;
    sessionId: string;
}

export interface SpawnProcessOptions {
    sessionId?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    watchPatterns?: string[];
    notifyOnComplete?: boolean;
    onWatchPatternMatched?: (pattern: string, line: string) => void;
    onExit?: (info: ManagedProcessInfo) => void;
}

interface ActiveProcessRecord {
    info: ManagedProcessInfo;
    child: ExecaChildProcess;
    logStream: fs.WriteStream;
    unreadOffset: number; // in lines
    lineBuffer: string; // for incomplete line chunks
    watchPatterns?: string[];
    onWatchPatternMatched?: (pattern: string, line: string) => void;
    onExit?: (info: ManagedProcessInfo) => void;
    notifyOnComplete?: boolean;
}

export class ProcessManager {
    private static instance: ProcessManager | null = null;
    private processes: Map<string, ActiveProcessRecord> = new Map();
    private nextId: number = 1;
    private messageQueue?: any; // MessageQueue instance

    constructor() {
        this.registerGlobalHooks();
    }

    public static getInstance(): ProcessManager {
        if (!ProcessManager.instance) {
            ProcessManager.instance = new ProcessManager();
        }
        return ProcessManager.instance;
    }

    public setMessageQueue(queue: any): void {
        this.messageQueue = queue;
    }

    public async spawn(command: string, options?: SpawnProcessOptions): Promise<ManagedProcessInfo> {
        const sessionId = options?.sessionId || 'default';
        const procId = `proc_${this.nextId++}`;
        const cwd = options?.cwd || process.cwd();

        const logDir = path.resolve(cwd, '.shark', 'processes', sessionId);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logPath = path.resolve(logDir, `${procId}.log`);
        if (!fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '', { encoding: 'utf-8' });
        }
        const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });

        const isWindows = process.platform === 'win32';
        const shell = isWindows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || 'sh');

        const child = execa(command, {
            shell: true,
            cwd,
            env: options?.env || process.env,
            reject: false,
            all: true,
            buffer: false
        });

        const pid = child.pid || 0;

        const info: ManagedProcessInfo = {
            id: procId,
            pid,
            command,
            status: 'running',
            startTime: Date.now(),
            logPath,
            totalLines: 0,
            sessionId
        };

        const record: ActiveProcessRecord = {
            info,
            child,
            logStream,
            unreadOffset: 0,
            lineBuffer: '',
            watchPatterns: options?.watchPatterns,
            onWatchPatternMatched: options?.onWatchPatternMatched,
            onExit: options?.onExit,
            notifyOnComplete: options?.notifyOnComplete !== false
        };

        this.processes.set(procId, record);

        // Process stdout/stderr output stream
        if (child.all) {
            child.all.on('data', (chunk: Buffer | string) => {
                const text = chunk.toString();
                try {
                    fs.appendFileSync(logPath, text);
                } catch {
                    // ignore
                }
                this.processIncomingChunk(record, text);
            });
        }

        // Process exit handling
        child.on('close', (code, signal) => {
            logStream.end();
            if (record.lineBuffer.trim().length > 0) {
                record.info.totalLines++;
                record.lineBuffer = '';
            }

            record.info.endTime = Date.now();
            record.info.exitCode = code;

            if (record.info.status !== 'killed') {
                record.info.status = code === 0 ? 'completed' : 'failed';
            }

            if (record.onExit) {
                record.onExit(record.info);
            }

            if (record.notifyOnComplete && this.messageQueue) {
                const durationSec = Math.max(1, Math.round(((record.info.endTime || Date.now()) - record.info.startTime) / 1000));
                this.messageQueue.push({
                    type: 'process_notification',
                    content: `[Process '${record.info.id}' ('${record.info.command}') exited with code ${code ?? signal} after ${durationSec}s. Total lines logged: ${record.info.totalLines}]`,
                    timestamp: Date.now(),
                    metadata: {
                        processId: record.info.id,
                        exitCode: code ?? -1,
                        status: record.info.status
                    }
                });
            }
        });

        return info;
    }

    private processIncomingChunk(record: ActiveProcessRecord, chunk: string): void {
        record.lineBuffer += chunk;
        const lines = record.lineBuffer.split('\n');

        // Keep last incomplete piece in lineBuffer
        record.lineBuffer = lines.pop() || '';

        for (const line of lines) {
            record.info.totalLines++;
            const cleanLine = line.replace(/\r$/, '');

            if (record.watchPatterns && record.watchPatterns.length > 0) {
                for (const pattern of record.watchPatterns) {
                    try {
                        const regex = new RegExp(pattern, 'i');
                        if (regex.test(cleanLine)) {
                            if (record.onWatchPatternMatched) {
                                record.onWatchPatternMatched(pattern, cleanLine);
                            }
                            if (this.messageQueue) {
                                this.messageQueue.push({
                                    type: 'process_notification',
                                    content: `[Watch pattern matched on process '${record.info.id}']: "${pattern}" -> "${cleanLine}"`,
                                    timestamp: Date.now(),
                                    metadata: {
                                        processId: record.info.id,
                                        pattern,
                                        matchedLine: cleanLine
                                    }
                                });
                            }
                            break;
                        }
                    } catch {
                        // ignore malformed regex
                    }
                }
            }
        }
    }

    public list(sessionId?: string): ManagedProcessInfo[] {
        const results: ManagedProcessInfo[] = [];
        for (const record of this.processes.values()) {
            if (!sessionId || record.info.sessionId === sessionId) {
                results.push({ ...record.info });
            }
        }
        return results;
    }

    public get(id: string): ManagedProcessInfo | undefined {
        const record = this.processes.get(id);
        return record ? { ...record.info } : undefined;
    }

    public async poll(id: string): Promise<{ process: ManagedProcessInfo; newLines: string[]; offset: number }> {
        const record = this.processes.get(id);
        if (!record) {
            throw new Error(`Process with id '${id}' not found.`);
        }

        const lines = await this.readLinesFromFile(record.info.logPath);
        const start = record.unreadOffset;
        const newLines = lines.slice(start);
        record.unreadOffset = lines.length;

        return {
            process: { ...record.info },
            newLines,
            offset: start
        };
    }

    public async getLogs(
        id: string,
        options?: { offset?: number; lines?: number }
    ): Promise<{ process: ManagedProcessInfo; lines: string[]; totalLines: number; offset: number }> {
        const record = this.processes.get(id);
        if (!record) {
            throw new Error(`Process with id '${id}' not found.`);
        }

        const allLines = await this.readLinesFromFile(record.info.logPath);
        const totalLines = allLines.length;

        const maxLines = Math.min(options?.lines || 50, 500);
        let start = options?.offset !== undefined ? options.offset : Math.max(0, totalLines - maxLines);
        if (start < 0) start = 0;
        const end = Math.min(start + maxLines, totalLines);

        const sliced = allLines.slice(start, end);

        return {
            process: { ...record.info },
            lines: sliced,
            totalLines,
            offset: start
        };
    }

    public setNotifyOnComplete(id: string, notify: boolean): void {
        const record = this.processes.get(id);
        if (record) {
            record.notifyOnComplete = notify;
        }
    }

    public async write(id: string, data: string): Promise<void> {
        const record = this.processes.get(id);
        if (!record) {
            throw new Error(`Process with id '${id}' not found.`);
        }

        if (record.info.status !== 'running') {
            throw new Error(`Process '${id}' is not running (status: ${record.info.status}).`);
        }

        if (!record.child.stdin) {
            throw new Error(`Process '${id}' has no writable stdin.`);
        }

        const payload = data.endsWith('\n') ? data : data + '\n';
        record.child.stdin.write(payload);
    }

    public async kill(id: string): Promise<boolean> {
        const record = this.processes.get(id);
        if (!record) return false;

        if (record.info.status !== 'running') {
            return false;
        }

        record.info.status = 'killed';
        record.info.endTime = Date.now();

        await this.terminateProcessTree(record.info.pid);
        return true;
    }

    public async killAll(): Promise<void> {
        for (const [id, record] of this.processes.entries()) {
            if (record.info.status === 'running') {
                record.info.status = 'killed';
                record.info.endTime = Date.now();
                await this.terminateProcessTree(record.info.pid);
            }
        }
    }

    private async terminateProcessTree(pid: number): Promise<void> {
        if (!pid || pid <= 0) return;

        try {
            if (process.platform === 'win32') {
                await execAsync(`taskkill /pid ${pid} /T /F`).catch(() => {});
            } else {
                try {
                    process.kill(-pid, 'SIGKILL');
                } catch {
                    process.kill(pid, 'SIGKILL');
                }
            }
        } catch {
            // Ignore termination errors if process already exited
        }
    }

    private async readLinesFromFile(filePath: string): Promise<string[]> {
        if (!fs.existsSync(filePath)) return [];
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            if (!content) return [];
            const lines = content.split(/\r?\n/);
            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines.pop();
            }
            return lines;
        } catch {
            return [];
        }
    }

    private registerGlobalHooks(): void {
        const shutdown = () => {
            this.killAll().catch(() => {});
        };

        process.once('exit', shutdown);
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    }
}
