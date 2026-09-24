import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export class SessionLeaseManager {
    private db: any;

    constructor(dbPath?: string) {
        const resolvedPath = dbPath || path.resolve(process.cwd(), '.shark', 'state.db');
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new DatabaseSync(resolvedPath);
        this.initSchema();
    }

    private initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_turn_leases (
                session_id TEXT PRIMARY KEY,
                holder_id TEXT NOT NULL,
                acquired_at INTEGER NOT NULL,
                heartbeat_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
        `);
    }

    public acquireLease(sessionId: string, holderId: string, ttlMs: number = 30000): boolean {
        const now = Date.now();
        const expiresAt = now + ttlMs;

        const stmt = this.db.prepare(`
            INSERT INTO session_turn_leases (session_id, holder_id, acquired_at, heartbeat_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                holder_id = excluded.holder_id,
                acquired_at = excluded.acquired_at,
                heartbeat_at = excluded.heartbeat_at,
                expires_at = excluded.expires_at
            WHERE session_turn_leases.expires_at < ? OR session_turn_leases.holder_id = excluded.holder_id
        `);

        const result = stmt.run(sessionId, holderId, now, now, expiresAt, now);
        return result.changes > 0;
    }

    public renewHeartbeat(sessionId: string, holderId: string, ttlMs: number = 30000): boolean {
        const now = Date.now();
        const expiresAt = now + ttlMs;

        const stmt = this.db.prepare(`
            UPDATE session_turn_leases
            SET heartbeat_at = ?, expires_at = ?
            WHERE session_id = ? AND holder_id = ?
        `);
        const result = stmt.run(now, expiresAt, sessionId, holderId);
        return result.changes > 0;
    }

    public releaseLease(sessionId: string, holderId: string): void {
        const stmt = this.db.prepare(`
            DELETE FROM session_turn_leases
            WHERE session_id = ? AND holder_id = ?
        `);
        stmt.run(sessionId, holderId);
    }

    public close(): void {
        try {
            this.db.close();
        } catch {}
    }
}
