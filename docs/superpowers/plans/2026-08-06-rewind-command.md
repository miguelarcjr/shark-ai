# `/rewind` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/rewind [n]` slash command to `shark dev` to roll back conversation history by N logical user turns, allowing recovery from LLM JSON generation errors or revising previous instructions cleanly.

**Architecture:** Extend `HistoryManager` to calculate logical user turn boundaries (human user prompts) and perform history truncation. Register `/rewind`, `/rewind <n>`, and `/rewind list` handlers in `developer-agent.ts`'s `activeOnCommandHandler` so it seamlessly integrates into the `shark dev` CLI/TUI interactive prompt loop.

**Tech Stack:** TypeScript, Node.js (`node:fs`, `node:path`), Vitest, `@clack/prompts` / TUI.

## Global Constraints

- History files are stored as JSON arrays of `ChatMessage` (`{ role: 'system' | 'user' | 'assistant', content: string }`) in `_sharkrc/history/<conversationId>.raw.json` and `<conversationId>.json`.
- A "Logical User Turn" begins at a `role: 'user'` message that is NOT synthetic tool output (i.e. does not start with `[Action ` or `[MEMÓRIA`).
- All changes must be backed by unit tests using `vitest`.

---

### Task 1: Add Logical Turn Truncation Methods to `HistoryManager`

**Files:**
- Modify: `src/core/workflow/history-manager.ts`
- Test: `src/core/workflow/history-manager.test.ts`

**Interfaces:**
- Produces: 
  - `HistoryManager.getLogicalTurnIndexes(history: ChatMessage[]): number[]`
  - `HistoryManager.rewindLogicalTurns(conversationId: string, count: number): Promise<{ success: boolean; removedCount: number; remainingCount: number }>`

- [ ] **Step 1: Write the failing unit tests for history rewind**

