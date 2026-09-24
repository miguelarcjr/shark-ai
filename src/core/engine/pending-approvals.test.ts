import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PendingApprovalsManager } from './pending-approvals.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('PendingApprovalsManager', () => {
    const testDbPath = path.resolve(process.cwd(), '.shark', 'test-approvals.db');

    beforeEach(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    afterEach(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    it('creates, resolves atomically and prevents duplicate resolutions', async () => {
        const mgr = new PendingApprovalsManager(testDbPath);
        const record = mgr.createApproval({
            sessionId: 'sess-1',
            checkpointMessageId: 'msg-42',
            toolName: 'bash',
            toolArgs: { command: 'rm -rf dist' },
            ttlMs: 60000
        });

        expect(record.status).toBe('pending');

        // Primeira resolução atômica
        const first = mgr.resolveApproval(record.id, 'approved');
        expect(first).toBe(true);

        // Segunda tentativa com mesmo id (duplo clique / webhook duplicado) deve falhar
        const second = mgr.resolveApproval(record.id, 'approved');
        expect(second).toBe(false);

        mgr.close();
    });

    it('reaps expired approvals automatically', async () => {
        const mgr = new PendingApprovalsManager(testDbPath);
        const record = mgr.createApproval({
            sessionId: 'sess-1',
            checkpointMessageId: 'msg-42',
            toolName: 'bash',
            toolArgs: { command: 'ls' },
            ttlMs: -100 // Expirado imediatamente
        });

        const expiredCount = mgr.reapExpiredApprovals();
        expect(expiredCount).toBeGreaterThanOrEqual(1);

        const current = mgr.getApproval(record.id);
        expect(current?.status).toBe('expired');

        mgr.close();
    });
});
