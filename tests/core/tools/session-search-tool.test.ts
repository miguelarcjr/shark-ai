import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeSessionSearchTool, sessionSearchToolSchema } from '../../../src/core/tools/session-search-tool.js';
import { StateDB } from '../../../src/core/memory/state-db.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('sessionSearchTool', () => {
  let tmpDir: string;
  let db: StateDB;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-tool-db-'));
    db = new StateDB(path.join(tmpDir, 'state.db'));
  });

  afterEach(async () => {
    db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should execute search and format results', () => {
    db.recordMessage('sess-42', 'user', 'Instalar pacote vitest e coverage');
    const args = sessionSearchToolSchema.parse({ query: 'vitest', limit: 5 });
    const result = executeSessionSearchTool(db, args);

    expect(result.totalFound).toBe(1);
    expect(result.results[0].content).toContain('vitest');
  });
});
