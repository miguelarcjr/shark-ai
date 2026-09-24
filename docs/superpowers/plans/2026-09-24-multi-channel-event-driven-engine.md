# Multi-Channel Event-Driven Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar o core do Shark AI (`developer-agent.ts`) do terminal, criando um motor de estados agnóstico orientado a eventos (`AgentEngine`), persistência atômica no SQLite (`pending_approvals` e `session_turn_leases`), um `CliAdapter` nativo e a fundação do `WhatsAppAdapter` com debouncing e throttling.

**Architecture:** O `AgentEngine` orquestra o ciclo de vida do agente comunicando-se estritamente através de `AgentInboundEvent` e `AgentOutboundEvent`. Cada turno é isolado por um `AbortController` e uma trava de sessão no SQLite (`SessionTurnLease`). Aprovações sensíveis usam o padrão Pause & Resume em banco (`pending_approvals` com TTL). A CLI e canais externos como WhatsApp conectam-se como `AgentChannelAdapter` isolados.

**Tech Stack:** TypeScript (Node >= 22.0.0, ESM), SQLite (`better-sqlite3` / driver nativo do Shark `MemoryStore`), Vitest, `@clack/prompts`, `picocolors`.

## Global Constraints

- Todos os novos módulos devem ser escritos em TypeScript ESM puro (`.ts` compilado para ESM via `tsup`).
- Nenhuma dependência externa pesada de WhatsApp (como Baileys, Sharp ou Chromium) deve ser adicionada ao `package.json` principal do Shark.
- 100% de retrocompatibilidade para o comando `shark dev` e para a função exportada `interactiveDeveloperAgent`.
- Tratamento estrito de atomicidade SQL para aprovações com verificação de `changes === 1`.
- Cobertura de testes unitários em Vitest para todas as transições de estado, leases e adaptadores.

---

### Task 1: Contratos e Interfaces de Eventos (`events.ts` e `adapter.interface.ts`)

**Files:**
- Create: `src/core/engine/events.ts`
- Create: `src/core/adapters/adapter.interface.ts`
- Test: `src/core/engine/events.test.ts`

**Interfaces:**
- Produces: `AgentInboundEvent`, `AgentOutboundEvent`, `AgentChannelAdapter`
- Consumes: Tipos de contexto do Shark (`MemoryStoreSnapshot`, `BridgeToolDefinition`)

- [ ] **Step 1: Escrever teste de tipagem e validação dos eventos**

```ts
// src/core/engine/events.test.ts
import { describe, it, expect } from 'vitest';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';

describe('Agent Events Contracts', () => {
    it('allows valid inbound user message construction', () => {
        const msg: AgentInboundEvent = {
            type: 'user_message',
            sessionId: 'test-session',
            text: 'Hello world',
            role: 'user',
            origin: { channelId: 'cli', senderId: 'local' }
        };
        expect(msg.type).toBe('user_message');
        expect(msg.sessionId).toBe('test-session');
    });

    it('allows valid action approval response event', () => {
        const approval: AgentInboundEvent = {
            type: 'action_approval_response',
            sessionId: 'test-session',
            approvalId: 'uuid-123',
            decision: 'approved'
        };
        expect(approval.type).toBe('action_approval_response');
    });

    it('allows valid outbound tool progress event', () => {
        const progress: AgentOutboundEvent = {
            type: 'tool_progress',
            sessionId: 'test-session',
            toolName: 'write_file',
            status: 'running',
            details: 'Writing index.ts'
        };
        expect(progress.type).toBe('tool_progress');
        expect(progress.toolName).toBe('write_file');
    });
});
```

- [ ] **Step 2: Executar teste e verificar falha**

Run: `npx vitest run src/core/engine/events.test.ts`  
Expected: FAIL com módulo `events.js` não encontrado.

- [ ] **Step 3: Criar `src/core/engine/events.ts`**

