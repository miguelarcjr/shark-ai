# Arquitetura de Memória Determinística (Padrão Hermes) - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar o Shark AI de um sistema de memória complexo e estocástico (Membox/embeddings ONNX e ACE/BM25) para uma arquitetura modular em 3 camadas inspirada no Hermes Agent (`MemoryStore`, `StateDB`, `ContextCompressor`), garantindo preservação estrita do Prompt Caching, busca textual em <10ms via SQLite FTS5 e governança de memória.

**Architecture:** O sistema opera em 3 camadas:
1. `MemoryStore` gerencia arquivos planos (`MEMORY.md`, `USER.md`, `SOUL.md`) com limites rígidos e injeta um *Frozen Snapshot* estável no System Prompt durante o boot.
2. `StateDB` armazena o histórico em SQLite local com modo WAL e tabela virtual FTS5, expondo busca ultra-rápida via ferramenta `session_search`.
3. `ContextCompressor` monitora o teto de 80% de tokens e protege o Turno 0/1 (Pinned) e as últimas 15 mensagens (Tail), condensando o miolo em um bloco estruturado via LLM ou fallback determinístico.

**Tech Stack:** TypeScript, Node.js (>=20.0.0), `better-sqlite3` (SQLite + FTS5), `gpt-tokenizer`, Zod, Vitest.

## Global Constraints

- **Capacidade Máxima `MEMORY.md`**: 2.200 caracteres (~800 tokens), escopo local `<workspace>/.shark/MEMORY.md`.
- **Capacidade Máxima `USER.md`**: 1.375 caracteres (~500 tokens), escopo global `~/.shark/USER.md`.
- **Capacidade Máxima `SOUL.md`**: 1.000 caracteres (~350 tokens), escopo global `~/.shark/SOUL.md`, estritamente somente-leitura.
- **Regra do Frozen Snapshot**: Arquivos de memória são lidos uma única vez no boot da CLI e o System Prompt permanece 100% congelado durante toda a sessão ativa.
- **Regra de Governança de Escrita**: `ALLOWED_TARGETS = ['memory', 'user']`. Qualquer tentativa de alterar `SOUL.md` deve falhar com erro de autorização.
- **Latência de Busca FTS5**: <10ms em consultas locais.
- **Gatilho de Compactação**: 80% da janela máxima de tokens do modelo. Proteção de Cauda: últimos 15 turnos intactos.
- **Eliminação de Dependências Estocásticas**: Remoção completa de `@xenova/transformers` e diretórios de modelos locais ONNX.

---

### Task 1: Descomissionamento dos Módulos Legados e Configuração do `better-sqlite3`

**Files:**
- Modify: `package.json`
- Delete: `src/core/workflow/membox-manager.ts`
- Delete: `src/core/workflow/membox-manager.test.ts`
- Delete: `src/core/workflow/embedding-service.ts`
- Delete: `src/core/workflow/embedding-service.test.ts`
- Delete: `src/core/api/ace-context-orchestrator.ts`
- Delete: `src/core/api/ace-context-orchestrator.test.ts`
- Delete: `src/core/api/compaction-and-caching.test.ts`
- Test: `tests/core/memory/decommission.test.ts`

**Interfaces:**
- Consumes: `package.json`
- Produces: Ambiente limpo sem referências a módulos estocásticos e dependência `better-sqlite3` pronta para uso.

- [ ] **Step 1: Escrever teste que valida ausência dos arquivos legados e presença do better-sqlite3**

Criar `tests/core/memory/decommission.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

describe('Task 1: Decommission Legacy Stochastic Modules', () => {
  it('should ensure legacy stochastic files are completely removed', () => {
    expect(existsSync('src/core/workflow/membox-manager.ts')).toBe(false);
    expect(existsSync('src/core/workflow/embedding-service.ts')).toBe(false);
    expect(existsSync('src/core/api/ace-context-orchestrator.ts')).toBe(false);
  });

  it('should be able to import better-sqlite3', async () => {
    const Database = (await import('better-sqlite3')).default;
    expect(Database).toBeDefined();
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 1 as val').get() as { val: number };
    expect(row.val).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run tests/core/memory/decommission.test.ts`
