# Always-On Structural Read-File Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ACE Context Orchestrator to execute structural deduplication of `read_file` actions unconditionally on every interaction turn, while preserving `run_command` execution history.

**Architecture:** Extract `applyStructuralReadDeduplication` helper function in `ace-context-orchestrator.ts` and invoke it at the beginning of `orchestrateContext` before checking the compaction token limit ceiling.

**Tech Stack:** TypeScript, Node.js, Vitest, gpt-tokenizer.

## Global Constraints

- Preserve system prompts (Turn 0), task instructions, and current prompt tail during deduplication.
- Do NOT drop `run_command` entries during structural deduplication.
- Execute structural `read_file` deduplication regardless of total raw token count.

---

### Task 1: Always-On Structural Read-File Deduplication

**Files:**
- Modify: `src/core/api/ace-context-orchestrator.ts`
- Test: `src/core/api/ace-context-orchestrator.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `src/core/workflow/history-manager.ts`
- Produces: `applyStructuralReadDeduplication(rawHistory: ChatMessage[]): ChatMessage[]`

- [ ] **Step 1: Write the failing tests in `ace-context-orchestrator.test.ts`**

Add unit tests to `src/core/api/ace-context-orchestrator.test.ts`:

```typescript
it('should perform structural deduplication of read_file even when total tokens are below budget limit', async () => {
    const rawHistory: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Help me fix a bug' },
        { role: 'user', content: '[Action read_file(src/index.ts) Success]:\nconst x = 1;' },
        { role: 'assistant', content: '{"thought":"looking","summary":"analyzing","action":null}' },
        { role: 'user', content: '[Action read_file(src/index.ts) Success]:\nconst x = 2;' },
        { role: 'user', content: 'What next?' }
    ];

    // Even with very small token count (below budget ceiling), older read of src/index.ts must be dropped
    const result = await orchestrateContext(rawHistory, 'Current user question', 200000);
    const readTurns = result.filter(m => m.content.startsWith('[Action read_file(src/index.ts)'));
    expect(readTurns.length).toBe(1);
    expect(readTurns[0].content).toContain('const x = 2;');
});

it('should not drop run_command entries during structural deduplication', async () => {
    const rawHistory: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Initial prompt' },
        { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed at assertion A' },
        { role: 'assistant', content: '{"thought":"fixing","summary":"modified code","action":null}' },
        { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed at assertion B' },
        { role: 'user', content: 'Check status' }
    ];

    const result = await orchestrateContext(rawHistory, 'Latest prompt', 200000);
    const cmdTurns = result.filter(m => m.content.startsWith('[Action run_command(npm test)'));
    expect(cmdTurns.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts`
Expected: FAIL on the new test assertions because `orchestrateContext` currently returns `rawHistory` immediately when tokens are below 80% budget ceiling.

- [ ] **Step 3: Implement `applyStructuralReadDeduplication` and update `orchestrateContext`**

In `src/core/api/ace-context-orchestrator.ts`:

```typescript
export function applyStructuralReadDeduplication(rawHistory: ChatMessage[]): ChatMessage[] {
    if (rawHistory.length <= 2) {
        return rawHistory;
    }

    const pinnedIndices = new Set<number>();
    pinnedIndices.add(0); // Turn 0 (system message)
    pinnedIndices.add(rawHistory.length - 1); // Turn T (current prompt / latest turn)
    if (rawHistory.length > 2) {
        pinnedIndices.add(rawHistory.length - 2); // Turn T-1 (previous tool output / assistant thought)
    }

    const firstUserMsgIdx = rawHistory.findIndex((m, idx) => m.role === 'user' && !m.content.startsWith('[Action ') && idx > 0);
    if (firstUserMsgIdx !== -1) {
        pinnedIndices.add(firstUserMsgIdx); // Turn 1 (original task instruction)
    }

    let latestHumanUserMsgIdx = -1;
    for (let i = rawHistory.length - 1; i >= 0; i--) {
        const msg = rawHistory[i];
        if (msg.role === 'user' && !msg.content.startsWith('[Action ')) {
            latestHumanUserMsgIdx = i;
            break;
        }
    }
    if (latestHumanUserMsgIdx !== -1) {
        pinnedIndices.add(latestHumanUserMsgIdx);
    }

    const seenReadFiles = new Set<string>();
    const forceDropIndices = new Set<number>();

    for (let i = rawHistory.length - 1; i >= 0; i--) {
        const msg = rawHistory[i];
        if (msg.role === 'user' || msg.role === 'system') {
            if (msg.content.startsWith('[Action read_file(')) {
                const pathMatch = msg.content.match(/read_file\(([^)]+)\)/);
                const filePath = pathMatch ? pathMatch[1] : '';
                if (filePath) {
                    if (seenReadFiles.has(filePath)) {
                        if (!pinnedIndices.has(i)) {
                            forceDropIndices.add(i);
                        }
                    } else {
                        seenReadFiles.add(filePath);
                    }
                }
            }
        }
    }

    return rawHistory.filter((_, idx) => !forceDropIndices.has(idx));
}
```

Update `orchestrateContext`:

```typescript
export async function orchestrateContext(
    rawHistory: ChatMessage[],
    currentPrompt: string,
    compactionTokenLimit: number
): Promise<ChatMessage[]> {
    if (rawHistory.length <= 2) {
        return rawHistory;
    }

    // Step 1: Unconditional Structural Read-File Deduplication
    const cleanedHistory = applyStructuralReadDeduplication(rawHistory);

    // Step 2: Check total tokens on cleaned history against budget ceiling
    const totalCleanedTokens = cleanedHistory.reduce((sum, msg) => sum + countTokens(msg.content), 0);
    const budgetCeiling = Math.floor(0.80 * compactionTokenLimit);
    if (totalCleanedTokens <= budgetCeiling) {
        return cleanedHistory;
    }

    // Step 3: BM25 & Abstract Compaction on cleanedHistory if budget is exceeded
    ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts`
Expected: PASS (All tests passing)

- [ ] **Step 5: Commit changes**

```bash
git add src/core/api/ace-context-orchestrator.ts src/core/api/ace-context-orchestrator.test.ts
git commit -m "feat(ace): apply always-on structural read-file deduplication"
```
