# Single-Source In-Memory Subagent IPC & Non-Blocking TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single-source in-memory IPC pipeline for subagent notifications and a non-blocking async keypress TUI prompt reader that instantly unblocks upon subagent completion without requiring Enter, while preserving exact `@clack/prompts` styling.

**Architecture:** Replace blocking `tui.text()` calls in `waitForInputOrNotification` with a non-blocking `process.stdin` keypress listener styled with Clack UI borders (`│  Your answer:`). Deliver child process exit events directly to `parentQueue` in memory (`parentQueue.push`). Maintain `keepGoing = true` continuously in interactive CLI mode (`isBatchMode: false`).

**Tech Stack:** TypeScript, Node.js `process.stdin` TTY raw mode, Vitest, `@clack/prompts`, ANSI escape sequences.

## Global Constraints

- Never use blocking `clack.text()` during active subagent execution or waiting states.
- Subagent completion events must deliver exactly ONE in-memory event to `parentQueue`.
- Render non-blocking prompt lines matching `@clack/prompts` visual format (`│  Your answer: `).
- Interrupted TUI prompts must preserve user draft text in `userDraftBuffer`.

---

### Task 1: Non-Blocking Async Keypress Reader with Clack TUI Formatting

**Files:**
- Modify: `src/core/agents/developer-agent.ts:75-165`
- Test: `src/core/agents/developer-agent.test.ts:690-715`

**Interfaces:**
- Consumes: `waitForInputOrNotification(queue, promptMessage, subagentPrefix, timeoutMs, isAuto, initialDraft)`
- Produces: `{ type: 'user' | 'subagent_notification' | 'timeout', content: string, draft: string }`

- [ ] **Step 1: Write failing unit test for non-blocking prompt resolution on subagent notification**

In `src/core/agents/developer-agent.test.ts`:
```typescript
it('unblocks waitForInputOrNotification instantly when subagent notification arrives', async () => {
    const queue = new MessageQueue();
    setTimeout(() => {
        queue.push({
            type: 'subagent_notification',
            content: '<subagent_notification status="completed">Subagent Done</subagent_notification>',
            timestamp: Date.now()
        });
    }, 20);

    const start = Date.now();
    const result = await waitForInputOrNotification(queue, 'Your answer:', '', undefined, false, 'partial input');
    const duration = Date.now() - start;

    expect(result.type).toBe('subagent_notification');
    expect(result.draft).toBe('partial input');
    expect(duration).toBeLessThan(500);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`

- [ ] **Step 3: Implement non-blocking `process.stdin` keypress listener inside `waitForInputOrNotification`**

In `src/core/agents/developer-agent.ts`:
```typescript
async function nonBlockingPromptUser(message: string, initialDraft: string = '', prefix: string = ''): Promise<string> {
    return new Promise<string>((resolve) => {
        if (!process.stdin.isTTY) {
            resolve(initialDraft);
            return;
        }

        let draft = initialDraft;
        const promptLabel = `${prefix}${colors.dim('│')}  ${colors.bold(message)} `;
        process.stdout.write(`\n${promptLabel}${draft}`);

        const onData = (data: Buffer) => {
            const str = data.toString('utf-8');
            if (str === '\r' || str === '\n') {
                cleanup();
                process.stdout.write('\n');
                resolve(draft);
            } else if (str === '\u0003') { // Ctrl+C
                cleanup();
                process.stdout.write('\n');
                resolve('/cancel');
            } else if (str === '\u007f' || str === '\b') { // Backspace
                if (draft.length > 0) {
                    draft = draft.slice(0, -1);
                    process.stdout.write('\b \b');
                }
            } else if (str.length === 1 && str.charCodeAt(0) >= 32) {
                draft += str;
                process.stdout.write(str);
            }
        };

        const cleanup = () => {
            try {
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdin.off('data', onData);
            } catch {}
        };

        try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', onData);
        } catch {
            resolve(initialDraft);
        }
    });
}
```

- [ ] **Step 4: Run unit test to verify pass**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(developer-agent): implement non-blocking async keypress reader for TUI prompt"
```

---

### Task 2: Single-Source In-Memory IPC Notification & Deduplication Ledger

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:235-245`
- Modify: `src/core/workflow/subagent-manager.ts:500-550`
- Test: `src/core/workflow/subagent-manager.test.ts:200-240`

**Interfaces:**
- Consumes: `SubagentManager.invokeSubagents(subagents, parentId, parentQueue)`
- Produces: `parentQueue.push({ type: 'subagent_notification', content: ... })` on child process exit

- [ ] **Step 1: Write failing unit test for single-source in-memory notification**

In `src/core/workflow/subagent-manager.test.ts`:
```typescript
it('delivers single-source in-memory subagent notification directly to parentQueue', async () => {
    const queue = new MessageQueue();
    const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
    const parentId = 'parent-1';
    
    await subagentManager.invokeSubagents(subagents, parentId, queue);
    
    const nextMsg = await queue.next();
    expect(nextMsg.type).toBe('subagent_notification');
    expect(nextMsg.content).toContain('[Subagent Notification]');
    expect(nextMsg.content).toContain('Tester');
    expect(queue.isEmpty()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 3: Update `recordedSubagents` regex and single-source exit notification in `SubagentManager`**

In `src/core/workflow/subagent-manager.ts`:
Update regex in `sendMessage` to `/\(subagent-[^)]+\)/i`.
Update `child.on('exit')` handler to push exact subagent notification to `parentQueue` in memory if provided.

- [ ] **Step 4: Run unit test to verify pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat(subagents): implement single-source in-memory IPC notification on child exit"
```

---

### Task 3: Interactive REPL Lifecycle & Full Suite Verification

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

- [ ] **Step 1: Verify `keepGoing` remains `true` in interactive CLI mode across completions**

In `src/core/agents/developer-agent.ts`:
```typescript
if (isSubagent || isBatchMode) {
    finalSummary = taskSummary;
    keepGoing = false;
    break;
} else {
    log.success(`✔ Task Completed: ${taskSummary}`);
    // Keep loop alive for user's next command or incoming subagent notification
}
```

- [ ] **Step 2: Run full Vitest suite across all 44 test files**

Run: `npx vitest run`
Expected: PASS (44 test files passing, 272+ tests passing)

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix(developer-agent): preserve interactive REPL loop lifecycle and verify full test suite"
```