Expected: FAIL (arquivos legados ainda existem e/ou `better-sqlite3` não instalado).

- [ ] **Step 3: Instalar `better-sqlite3` e deletar arquivos legados**

1. Executar no terminal:
```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```
2. Deletar os arquivos legados:
```bash
git rm src/core/workflow/membox-manager.ts src/core/workflow/membox-manager.test.ts src/core/workflow/embedding-service.ts src/core/workflow/embedding-service.test.ts src/core/api/ace-context-orchestrator.ts src/core/api/ace-context-orchestrator.test.ts src/core/api/compaction-and-caching.test.ts
```

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/memory/decommission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/core/memory/decommission.test.ts
git commit -m "chore: decommission legacy membox and ace modules, install better-sqlite3"
```

---

### Task 2: Implementação do `MemoryStore` (Arquivos Planos, Métricas de Capacidade e Protocolo de Estouro)

**Files:**
- Create: `src/core/memory/memory-store.ts`
- Test: `tests/core/memory/memory-store.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`, `node:path`, `node:os`
- Produces:
  ```typescript
  export interface MemorySnapshot {
    memory: string;
    user: string;
    soul: string;
    memoryUsage: { current: number; max: number; percentage: number };
    userUsage: { current: number; max: number; percentage: number };
    composedPromptBlock: string;
  }
  export class MemoryStore {
    constructor(customPaths?: { globalDir?: string; localDir?: string });
    loadSnapshot(): Promise<MemorySnapshot>;
    updateFile(target: 'memory' | 'user', action: 'add' | 'replace' | 'remove', content: string, oldStr?: string): Promise<{ success: boolean; usage: string; current_entries?: string[] }>;
    readFile(target: 'memory' | 'user' | 'soul'): Promise<string>;
  }
  ```

- [ ] **Step 1: Escrever teste unitário para `MemoryStore`**

Criar `tests/core/memory/memory-store.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('MemoryStore', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-global-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-local-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should initialize default template files on cold start and load snapshot', async () => {
    const snapshot = await store.loadSnapshot();
    expect(snapshot.soul).toContain('Shark');
    expect(snapshot.memoryUsage.max).toBe(2200);
    expect(snapshot.userUsage.max).toBe(1375);
    expect(snapshot.composedPromptBlock).toContain('MEMORY (notas do projeto)');
    expect(snapshot.composedPromptBlock).toContain('USER PROFILE');
  });

  it('should reject modification to SOUL.md with permission error', async () => {
    // @ts-expect-error test illegal target
    await expect(store.updateFile('soul', 'add', 'novo tom')).rejects.toThrow(
      "Alvo inválido: 'soul'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura."
    );
  });

  it('should reject entry exceeding limit with structured overflow guidance', async () => {
    const hugeContent = 'A'.repeat(2201);
    await expect(store.updateFile('memory', 'add', hugeContent)).rejects.toMatchObject({
      message: expect.stringContaining('would exceed the limit. Consolidate now')
    });
  });

  it('should support add, replace and remove operations on memory and user', async () => {
    await store.updateFile('memory', 'add', 'Porta da API: 8080');
    let content = await store.readFile('memory');
    expect(content).toContain('Porta da API: 8080');

    await store.updateFile('memory', 'replace', 'Porta da API: 9090', 'Porta da API: 8080');
    content = await store.readFile('memory');
    expect(content).toContain('Porta da API: 9090');
    expect(content).not.toContain('Porta da API: 8080');

    await store.updateFile('memory', 'remove', '', 'Porta da API: 9090');
    content = await store.readFile('memory');
    expect(content).not.toContain('Porta da API: 9090');
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run tests/core/memory/memory-store.test.ts`
Expected: FAIL (módulo ainda não implementado).

- [ ] **Step 3: Implementar `MemoryStore`**

Criar `src/core/memory/memory-store.ts`:
```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface MemorySnapshot {
  memory: string;
  user: string;
  soul: string;
  memoryUsage: { current: number; max: number; percentage: number };
  userUsage: { current: number; max: number; percentage: number };
  composedPromptBlock: string;
}

export class MemoryStore {
  public static readonly MEMORY_LIMIT = 2200;
  public static readonly USER_LIMIT = 1375;
  public static readonly SOUL_LIMIT = 1000;

  private globalDir: string;
  private localDir: string;

  constructor(customPaths?: { globalDir?: string; localDir?: string }) {
    this.globalDir = customPaths?.globalDir || path.join(os.homedir(), '.shark');
    this.localDir = customPaths?.localDir || path.join(process.cwd(), '.shark');
  }

  private getPath(target: 'memory' | 'user' | 'soul'): string {
    switch (target) {
      case 'memory':
        return path.join(this.localDir, 'MEMORY.md');
      case 'user':
        return path.join(this.globalDir, 'USER.md');
      case 'soul':
        return path.join(this.globalDir, 'SOUL.md');
    }
  }

  private getLimit(target: 'memory' | 'user' | 'soul'): number {
    switch (target) {
      case 'memory':
        return MemoryStore.MEMORY_LIMIT;
      case 'user':
        return MemoryStore.USER_LIMIT;
      case 'soul':
        return MemoryStore.SOUL_LIMIT;
    }
  }

  private async ensureDirAndFile(filePath: string, defaultContent: string): Promise<string> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      await fs.writeFile(filePath, defaultContent.trim(), 'utf-8');
      return defaultContent.trim();
    }
  }

  async readFile(target: 'memory' | 'user' | 'soul'): Promise<string> {
    const filePath = this.getPath(target);
    const defaults = {
      soul: 'Você é o Shark Dev, um agente de desenvolvimento colaborativo no Shark AI com foco em excelência técnica, código limpo e respostas concisas.',
      user: '# Perfil do Desenvolvedor\n- Ambiente: Node.js / TypeScript',
      memory: '# Memória do Projeto\n- Notas e convenções do repositório'
    };
    return this.ensureDirAndFile(filePath, defaults[target]);
  }

  async loadSnapshot(): Promise<MemorySnapshot> {
    const [soul, user, memory] = await Promise.all([
      this.readFile('soul'),
      this.readFile('user'),
      this.readFile('memory')
    ]);

    const memoryUsage = {
      current: memory.length,
      max: MemoryStore.MEMORY_LIMIT,
      percentage: Math.round((memory.length / MemoryStore.MEMORY_LIMIT) * 100)
    };

    const userUsage = {
      current: user.length,
      max: MemoryStore.USER_LIMIT,
      percentage: Math.round((user.length / MemoryStore.USER_LIMIT) * 100)
    };

    const composedPromptBlock = [
      `══════════════════════════════════════════════`,
      `MEMORY (notas do projeto) [${memoryUsage.percentage}% — ${memoryUsage.current}/${memoryUsage.max} chars]`,
      `══════════════════════════════════════════════`,
      memory,
      '',
      `══════════════════════════════════════════════`,
      `USER PROFILE [${userUsage.percentage}% — ${userUsage.current}/${userUsage.max} chars]`,
      `══════════════════════════════════════════════`,
      user
    ].join('\n');

    return { soul, user, memory, memoryUsage, userUsage, composedPromptBlock };
  }

  async updateFile(
    target: 'memory' | 'user',
    action: 'add' | 'replace' | 'remove',
    content: string,
    oldStr?: string
  ): Promise<{ success: boolean; usage: string; current_entries?: string[] }> {
    const ALLOWED_TARGETS = ['memory', 'user'] as const;
    if (!ALLOWED_TARGETS.includes(target as any)) {
      throw new Error(
        `Alvo inválido: '${target}'. O agente só possui permissão de escrita em 'MEMORY.md' e 'USER.md'. O arquivo 'SOUL.md' é estritamente somente-leitura.`
      );
    }

    const currentText = await this.readFile(target);
    const limit = this.getLimit(target);
    let newText = currentText;

    if (action === 'add') {
      newText = currentText ? `${currentText}\n${content.trim()}` : content.trim();
    } else if (action === 'replace') {
      if (!oldStr) throw new Error('Ação replace exige old_str para localizar o trecho a ser substituído.');
      if (!currentText.includes(oldStr)) {
        throw new Error(`Trecho '${oldStr}' não encontrado no arquivo ${target}.`);
      }
      newText = currentText.replace(oldStr, content.trim());
    } else if (action === 'remove') {
      const targetStr = oldStr || content;
      if (!targetStr) throw new Error('Ação remove exige conteúdo ou old_str para remoção.');
      newText = currentText.replace(targetStr, '').replace(/\n\s*\n/g, '\n').trim();
    }

    if (newText.length > limit) {
      const entries = currentText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const errorMsg = `Memory at ${currentText.length}/${limit} chars. Adding this entry (${content.length} chars) would exceed the limit. Consolidate now: use 'replace' to merge overlapping entries into shorter ones or 'remove' stale entries, then retry this add — all in this turn.`;
      const error = new Error(errorMsg);
      (error as any).current_entries = entries;
      (error as any).usage = `${currentText.length}/${limit}`;
      throw error;
    }

    const filePath = this.getPath(target);
    await fs.writeFile(filePath, newText, 'utf-8');

    return {
      success: true,
      usage: `${newText.length}/${limit}`
    };
  }
}
```

- [ ] **Step 4: Executar teste para verificar aprovação**

Run: `npx vitest run tests/core/memory/memory-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory/memory-store.ts tests/core/memory/memory-store.test.ts
git commit -m "feat: implement MemoryStore with capacity metrics and overflow protocol"
```

---

### Task 3: Implementação do `StateDB` (SQLite FTS5 + Triggers + Performance Gate)

**Files:**
- Create: `src/core/memory/state-db.ts`
- Test: `tests/core/memory/state-db.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`
- Produces:
  ```typescript
  export interface SearchResult {
    id: number;
    sessionId: string;
    role: string;
    content: string;
    timestamp: string;
    rank: number;
  }
  export class StateDB {
    constructor(dbPath?: string);
    recordMessage(sessionId: string, role: string, content: string): void;
    search(query: string, options?: { limit?: number; sessionId?: string }): SearchResult[];
    close(): void;
  }
  ```

- [ ] **Step 1: Escrever teste unitário e de performance para `StateDB`**

Criar `tests/core/memory/state-db.test.ts`:
```typescript
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
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run tests/core/memory/state-db.test.ts`
Expected: FAIL (classe não implementada).

- [ ] **Step 3: Implementar `StateDB` com SQLite FTS5 e WAL Mode**

Criar `src/core/memory/state-db.ts`:
```typescript
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface SearchResult {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  timestamp: string;
  rank: number;
}

