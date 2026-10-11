import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionLeaseManager } from './session-lease.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('SessionLeaseManager', () => {
    const testDbPath = path.resolve(process.cwd(), '.shark', 'test-lease.db');

    const cleanDb = () => {
        for (const f of [testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
            if (fs.existsSync(f)) {
                try { fs.unlinkSync(f); } catch {}
            }
        }
    };

    beforeEach(() => {
        cleanDb();
    });

    afterEach(() => {
        cleanDb();
    });

    it('acquires lease successfully when free', async () => {
        const leaseMgr = new SessionLeaseManager(testDbPath);
        const acquired = leaseMgr.acquireLease('session-1', 'holder-a', 30000);
        expect(acquired).toBe(true);

        // Segundo processo tenta adquirir e falha
        const secondAcquired = leaseMgr.acquireLease('session-1', 'holder-b', 30000);
        expect(secondAcquired).toBe(false);

        // Libera lease
        leaseMgr.releaseLease('session-1', 'holder-a');
        expect(leaseMgr.acquireLease('session-1', 'holder-b', 30000)).toBe(true);
        leaseMgr.close();
    });

    it('steals lease if expired past TTL', async () => {
        const leaseMgr = new SessionLeaseManager(testDbPath);
        // Cria lease expirado (TTL negativo)
        leaseMgr.acquireLease('session-1', 'holder-a', -1000);

        // holder-b consegue assumir porque expirou
        const acquired = leaseMgr.acquireLease('session-1', 'holder-b', 30000);
        expect(acquired).toBe(true);
        leaseMgr.close();
    });
});
