import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateDB } from '../../../src/core/memory/state-db.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('StateDB with SQLite FTS5', () => {
  let tmpDir: string;
  let dbFile: string;
  let db: StateDB;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-statedb-'));
    dbFile = path.join(tmpDir, 'state.db');
    db = new StateDB(dbFile);
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should record messages and populate FTS5 table automatically via triggers', () => {
    db.recordMessage('sess-1', 'user', 'Configurar rota de billing e validação com Zod');
    db.recordMessage('sess-1', 'assistant', 'Rota de billing criada com schema de validação.');

    const results = db.search('billing');
    expect(results.length).toBe(2);
    expect(results[0].content).toContain('billing');
  });

  it('should execute FTS5 search in under 10ms', () => {
    for (let i = 0; i < 50; i++) {
      db.recordMessage(`sess-${i}`, i % 2 === 0 ? 'user' : 'assistant', `Mensagem indexada ${i} com palavra-chave microfrontend e docker`);
    }

    const start = performance.now();
    const results = db.search('microfrontend');
    const elapsed = performance.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
  });
});