```ts
// src/core/engine/events.ts
export type InboundUserMessage = {
    type: 'user_message';
    sessionId: string;
    text: string;
    media?: Array<{ path: string; mimeType: string }>;
    role: 'user';
    origin: { channelId: string; senderId: string; isGroup?: boolean };
};

export type InboundActionApprovalResponse = {
    type: 'action_approval_response';
    sessionId: string;
    approvalId: string;
    decision: 'approved' | 'rejected' | 'always';
    feedback?: string;
};

export type InboundClarifyResponse = {
    type: 'clarify_response';
    sessionId: string;
    questionId: string;
    answer: string | string[];
};

export type InboundAbortCommand = {
    type: 'abort_command';
    sessionId: string;
    reason?: string;
};

export type AgentInboundEvent = 
    | InboundUserMessage
    | InboundActionApprovalResponse
    | InboundClarifyResponse
    | InboundAbortCommand;

export type OutboundReasoningDelta = {
    type: 'reasoning_delta';
    sessionId: string;
    delta: string;
};

export type OutboundTextDelta = {
    type: 'text_delta';
    sessionId: string;
    delta: string;
};

export type OutboundToolProgress = {
    type: 'tool_progress';
    sessionId: string;
    toolName: string;
    status: 'starting' | 'running' | 'completed' | 'failed';
    details?: string;
    error?: string;
};

export type OutboundActionApprovalRequest = {
    type: 'action_approval_request';
    sessionId: string;
    approvalId: string;
    toolName: string;
    toolArgs: any;
    riskLevel: 'low' | 'medium' | 'high';
    ttlMs: number;
    fallbackText: string;
};

export type OutboundClarifyRequest = {
    type: 'clarify_request';
    sessionId: string;
    questionId: string;
    question: string;
    options?: string[];
};

export type OutboundMediaAttachment = {
    type: 'media_attachment';
    sessionId: string;
    filePath: string;
    mimeType: string;
    caption?: string;
};

export type OutboundPresenceStatus = {
    type: 'presence_status';
    sessionId: string;
    status: 'typing' | 'idle' | 'executing_tool';
    emojiReaction?: '👀' | '✅' | '❌';
};

export type OutboundTurnCompleted = {
    type: 'turn_completed';
    sessionId: string;
    summary: string;
};

export type OutboundTurnInterrupted = {
    type: 'turn_interrupted';
    sessionId: string;
    reason: string;
};

export type AgentOutboundEvent =
    | OutboundReasoningDelta
    | OutboundTextDelta
    | OutboundToolProgress
    | OutboundActionApprovalRequest
    | OutboundClarifyRequest
    | OutboundMediaAttachment
    | OutboundPresenceStatus
    | OutboundTurnCompleted
    | OutboundTurnInterrupted;
```

- [ ] **Step 4: Criar `src/core/adapters/adapter.interface.ts`**

```ts
// src/core/adapters/adapter.interface.ts
import type { AgentInboundEvent, AgentOutboundEvent } from '../engine/events.js';

export interface AgentChannelAdapter {
    readonly channelId: string;
    emit(event: AgentOutboundEvent): Promise<void> | void;
    onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void;
    start?(): Promise<void>;
    stop?(): Promise<void>;
}
```

- [ ] **Step 5: Executar testes de eventos e confirmar aprovação**

Run: `npx vitest run src/core/engine/events.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/events.ts src/core/engine/events.test.ts src/core/adapters/adapter.interface.ts
git commit -m "feat: define agent event contracts and channel adapter interface"
```

---

### Task 2: Persistência no SQLite (`SessionTurnLease` & `PendingApprovals`)

**Files:**
- Create: `src/core/engine/session-lease.ts`
- Create: `src/core/engine/pending-approvals.ts`
- Test: `src/core/engine/session-lease.test.ts`
- Test: `src/core/engine/pending-approvals.test.ts`

**Interfaces:**
- Produces: `SessionLeaseManager`, `PendingApprovalsManager`
- Consumes: Arquivo ou banco SQLite do Shark (`_sharkrc/state.db` ou `MemoryStore`)

