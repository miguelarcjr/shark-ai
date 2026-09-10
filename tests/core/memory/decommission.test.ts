import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

describe('Task 1: Decommission Legacy Stochastic Modules', () => {
  it('should ensure legacy stochastic files are completely removed', () => {
    expect(existsSync('src/core/workflow/membox-manager.ts')).toBe(false);
    expect(existsSync('src/core/workflow/embedding-service.ts')).toBe(false);
    expect(existsSync('src/core/api/ace-context-orchestrator.ts')).toBe(false);
  });

  it('should be able to import native node:sqlite DatabaseSync with FTS5', () => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite');
    expect(DatabaseSync).toBeDefined();

    const db = new DatabaseSync(':memory:');
    db.exec('CREATE VIRTUAL TABLE messages_fts USING fts5(content);');
    const stmt = db.prepare('INSERT INTO messages_fts (content) VALUES (?)');
    stmt.run('teste fts5');
    const searchStmt = db.prepare('SELECT * FROM messages_fts WHERE messages_fts MATCH ?');
    const rows = searchStmt.all('teste');
    expect(rows.length).toBe(1);
    db.close();
  });
});