export class StateDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), '.shark', 'state.db');
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
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

    return this.db.prepare(sql).all(...params) as SearchResult[];
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Executar teste para verificar aprovação**

Run: `npx vitest run tests/core/memory/state-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/memory/state-db.ts tests/core/memory/state-db.test.ts
git commit -m "feat: implement StateDB with SQLite FTS5 and <10ms query gate"
```

---

### Task 4: Implementação do `ContextCompressor` (Tail Protection & Resumo Híbrido com Fallback)

**Files:**
- Create: `src/core/workflow/context-compressor.ts`
- Test: `tests/core/workflow/context-compressor.test.ts`

**Interfaces:**
- Consumes: `gpt-tokenizer`, `src/core/workflow/history-manager.ts` (`ChatMessage`)
- Produces:
  ```typescript
  export interface CompressOptions {
    tokenLimit: number;
    thresholdRatio?: number; // default: 0.8
    tailSize?: number; // default: 15
    summarizer?: (messages: ChatMessage[]) => Promise<string>;
  }
  export class ContextCompressor {
    static countTokens(text: string): number;
    static compress(
      history: ChatMessage[],
      options: CompressOptions
    ): Promise<{ history: ChatMessage[]; wasCompressed: boolean }>;
  }
  ```

- [ ] **Step 1: Escrever teste unitário para `ContextCompressor`**