- [ ] **Step 1: Escrever teste de trava atômica do `SessionLeaseManager`**

```ts
// src/core/engine/session-lease.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionLeaseManager } from './session-lease.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('SessionLeaseManager', () => {
    const testDbPath = path.resolve(process.cwd(), '.shark', 'test-lease.db');

    beforeEach(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    });

    afterEach(() => {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
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
    });

    it('steals lease if expired past TTL', async () => {
        const leaseMgr = new SessionLeaseManager(testDbPath);
        // Cria lease expirado (TTL negativo)
        leaseMgr.acquireLease('session-1', 'holder-a', -1000);

        // holder-b consegue assumir porque expirou
        const acquired = leaseMgr.acquireLease('session-1', 'holder-b', 30000);
        expect(acquired).toBe(true);
    });
});
```

- [ ] **Step 2: Executar teste e verificar falha**

Run: `npx vitest run src/core/engine/session-lease.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar `src/core/engine/session-lease.ts`**

```ts
// src/core/engine/session-lease.ts
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class SessionLeaseManager {
    private db: Database.Database;

    constructor(dbPath?: string) {
        const resolvedPath = dbPath || path.resolve(process.cwd(), '.shark', 'state.db');
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(resolvedPath);
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
}
```

- [ ] **Step 4: Escrever teste de aprovações duráveis (`pending-approvals.test.ts`)**

```ts
// src/core/engine/pending-approvals.test.ts
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
    });
});
```

- [ ] **Step 5: Implementar `src/core/engine/pending-approvals.ts`**

```ts
// src/core/engine/pending-approvals.ts
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { randomUUID } from 'node:crypto';

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
    private db: Database.Database;

    constructor(dbPath?: string) {
        const resolvedPath = dbPath || path.resolve(process.cwd(), '.shark', 'state.db');
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.db = new Database(resolvedPath);
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
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            resolvedAt: row.resolved_at
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
}
```

- [ ] **Step 6: Executar testes de persistência**

Run: `npx vitest run src/core/engine/session-lease.test.ts src/core/engine/pending-approvals.test.ts`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/engine/session-lease.ts src/core/engine/session-lease.test.ts src/core/engine/pending-approvals.ts src/core/engine/pending-approvals.test.ts
git commit -m "feat: add SQLite session turn lease and durable pending approvals"
```

---

### Task 3: Core Event Engine (`AgentEngine`)

**Files:**
- Create: `src/core/engine/agent-engine.ts`
- Test: `src/core/engine/agent-engine.test.ts`

**Interfaces:**
- Produces: `AgentEngine` class
- Consumes: `AgentChannelAdapter`, `SessionLeaseManager`, `PendingApprovalsManager`, `AgentInboundEvent`, `AgentOutboundEvent`

- [ ] **Step 1: Escrever teste com `MockAdapter` para o fluxo de eventos**

