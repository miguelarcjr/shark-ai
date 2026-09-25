# Clean Continuation Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure that in multi-turn conversations (such as WhatsApp Bot or other adapters), only the initial turn receives the `🟢 EXECUTION MODE` and `--- PROJECT CONTEXT ---` boilerplate, while subsequent turns receive clean, raw user messages just like the CLI interactive mode.

**Architecture:** Inspect existing conversation history in `EngineContextBuilder.prepare()`. If `activeConversationId` has existing message history, set `basePrompt` to the raw instruction rather than wrapping it in the full execution template (unless running as an isolated subagent).

**Tech Stack:** Node.js, TypeScript, Vitest.

## Global Constraints

- Preserve all existing comments and docstrings.
- Do not alter subagent task prompt structures (`subagent-*`).
- Maintain full compatibility with `shark dev` CLI and all channel adapters.
- Follow strict TDD: write failing test first, verify failure, implement minimal code, verify pass, commit.

---

### Task 1: Add Unit Tests for Clean Continuation Prompts in EngineContextBuilder

**Files:**
- Modify: `src/core/engine/engine-context-builder.test.ts`
- Test: `src/core/engine/engine-context-builder.test.ts`

**Interfaces:**
- Consumes: `EngineContextBuilder.prepare(options: EngineContextOptions)`
- Produces: Test coverage asserting that empty history produces `🟢 EXECUTION MODE` while non-empty history produces raw `instruction`.

- [x] **Step 1: Write the failing tests in `engine-context-builder.test.ts`**

Add two test cases:
1. `prepares initial turn with EXECUTION MODE when history is empty`:
   Mock `HistoryManager.getRawHistory` to return `[]`. Call `EngineContextBuilder.prepare` with `sessionId: 'sess_new'`, `taskInstruction: 'Task 1'`. Assert `context.basePrompt` contains `🟢 EXECUTION MODE` and `Task 1`.
2. `prepares continuation turn with clean raw instruction when history exists`:
   Mock `HistoryManager.getRawHistory` to return `[{ role: 'user', content: 'previous question' }, { role: 'assistant', content: 'previous answer' }]`. Call `EngineContextBuilder.prepare` with `sessionId: 'sess_existing'`, `taskInstruction: 'Follow up question'`. Assert `context.basePrompt` equals `'Follow up question'` (and does NOT contain `🟢 EXECUTION MODE` or `--- PROJECT CONTEXT ---`).
3. `keeps structured execution prompt for subagents even if history exists`:
   Call `EngineContextBuilder.prepare` with `taskId: 'subagent-abc'`, `taskInstruction: 'Subagent Task'`. Assert `context.basePrompt` contains `🟢 EXECUTION MODE`.

```typescript
import { HistoryManager } from '../workflow/history-manager.js';

it('prepares continuation turn with clean raw instruction when history exists', async () => {
    vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
    vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_existing');
    vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([
        { role: 'user', content: 'previous message' } as any
    ]);

    const context = await EngineContextBuilder.prepare({
        projectRoot: process.cwd(),
        sessionId: 'sess_existing',
        taskInstruction: 'Follow up question'
    });

    expect(context.basePrompt).toBe('Follow up question');
    expect(context.basePrompt).not.toContain('EXECUTION MODE');

    await context.mcpManager.closeAll();
});
```

- [x] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/core/engine/engine-context-builder.test.ts`
Expected: FAIL on the continuation test because `basePrompt` still contains `EXECUTION MODE`.

- [x] **Step 3: Implement minimal code in `src/core/engine/engine-context-builder.ts`**

In `src/core/engine/engine-context-builder.ts`:
1. Import `HistoryManager` from `../workflow/history-manager.js`.
2. Check `effectiveTaskId` to determine `isSubagent`.
3. After retrieving `activeConversationId`, query `HistoryManager.getRawHistory(activeConversationId)` to set `hasExistingHistory`.
4. In `buildBasePrompt`:
   ```typescript
   if (hasExistingHistory && !isSubagent) {
       return instruction || '';
   }
   ```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/engine/engine-context-builder.test.ts`
Expected: All tests PASS.

- [x] **Step 5: Run full engine test suite**

Run: `npx vitest run src/core/engine`
Expected: All engine tests PASS.

- [x] **Step 6: Commit changes**

```bash
git add src/core/engine/engine-context-builder.ts src/core/engine/engine-context-builder.test.ts
git commit -m "feat(engine): clean continuation prompts for multi-turn conversations"
```