Criar `tests/core/workflow/context-compressor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ContextCompressor } from '../../../src/core/workflow/context-compressor.js';
import { ChatMessage } from '../../../src/core/workflow/history-manager.js';

describe('ContextCompressor with Tail Protection', () => {
  it('should not compress if total tokens are below threshold ratio (80%)', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'start task' },
      { role: 'assistant', content: 'working' }
    ];

    const result = await ContextCompressor.compress(history, { tokenLimit: 10000 });
    expect(result.wasCompressed).toBe(false);
    expect(result.history).toHaveLength(3);
  });

  it('should preserve Pinned Turn 0/1 and Tail (last 15 messages) when compressing', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM_PINNED' },
      { role: 'user', content: 'INITIAL_GOAL' }
    ];

    // Gerar 30 mensagens intermediárias
    for (let i = 0; i < 30; i++) {
      history.push({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `Middle message ${i}: ` + 'detalhes técnicos '.repeat(50)
      });
    }

    const lastMsg = history[history.length - 1];

    const result = await ContextCompressor.compress(history, {
      tokenLimit: 1000,
      thresholdRatio: 0.8,
      tailSize: 15
    });

    expect(result.wasCompressed).toBe(true);
    // Pinned
    expect(result.history[0].content).toBe('SYSTEM_PINNED');
    expect(result.history[1].content).toBe('INITIAL_GOAL');
    // Summary no meio
    expect(result.history[2].content).toContain('[Summary of earlier turns]');
    // Cauda preservada (última mensagem deve ser idêntica)
    expect(result.history[result.history.length - 1]).toEqual(lastMsg);
    // Tamanho total: 2 (pinned) + 1 (summary) + 15 (tail) = 18
    expect(result.history).toHaveLength(18);
  });

  it('should use deterministic fallback when custom summarizer throws error', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'action: edit file src/app.ts' },
      { role: 'user', content: 'ok' }
    ];

    for (let i = 0; i < 20; i++) {
      history.push({ role: 'assistant', content: `extra message ${i} ` + 'texto '.repeat(30) });
    }

    const failingSummarizer = async () => {
      throw new Error('LLM Rate limit / Timeout');
    };

    const result = await ContextCompressor.compress(history, {
      tokenLimit: 500,
      thresholdRatio: 0.5,
      tailSize: 5,
      summarizer: failingSummarizer
    });

    expect(result.wasCompressed).toBe(true);
    const summaryMessage = result.history.find(m => m.content.includes('[Summary of earlier turns]'));
    expect(summaryMessage).toBeDefined();
    expect(summaryMessage?.content).toContain('- Objetivo Principal:');
    expect(summaryMessage?.content).toContain('- Decisões Técnicas:');
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run tests/core/workflow/context-compressor.test.ts`
Expected: FAIL (classe não implementada).