```ts
// src/core/engine/agent-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AgentEngine } from './agent-engine.js';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';

class MockAdapter implements AgentChannelAdapter {
    readonly channelId = 'mock';
    public emittedEvents: AgentOutboundEvent[] = [];
    public inboundHandler?: (event: AgentInboundEvent) => Promise<void>;

    emit(event: AgentOutboundEvent) {
        this.emittedEvents.push(event);
    }

    onInbound(handler: (event: AgentInboundEvent) => Promise<void>) {
        this.inboundHandler = handler;
    }
}

describe('AgentEngine Core', () => {
    it('attaches adapter, dispatches presence, and executes turn lifecycle', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({ sessionId: 'test-sess-1', auto: true });
        engine.attachAdapter(adapter);

        await engine.processMessage({
            type: 'user_message',
            sessionId: 'test-sess-1',
            text: 'ping',
            role: 'user',
            origin: { channelId: 'mock', senderId: 'u1' }
        });

        // Verifica emissão de presença e conclusão
        const types = adapter.emittedEvents.map(e => e.type);
        expect(types).toContain('presence_status');
        expect(types).toContain('turn_completed');
    });

    it('cancels active turn immediately on abort_command', async () => {
        const adapter = new MockAdapter();
        const engine = new AgentEngine({ sessionId: 'test-sess-abort' });
        engine.attachAdapter(adapter);

        const runPromise = engine.processMessage({
            type: 'user_message',
            sessionId: 'test-sess-abort',
            text: 'long running task',
            role: 'user',
            origin: { channelId: 'mock', senderId: 'u1' }
        });

        // Emite aborto
        await adapter.inboundHandler?.({
            type: 'abort_command',
            sessionId: 'test-sess-abort',
            reason: 'user_cancelled'
        });

        await runPromise;

        const interrupted = adapter.emittedEvents.find(e => e.type === 'turn_interrupted');
        expect(interrupted).toBeDefined();
    });
});
```

- [ ] **Step 2: Executar teste e verificar falha**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar `src/core/engine/agent-engine.ts`**

```ts
// src/core/engine/agent-engine.ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
}

export class AgentEngine {
    public readonly sessionId: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAuto: boolean;

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.isAuto = options.auto === true;
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
    }

    public attachAdapter(adapter: AgentChannelAdapter) {
        this.adapter = adapter;
        this.adapter.onInbound(async (event) => {
            if (event.type === 'abort_command' && event.sessionId === this.sessionId) {
                this.abortCurrentTurn(event.reason);
                return;
            }
            if (event.type === 'action_approval_response') {
                this.handleApprovalResponse(event);
                return;
            }
            if (event.type === 'user_message' && event.sessionId === this.sessionId) {
                await this.processMessage(event);
            }
        });
    }

    public abortCurrentTurn(reason: string = 'Interrupted by user') {
        if (this.currentTurnAbort) {
            this.currentTurnAbort.abort();
            this.currentTurnAbort = undefined;
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason
            });
        }
    }

    private emitOutbound(event: AgentOutboundEvent) {
        this.adapter?.emit(event);
    }

    public async processMessage(message: InboundUserMessage): Promise<void> {
        const holderId = randomUUID();
        const acquired = this.leaseManager.acquireLease(this.sessionId, holderId);
        if (!acquired) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason: 'Session is busy with another active turn'
            });
            return;
        }

        const abortController = new AbortController();
        this.currentTurnAbort = abortController;

        this.emitOutbound({
            type: 'presence_status',
            sessionId: this.sessionId,
            status: 'typing',
            emojiReaction: '👀'
        });

        try {
            if (abortController.signal.aborted) {
                return;
            }

            // Simulação de ciclo de execução compatível (a ser plugado no LLM e BridgeTools)
            this.emitOutbound({
                type: 'turn_completed',
                sessionId: this.sessionId,
                summary: `Processed: ${message.text}`
            });
        } catch (error: any) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: this.sessionId,
                reason: error.message
            });
        } finally {
            this.leaseManager.releaseLease(this.sessionId, holderId);
            if (this.currentTurnAbort === abortController) {
                this.currentTurnAbort = undefined;
            }
        }
    }

    private handleApprovalResponse(event: any) {
        this.approvalsManager.resolveApproval(event.approvalId, event.decision);
    }
}
```

- [ ] **Step 4: Executar testes do motor**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/agent-engine.ts src/core/engine/agent-engine.test.ts
git commit -m "feat: implement agnostic AgentEngine with lifecycle and abort handling"
```

---

### Task 4: Adaptador CLI (`CliAdapter`)

**Files:**
- Create: `src/core/adapters/cli/cli-adapter.ts`
- Test: `src/core/adapters/cli/cli-adapter.test.ts`

**Interfaces:**
- Produces: `CliAdapter` (implementa `AgentChannelAdapter`)
- Consumes: `@clack/prompts`, `tui.ts`, `AgentOutboundEvent`, `AgentInboundEvent`

- [ ] **Step 1: Escrever teste de renderização e propagação de eventos no `CliAdapter`**

```ts
// src/core/adapters/cli/cli-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CliAdapter } from './cli-adapter.js';
import type { AgentOutboundEvent } from '../../engine/events.js';