Create test cases in `src/core/workflow/history-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryManager, ChatMessage } from './history-manager.js';
import fs from 'node:fs';
import path from 'node:path';

describe('HistoryManager Logical Turn Rewind', () => {
    const testId = 'test-rewind-conv';

    afterEach(async () => {
        await HistoryManager.deleteHistory(testId);
    });

    it('should identify logical user turn start indexes correctly', () => {
        const history: ChatMessage[] = [
            { role: 'system', content: 'System instruction' },
            { role: 'user', content: 'First user prompt' },
            { role: 'assistant', content: '{"action":{"type":"read_file"}}' },
            { role: 'user', content: '[Action read_file Success]: content' },
            { role: 'assistant', content: 'Assistant final response 1' },
            { role: 'user', content: 'Second user prompt' },
            { role: 'assistant', content: 'Assistant final response 2' }
        ];

        const indexes = HistoryManager.getLogicalTurnIndexes(history);
        expect(indexes).toEqual([1, 5]);
    });

    it('should rewind 1 logical turn properly', async () => {
        const history: ChatMessage[] = [
            { role: 'system', content: 'System instruction' },
            { role: 'user', content: 'First user prompt' },
            { role: 'assistant', content: 'Assistant response 1' },
            { role: 'user', content: 'Second user prompt' },
            { role: 'assistant', content: '{"message":"An unexpected error occurred"}' }
        ];

        await HistoryManager.saveRawHistory(testId, history);
        await HistoryManager.saveHistory(testId, history);

        const res = await HistoryManager.rewindLogicalTurns(testId, 1);
        expect(res.success).toBe(true);

        const updatedRaw = await HistoryManager.getRawHistory(testId);
        expect(updatedRaw.length).toBe(3);
        expect(updatedRaw[updatedRaw.length - 1].content).toBe('Assistant response 1');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: FAIL with `HistoryManager.getLogicalTurnIndexes is not a function`.

- [ ] **Step 3: Implement `getLogicalTurnIndexes` and `rewindLogicalTurns` in `HistoryManager`**

Update `src/core/workflow/history-manager.ts`:

```typescript
    static isLogicalUserTurn(msg: ChatMessage): boolean {
        if (msg.role !== 'user') return false;
        const content = msg.content || '';
        if (content.startsWith('[Action ') || content.startsWith('[MEMÓRIA')) {
            return false;
        }
        return true;
    }

    static getLogicalTurnIndexes(history: ChatMessage[]): number[] {
        const indexes: number[] = [];
        for (let i = 0; i < history.length; i++) {
            if (this.isLogicalUserTurn(history[i])) {
                indexes.push(i);
            }
        }
        return indexes;
    }

    static async rewindLogicalTurns(conversationId: string, count: number = 1): Promise<{ success: boolean; removedCount: number; remainingCount: number }> {
        const rawHistory = await this.getRawHistory(conversationId);
        if (rawHistory.length === 0) {
            return { success: false, removedCount: 0, remainingCount: 0 };
        }

        const turnIndexes = this.getLogicalTurnIndexes(rawHistory);
        if (turnIndexes.length === 0) {
            return { success: false, removedCount: 0, remainingCount: rawHistory.length };
        }

        const targetTurnIndex = Math.max(0, turnIndexes.length - count);
        const cutOffIndex = turnIndexes[targetTurnIndex];

        const truncatedRaw = rawHistory.slice(0, cutOffIndex);
        await this.saveRawHistory(conversationId, truncatedRaw);

        const formattedHistory = await this.getHistory(conversationId);
        if (formattedHistory.length > 0) {
            const truncatedFormatted = formattedHistory.slice(0, Math.min(formattedHistory.length, cutOffIndex));
            await this.saveHistory(conversationId, truncatedFormatted);
        }

        return {
            success: true,
            removedCount: rawHistory.length - truncatedRaw.length,
            remainingCount: truncatedRaw.length
        };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/history-manager.ts src/core/workflow/history-manager.test.ts
git commit -m "feat(workflow): add logical turn rewind methods to HistoryManager"
```

---

### Task 2: Register `/rewind` Handler in Developer Agent Interactive Loop

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/dev.test.ts` (or equivalent)

**Interfaces:**
- Consumes: `HistoryManager.rewindLogicalTurns`, `HistoryManager.getLogicalTurnIndexes`

- [ ] **Step 1: Implement `/rewind`, `/rewind <n>`, and `/rewind list` handler in `onCommandHandler`**

Modify `src/core/agents/developer-agent.ts` inside `onCommandHandler`:

```typescript
        if (command === '/rewind' || command.startsWith('/rewind ')) {
            if (!activeConversationId) {
                tui.log.warning('Nenhuma conversação ativa para rebobinar.');
                return true;
            }

            const args = command.trim().split(/\s+/).slice(1);
            const subCommand = args[0] ? args[0].toLowerCase() : '';

            const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
            const turnIndexes = HistoryManager.getLogicalTurnIndexes(rawHistory);

            if (subCommand === 'list') {
                if (turnIndexes.length === 0) {
                    tui.log.info('Nenhum turno do usuário encontrado no histórico.');
                    return true;
                }
                tui.log.info(colors.dim('\n--- TURNOS DO USUÁRIO ---'));
                turnIndexes.forEach((idx, i) => {
                    const snippet = rawHistory[idx].content.replace(/\n/g, ' ').substring(0, 60);
                    console.log(`[Turno ${i + 1}] Índice ${idx}: "${snippet}..."`);
                });
                tui.log.info(colors.dim('-------------------------\n'));
                return true;
            }

            let count = 1;
            if (subCommand && !isNaN(parseInt(subCommand, 10))) {
                count = Math.max(1, parseInt(subCommand, 10));
            }

            const result = await HistoryManager.rewindLogicalTurns(activeConversationId, count);
            if (result.success) {
                tui.log.success(`✔ Histórico rebobinado em ${count} turno(s). Mensagens no contexto: ${result.remainingCount}`);
            } else {
                tui.log.warning('Não foi possível rebobinar o histórico (histórico vazio ou sem turnos).');
            }
            return true;
        }
```

- [ ] **Step 2: Verify project builds cleanly**

Run: `npm run build`
Expected: Build passes with no TypeScript compiler errors.

- [ ] **Step 3: Run existing unit test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/developer-agent.ts
git commit -m "feat(cli): add /rewind slash command to developer agent interactive prompt"
```
