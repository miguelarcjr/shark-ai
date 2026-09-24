import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export interface PendingApprovalRecord {
    id: string;
    sessionId: string;
    checkpointMessageId: string;
    toolName: string;
    toolArgs: any;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    createdAt: number;
    expiresAt: number;
    resolvedAt?: number;
}

export class PendingApprovalsManager {
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
            CREATE TABLE IF NOT EXISTS pending_approvals (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                checkpoint_message_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_args TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                resolved_at INTEGER
            );
        `);
    }

    public createApproval(options: {
        sessionId: string;
        checkpointMessageId: string;
        toolName: string;
        toolArgs: any;
        ttlMs?: number;
    }): PendingApprovalRecord {
        const id = randomUUID();
        const now = Date.now();
        const expiresAt = now + (options.ttlMs ?? 600000); // 10 min padrão
        const serializedArgs = JSON.stringify(options.toolArgs);

        const stmt = this.db.prepare(`
            INSERT INTO pending_approvals 
            (id, session_id, checkpoint_message_id, tool_name, tool_args, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `);
        stmt.run(id, options.sessionId, options.checkpointMessageId, options.toolName, serializedArgs, now, expiresAt);

        return {
            id,
            sessionId: options.sessionId,
            checkpointMessageId: options.checkpointMessageId,
            toolName: options.toolName,
            toolArgs: options.toolArgs,
            status: 'pending',
            createdAt: now,
            expiresAt
        };
    }

    public resolveApproval(id: string, decision: 'approved' | 'rejected'): boolean {
        const now = Date.now();
        const stmt = this.db.prepare(`
            UPDATE pending_approvals
            SET status = ?, resolved_at = ?
            WHERE id = ? AND status = 'pending' AND expires_at > ?
        `);
        const result = stmt.run(decision, now, id, now);
        return result.changes === 1;
    }

    public getApproval(id: string): PendingApprovalRecord | null {
        const stmt = this.db.prepare(`SELECT * FROM pending_approvals WHERE id = ?`);
        const row = stmt.get(id) as any;
        if (!row) return null;
        return {
            id: row.id,
            sessionId: row.session_id,
            checkpointMessageId: row.checkpoint_message_id,
            toolName: row.tool_name,
            toolArgs: JSON.parse(row.tool_args),
            status: row.status,
            createdAt: Number(row.created_at),
            expiresAt: Number(row.expires_at),
            resolvedAt: row.resolved_at ? Number(row.resolved_at) : undefined
        };
    }

    public reapExpiredApprovals(): number {
        const now = Date.now();
        const stmt = this.db.prepare(`
            UPDATE pending_approvals
            SET status = 'expired'
            WHERE status = 'pending' AND expires_at <= ?
        `);
        const result = stmt.run(now);
        return result.changes;
    }

    public close(): void {
        try {
            this.db.close();
        } catch {}
    }
}