describe('CliAdapter', () => {
    it('dispatches inbound user message when input is submitted', async () => {
        const adapter = new CliAdapter();
        let receivedInbound: any = null;
        adapter.onInbound(async (event) => {
            receivedInbound = event;
        });

        await adapter.dispatchUserText('Minha nova tarefa', 'session-cli');
        expect(receivedInbound).toBeDefined();
        expect(receivedInbound.type).toBe('user_message');
        expect(receivedInbound.text).toBe('Minha nova tarefa');
    });

    it('renders text_delta to stdout stream without error', () => {
        const adapter = new CliAdapter();
        const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true as any);

        adapter.emit({
            type: 'text_delta',
            sessionId: 'session-cli',
            delta: 'Chunk de texto'
        });

        expect(writeSpy).toHaveBeenCalledWith('Chunk de texto');
        writeSpy.mockRestore();
    });
});
```

- [ ] **Step 2: Executar teste e verificar falha**

Run: `npx vitest run src/core/adapters/cli/cli-adapter.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar `src/core/adapters/cli/cli-adapter.ts`**

```ts
// src/core/adapters/cli/cli-adapter.ts
import type { AgentChannelAdapter } from '../adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from '../../engine/events.js';
import { tui } from '../../../ui/tui.js';
import colors from '../../../ui/colors.js';

export interface CliAdapterOptions {
    auto?: boolean;
}

export class CliAdapter implements AgentChannelAdapter {
    readonly channelId = 'cli';
    private inboundHandler?: (event: AgentInboundEvent) => Promise<void>;
    private isAuto: boolean;

    constructor(options: CliAdapterOptions = {}) {
        this.isAuto = options.auto === true;
    }

    public onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void {
        this.inboundHandler = handler;
    }

    public async dispatchUserText(text: string, sessionId: string = 'cli:local') {
        if (!this.inboundHandler) return;
        await this.inboundHandler({
            type: 'user_message',
            sessionId,
            text,
            role: 'user',
            origin: { channelId: 'cli', senderId: 'local' }
        });
    }

    public emit(event: AgentOutboundEvent): void {
        switch (event.type) {
            case 'text_delta':
                process.stdout.write(event.delta);
                break;
            case 'reasoning_delta':
                process.stdout.write(colors.dim(event.delta));
                break;
            case 'tool_progress':
                if (event.status === 'starting' || event.status === 'running') {
                    tui.log.info(colors.primary(`⚙️ [${event.toolName}] ${event.details || 'executando...'}`));
                } else if (event.status === 'completed') {
                    tui.log.success(colors.success(`✅ [${event.toolName}] concluído`));
                } else if (event.status === 'failed') {
                    tui.log.error(colors.error(`❌ [${event.toolName}] falhou: ${event.error}`));
                }
                break;
            case 'turn_completed':
                tui.box(event.summary, 'Tarefa Concluída');
                break;
            case 'turn_interrupted':
                tui.log.warn(colors.warning(`🛑 Turno interrompido: ${event.reason}`));
                break;
        }
    }
}
```

- [ ] **Step 4: Executar testes do `CliAdapter`**

Run: `npx vitest run src/core/adapters/cli/cli-adapter.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/adapters/cli/cli-adapter.ts src/core/adapters/cli/cli-adapter.test.ts
git commit -m "feat: implement CliAdapter with streaming and TUI output"
```

---

### Task 5: Integração da Fachada `developer-agent.ts` e `shark dev`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/commands/dev.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Produces: `interactiveDeveloperAgent` (mantida com assinatura idêntica)
- Consumes: `AgentEngine`, `CliAdapter`