- [ ] **Step 3: Implementar `ContextCompressor`**

Criar `src/core/workflow/context-compressor.ts`:
```typescript
import { encode } from 'gpt-tokenizer';
import { ChatMessage } from './history-manager.js';

export interface CompressOptions {
  tokenLimit: number;
  thresholdRatio?: number; // default: 0.8
  tailSize?: number; // default: 15
  summarizer?: (messages: ChatMessage[]) => Promise<string>;
}

export class ContextCompressor {
  static countTokens(text: string): number {
    if (!text) return 0;
    try {
      return encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  static calculateHistoryTokens(history: ChatMessage[]): number {
    return history.reduce((sum, msg) => sum + ContextCompressor.countTokens(msg.content), 0);
  }

  static async compress(
    history: ChatMessage[],
    options: CompressOptions
  ): Promise<{ history: ChatMessage[]; wasCompressed: boolean }> {
    const thresholdRatio = options.thresholdRatio ?? 0.8;
    const tailSize = options.tailSize ?? 15;
    const tokenLimit = options.tokenLimit;

    // Se o histórico não tem turnos intermediários suficientes para comprimir, retorna
    const minRequired = 2 + tailSize + 1; // Pinned (2) + Tail + Pelo menos 1 para resumir
    if (history.length <= minRequired) {
      return { history, wasCompressed: false };
    }

    const totalTokens = ContextCompressor.calculateHistoryTokens(history);
    const triggerThreshold = tokenLimit * thresholdRatio;

    if (totalTokens <= triggerThreshold) {
      return { history, wasCompressed: false };
    }

    // Particionamento
    const pinned = history.slice(0, 2);
    const tail = history.slice(history.length - tailSize);
    const middle = history.slice(2, history.length - tailSize);

    let summaryBlock = '';

    if (options.summarizer) {
      try {
        summaryBlock = await options.summarizer(middle);
      } catch {
        summaryBlock = ContextCompressor.generateDeterministicFallback(middle);
      }
    } else {
      summaryBlock = ContextCompressor.generateDeterministicFallback(middle);
    }

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: summaryBlock
    };

    const orchestratedHistory: ChatMessage[] = [
      ...pinned,
      summaryMessage,
      ...tail
    ];

    return { history: orchestratedHistory, wasCompressed: true };
  }

  static generateDeterministicFallback(middleMessages: ChatMessage[]): string {
    const modifiedFiles = new Set<string>();
    const actionsTaken: string[] = [];

    for (const msg of middleMessages) {
      if (msg.role === 'assistant') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.action?.path) {
            modifiedFiles.add(parsed.action.path);
          }
          if (parsed.summary) {
            actionsTaken.push(parsed.summary);
          }
        } catch {
          // fallback text matching
          const fileMatch = msg.content.match(/(?:create_file|modify_file|path)["':\s]+([^"'\s,}]+)/);
          if (fileMatch) modifiedFiles.add(fileMatch[1]);
        }
      }
    }

    const filesStr = modifiedFiles.size > 0 ? Array.from(modifiedFiles).join(', ') : 'Arquivos do workspace';
    const recentActions = actionsTaken.slice(-3).join('; ') || 'Progresso acumulado de execução da tarefa';

    return [
      `[Summary of earlier turns]`,
      `- Objetivo Principal: Continuidade da execução da tarefa solicitada pelo usuário`,
      `- Decisões Técnicas: ${recentActions}`,
      `- Arquivos Modificados: ${filesStr}`,
      `- Próximo Passo: Prosseguir com os turnos imediatos da conversa`
    ].join('\n');
  }
}
```

