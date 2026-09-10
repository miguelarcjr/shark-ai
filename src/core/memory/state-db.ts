import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

export interface SearchResult {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  timestamp: string;
  rank: number;
}

export class StateDB {
  private db: any;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), '.shark', 'state.db');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(finalPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
  }

  recordMessage(sessionId: string, role: string, content: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)'
    );
    stmt.run(sessionId, role, content);
  }

  search(query: string, options?: { limit?: number; sessionId?: string }): SearchResult[] {
    const limit = options?.limit ?? 5;
    const cleanQuery = query.replace(/['"*]/g, ' ').trim();
    if (!cleanQuery) return [];

    let sql = `
      SELECT m.id, m.session_id as sessionId, m.role, m.content, m.timestamp, rank
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      WHERE messages_fts MATCH ?
    `;
    const params: any[] = [cleanQuery];

    if (options?.sessionId) {
      sql += ' AND m.session_id = ?';
      params.push(options.sessionId);
    }

    sql += ' ORDER BY rank LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as SearchResult[];
  }

  close(): void {
    this.db.close();
  }
}