- [ ] **Step 1: Verificar testes existentes de `developer-agent.test.ts`**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`  
Expected: PASS (todos os testes verdes atualmente)

- [ ] **Step 2: Conectar o `AgentEngine` e `CliAdapter` na inicialização do `developer-agent.ts`**

Refatorar a inicialização para usar o `AgentEngine` internamente quando acionado pelo comando CLI, preservando os fluxos legados via compatibilidade.

- [ ] **Step 3: Re-executar toda a suite de testes**

Run: `npm test`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/developer-agent.ts src/commands/dev.ts
git commit -m "refactor: integrate AgentEngine and CliAdapter preserving backward compatibility"
```

---

### Task 6: Fundação do Adaptador de Mensagens Assíncronas (`WhatsAppAdapter`)

**Files:**
- Create: `src/core/adapters/whatsapp/chunker.ts`
- Create: `src/core/adapters/whatsapp/whatsapp-adapter.ts`
- Test: `src/core/adapters/whatsapp/chunker.test.ts`
- Test: `src/core/adapters/whatsapp/whatsapp-adapter.test.ts`

**Interfaces:**
- Produces: `splitWhatsAppMessage()`, `WhatsAppAdapter`, `WhatsAppTransport` (interface injetável)
- Consumes: `AgentChannelAdapter`, `AgentOutboundEvent`

- [ ] **Step 1: Escrever teste de fatiamento de mensagens (`chunker.test.ts`)**

```ts
// src/core/adapters/whatsapp/chunker.test.ts
import { describe, it, expect } from 'vitest';
import { splitWhatsAppMessage } from './chunker.js';

describe('WhatsApp Message Chunker', () => {
    it('returns single chunk when under 3500 chars', () => {
        const text = 'Mensagem curta';
        const chunks = splitWhatsAppMessage(text, 3500);
        expect(chunks).toEqual(['Mensagem curta']);
    });

    it('splits message exceeding limit preserving newline boundaries', () => {
        const line = 'A'.repeat(2000) + '\n';
        const bigText = line + line; // 4002 chars
        const chunks = splitWhatsAppMessage(bigText, 3500);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBeLessThanOrEqual(3500);
    });
});
```

- [ ] **Step 2: Implementar `src/core/adapters/whatsapp/chunker.ts`**

```ts
// src/core/adapters/whatsapp/chunker.ts
export function splitWhatsAppMessage(text: string, maxChunkSize: number = 3500): string[] {
    if (text.length <= maxChunkSize) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxChunkSize) {
        let splitIndex = remaining.lastIndexOf('\n', maxChunkSize);
        if (splitIndex === -1 || splitIndex < maxChunkSize * 0.5) {
            splitIndex = maxChunkSize;
        }
        chunks.push(remaining.substring(0, splitIndex).trim());
        remaining = remaining.substring(splitIndex).trim();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}
```

- [ ] **Step 3: Escrever teste de debouncing e throttling no `WhatsAppAdapter`**

```ts
// src/core/adapters/whatsapp/whatsapp-adapter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppAdapter, type WhatsAppTransport } from './whatsapp-adapter.js';

describe('WhatsAppAdapter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces rapid burst messages into a single user message event', async () => {
        const transport: WhatsAppTransport = {
            sendText: vi.fn(),
            onRawMessage: vi.fn()
        };
        const adapter = new WhatsAppAdapter(transport, { debounceMs: 800 });

        let receivedCount = 0;
        let lastText = '';
        adapter.onInbound(async (event) => {
            if (event.type === 'user_message') {
                receivedCount++;
                lastText = event.text;
            }
        });

        // 3 mensagens em rajada rápida
        adapter.receiveRawFromTransport('u123', 'Oi');
        adapter.receiveRawFromTransport('u123', 'Crie um endpoint');
        adapter.receiveRawFromTransport('u123', 'com Zod');

        expect(receivedCount).toBe(0);

        // Avança 800ms do temporizador
        vi.advanceTimersByTime(800);

        expect(receivedCount).toBe(1);
        expect(lastText).toBe('Oi\nCrie um endpoint\ncom Zod');
    });
});
```