- [ ] **Step 4: Executar teste para verificar aprovação**

Run: `npx vitest run tests/core/workflow/context-compressor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/context-compressor.ts tests/core/workflow/context-compressor.test.ts
git commit -m "feat: implement deterministic ContextCompressor with tail protection and fallback"
```

---

### Task 5: Implementação das Ferramentas `memory` e `session_search`

**Files:**
- Create: `src/core/tools/memory-tool.ts`
- Create: `src/core/tools/session-search-tool.ts`
- Test: `tests/core/tools/memory-tool.test.ts`
- Test: `tests/core/tools/session-search-tool.test.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `StateDB`, `zod`
- Produces: `executeMemoryTool(store, args)` e `executeSessionSearchTool(db, args)`

- [ ] **Step 1: Escrever testes unitários para `memory-tool` e `session-search-tool`**

Criar `tests/core/tools/memory-tool.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeMemoryTool, memoryToolSchema } from '../../../src/core/tools/memory-tool.js';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('memoryTool', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-tool-g-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-test-tool-l-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should validate and execute add action', async () => {
    const args = memoryToolSchema.parse({
      action: 'add',
      target: 'memory',
      content: 'Porta Docker: 5432'
    });

    const result = await executeMemoryTool(store, args);
    expect(result.success).toBe(true);
    expect(result.usage).toBeDefined();

    const readArgs = memoryToolSchema.parse({ action: 'read', target: 'memory' });
    const readResult = await executeMemoryTool(store, readArgs);
    expect(readResult.content).toContain('Porta Docker: 5432');
  });

  it('should reject invalid targets via Zod schema', () => {
    expect(() =>
      // @ts-expect-error test schema rejection
      memoryToolSchema.parse({ action: 'add', target: 'soul', content: 'teste' })
    ).toThrow();
  });
});
```

Criar `tests/core/tools/session-search-tool.test.ts`:
```typescript
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
```

- [ ] **Step 2: Executar testes para verificar falha inicial**

Run: `npx vitest run tests/core/tools/memory-tool.test.ts tests/core/tools/session-search-tool.test.ts`
Expected: FAIL (ferramentas não implementadas).

- [ ] **Step 3: Implementar `memory-tool.ts` e `session-search-tool.ts`**

Criar `src/core/tools/memory-tool.ts`:
```typescript
import { z } from 'zod';
import { MemoryStore } from '../memory/memory-store.js';

