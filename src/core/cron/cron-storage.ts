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
        } catch {
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

    public async withLock<T>(action: () => Promise<T> | T, retries = 10, retryDelayMs = 25): Promise<T | null> {
        for (let i = 0; i <= retries; i++) {
            if (this.acquireLock()) {
                try {
                    return await action();
                } finally {
                    this.releaseLock();
                }
            }
            if (i < retries) {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
        return null;
    }

    public getOutputDir(): string {
        return path.join(this.cronDir, 'output');
    }

    public getTasksDir(): string {
        return path.join(this.cronDir, 'tasks');
    }

    public getCronDir(): string {
        return this.cronDir;
    }

    public getDbPath(): string {
        return this.dbPath;
    }
}