- [ ] **Step 4: Implementar `src/core/adapters/whatsapp/whatsapp-adapter.ts`**

```ts
// src/core/adapters/whatsapp/whatsapp-adapter.ts
import type { AgentChannelAdapter } from '../adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from '../../engine/events.js';
import { splitWhatsAppMessage } from './chunker.js';

export interface WhatsAppTransport {
    sendText(chatId: string, text: string): Promise<void>;
    editMessage?(chatId: string, messageId: string, text: string): Promise<void>;
    onRawMessage(handler: (chatId: string, text: string, senderId: string) => void): void;
}

export interface WhatsAppAdapterOptions {
    debounceMs?: number;
    throttleMs?: number;
}

export class WhatsAppAdapter implements AgentChannelAdapter {
    readonly channelId = 'whatsapp';
    private inboundHandler?: (event: AgentInboundEvent) => Promise<void>;
    private debounceBuffers = new Map<string, { timer: any; messages: string[] }>();
    private debounceMs: number;

    constructor(
        private transport: WhatsAppTransport,
        options: WhatsAppAdapterOptions = {}
    ) {
        this.debounceMs = options.debounceMs ?? 800;
        this.transport.onRawMessage((chatId, text, senderId) => {
            this.receiveRawFromTransport(chatId, text, senderId);
        });
    }

    public onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void {
        this.inboundHandler = handler;
    }

    public receiveRawFromTransport(chatId: string, text: string, senderId: string = chatId) {
        // Comandos de interrupção furam a fila
        if (text === '/stop' || text === '/abort') {
            this.inboundHandler?.({
                type: 'abort_command',
                sessionId: `whatsapp:dm:${chatId}`,
                reason: 'user_requested_via_whatsapp'
            });
            return;
        }

        const existing = this.debounceBuffers.get(chatId);
        if (existing) {
            clearTimeout(existing.timer);
            existing.messages.push(text);
        } else {
            this.debounceBuffers.set(chatId, {
                messages: [text],
                timer: null
            });
        }

        const buffer = this.debounceBuffers.get(chatId)!;
        buffer.timer = setTimeout(() => {
            const combined = buffer.messages.join('\n');
            this.debounceBuffers.delete(chatId);
            this.inboundHandler?.({
                type: 'user_message',
                sessionId: `whatsapp:dm:${chatId}`,
                text: combined,
                role: 'user',
                origin: { channelId: 'whatsapp', senderId }
            });
        }, this.debounceMs);
    }

    public async emit(event: AgentOutboundEvent): Promise<void> {
        const chatId = event.sessionId.replace(/^whatsapp:dm:/, '');
        if (event.type === 'turn_completed') {
            const chunks = splitWhatsAppMessage(event.summary);
            for (const chunk of chunks) {
                await this.transport.sendText(chatId, chunk);
            }
        } else if (event.type === 'action_approval_request') {
            const text = `⚠️ *Aprovação Solicitada*\nFerramenta: \`${event.toolName}\`\n\n${event.fallbackText}\n_Responda 1 para Aprovar ou 2 para Rejeitar_`;
            await this.transport.sendText(chatId, text);
        }
    }
}
```

- [ ] **Step 5: Executar testes do `WhatsAppAdapter`**

Run: `npx vitest run src/core/adapters/whatsapp/chunker.test.ts src/core/adapters/whatsapp/whatsapp-adapter.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/adapters/whatsapp/chunker.ts src/core/adapters/whatsapp/chunker.test.ts src/core/adapters/whatsapp/whatsapp-adapter.ts src/core/adapters/whatsapp/whatsapp-adapter.test.ts
git commit -m "feat: implement WhatsAppAdapter with message debouncing and chunking"
```