export const memoryToolSchema = z.object({
  action: z.enum(['add', 'replace', 'remove', 'read']),
  target: z.enum(['memory', 'user']).describe("Alvo da memória: 'memory' (MEMORY.md local) ou 'user' (USER.md global)"),
  content: z.string().optional().describe('Conteúdo a adicionar ou novo conteúdo em substituição'),
  old_str: z.string().optional().describe('Trecho exato a ser substituído ou removido')
});

export type MemoryToolArgs = z.infer<typeof memoryToolSchema>;

export async function executeMemoryTool(
  store: MemoryStore,
  args: MemoryToolArgs
): Promise<{ success: boolean; usage?: string; content?: string; current_entries?: string[] }> {
  if (args.action === 'read') {
    const content = await store.readFile(args.target);
    return { success: true, content };
  }

  if (!args.content && args.action !== 'remove') {
    throw new Error(`Ação '${args.action}' exige o parâmetro 'content'.`);
  }

  return store.updateFile(args.target, args.action, args.content || '', args.old_str);
}
```

Criar `src/core/tools/session-search-tool.ts`:
```typescript
import { z } from 'zod';
import { StateDB, SearchResult } from '../memory/state-db.js';

export const sessionSearchToolSchema = z.object({
  query: z.string().describe('Termos de busca textual para encontrar mensagens em sessões anteriores'),
  limit: z.number().int().min(1).max(20).default(5).optional()
});

export type SessionSearchToolArgs = z.infer<typeof sessionSearchToolSchema>;

export function executeSessionSearchTool(
  db: StateDB,
  args: SessionSearchToolArgs
): { query: string; totalFound: number; results: SearchResult[] } {
  const results = db.search(args.query, { limit: args.limit });
  return {
    query: args.query,
    totalFound: results.length,
    results
  };
}
```

- [ ] **Step 4: Executar testes para verificar aprovação**

Run: `npx vitest run tests/core/tools/memory-tool.test.ts tests/core/tools/session-search-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/memory-tool.ts src/core/tools/session-search-tool.ts tests/core/tools/memory-tool.test.ts tests/core/tools/session-search-tool.test.ts
git commit -m "feat: implement memory and session_search tools with Zod validation"
```

---

### Task 6: Modularização do System Prompt e Integração do Boot Sequence (Frozen Snapshot)

**Files:**
- Modify: `src/core/api/prompts.ts`
- Modify: `src/core/api/stackspot-provider.ts`
- Modify: `src/core/api/openai-compatible-provider.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Test: `tests/core/workflow/memory-integration.test.ts`

**Interfaces:**
- Consumes: `MemoryStore`, `StateDB`, `ContextCompressor`, `UNIFIED_SYSTEM_PROMPT`
- Produces: Ciclo de vida completo no Shark AI com Frozen Snapshot estável e chamadas integradas às novas tools.

- [ ] **Step 1: Escrever teste de integração para o Frozen Snapshot e Prompt Caching**

Criar `tests/core/workflow/memory-integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../../src/core/memory/memory-store.js';
import { buildUnifiedSystemPrompt } from '../../../src/core/api/prompts.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Integration: Frozen Snapshot & Modular System Prompt', () => {
  let tmpGlobal: string;
  let tmpLocal: string;
  let store: MemoryStore;

  beforeEach(async () => {
    tmpGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-frozen-g-'));
    tmpLocal = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-frozen-l-'));
    store = new MemoryStore({ globalDir: tmpGlobal, localDir: tmpLocal });
  });

  afterEach(async () => {
    await fs.rm(tmpGlobal, { recursive: true, force: true });
    await fs.rm(tmpLocal, { recursive: true, force: true });
  });

  it('should build 3-layer system prompt with SOUL, USER, MEMORY and AGENTS context', async () => {
    await store.updateFile('memory', 'add', 'Porta do Serviço: 3000');
    await store.updateFile('user', 'add', 'Prefere respostas curtas');

    const snapshot = await store.loadSnapshot();
    const prompt = buildUnifiedSystemPrompt({
      snapshot,
      repositoryContext: '# AGENTS.md\nRegras de build com pnpm'
    });

    expect(prompt).toContain('Você é o Shark Dev');
    expect(prompt).toContain('<soul>');
    expect(prompt).toContain('<user_profile>');
    expect(prompt).toContain('Prefere respostas curtas');
    expect(prompt).toContain('<project_memory>');
    expect(prompt).toContain('Porta do Serviço: 3000');
    expect(prompt).toContain('<project_context>');
    expect(prompt).toContain('Regras de build com pnpm');
    expect(prompt).not.toContain('SISTEMA DE CONTEXTO ELÁSTICO (ACE)');
  });

  it('should maintain Frozen Snapshot unchanged in the active prompt even after memory updates', async () => {
    const snapshotAtBoot = await store.loadSnapshot();
    const activeSystemPrompt = buildUnifiedSystemPrompt({ snapshot: snapshotAtBoot });

    // Agente escreve uma nova memória no disco durante a sessão
    await store.updateFile('memory', 'add', 'Nova anotação no meio da sessão');

    // Prompt em execução na sessão DEVE permanecer idêntico para preservar o cache
    expect(activeSystemPrompt).not.toContain('Nova anotação no meio da sessão');

    // Na sessão seguinte (novo boot), o novo snapshot incorpora a alteração
    const snapshotNextBoot = await store.loadSnapshot();
    const nextSystemPrompt = buildUnifiedSystemPrompt({ snapshot: snapshotNextBoot });
    expect(nextSystemPrompt).toContain('Nova anotação no meio da sessão');
  });
});
```

- [ ] **Step 2: Executar teste para verificar falha inicial**

Run: `npx vitest run tests/core/workflow/memory-integration.test.ts`
Expected: FAIL (`buildUnifiedSystemPrompt` não definida).

- [ ] **Step 3: Atualizar `src/core/api/prompts.ts` e integrar provedores**

Atualizar `src/core/api/prompts.ts` adicionando `buildUnifiedSystemPrompt`, as ações `memory` e `session_search`, e removendo qualquer menção ao ACE.
Atualizar `stackspot-provider.ts` e `openai-compatible-provider.ts` para invocar o `ContextCompressor.compress()` em vez de `ace-context-orchestrator` e registrar mensagens no `StateDB`.

- [ ] **Step 4: Executar suíte completa de testes de memória e validação geral**

Run: `npx vitest run tests/core/`
Expected: PASS em todos os testes.

- [ ] **Step 5: Commit**

```bash
git add src/core/api/prompts.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts src/core/agents/developer-agent.ts tests/core/workflow/memory-integration.test.ts
git commit -m "feat: complete Frozen Snapshot boot integration and Hermes memory migration"
```

---

## Estrutura Final dos Arquivos Criados/Modificados

```
src/core/
├── memory/
│   ├── memory-store.ts        (Arquivos planos: MEMORY.md, USER.md, SOUL.md + contadores)
│   └── state-db.ts            (SQLite FTS5 + triggers + busca textual em <10ms)
├── tools/
│   ├── memory-tool.ts         (Ferramenta do agente para add/replace/remove/read)
│   └── session-search-tool.ts (Ferramenta do agente para consulta no SQLite)
├── workflow/
│   └── context-compressor.ts  (Tail protection: Pinned 0/1 + Tail 15 + Resumo híbrido)
└── api/
    ├── prompts.ts             (Novo template modular de 3 camadas com Frozen Snapshot)
    ├── stackspot-provider.ts  (Integrado ao ContextCompressor e StateDB)
    └── openai-compatible-provider.ts (Integrado ao ContextCompressor e StateDB)
```
