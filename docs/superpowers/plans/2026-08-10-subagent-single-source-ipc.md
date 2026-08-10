# Single-Source In-Memory Subagent IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single-source in-memory IPC pipeline for subagent notifications to eliminate notification loss, background disk polling (`setInterval`), and premature parent REPL loop termination during interactive CLI sessions (`shark dev`).

**Architecture:** Replace background disk mailbox polling with a single-source in-memory IPC queue event on subagent child process exit (`child.on('exit')`). Remove `mailboxInterval` disk polling. Update interactive developer agent loop so `keepGoing` remains `true` continuously during interactive CLI sessions (`isBatchMode: false`).

**Tech Stack:** TypeScript, Node.js `child_process` (fork), Vitest, `@clack/prompts`.

## Global Constraints

- Never use background disk polling (`setInterval`) for process notification delivery.
- Subagent completion events must deliver exactly ONE in-memory event to `parentQueue`.
- Prevent duplicate messages using `recordedSubagents` tracking ledger.
- In interactive CLI mode (`isBatchMode: false`), `keepGoing` remains `true` continuously across task completions until explicit user exit (`Ctrl+C`, `/exit`, `/quit`).

---

### Task 1: Single-Source In-Memory IPC Notification & Deduplication Ledger

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:500-550`
- Modify: `src/core/workflow/subagent-manager.ts:235-245`
- Test: `src/core/workflow/subagent-manager.test.ts:200-240`

**Interfaces:**
- Consumes: `SubagentManager.invokeSubagents(subagents, parentId, parentQueue)`
- Produces: `parentQueue.push({ type: 'subagent_notification', content: ... })` on child process exit

- [ ] **Step 1: Write failing unit test for single-source in-memory notification**

In `src/core/workflow/subagent-manager.test.ts`:
```typescript
it('delivers exactly one in-memory notification on subagent process exit without disk polling', async () => {
    const queue = new MessageQueue();
    const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
    const parentId = 'parent-test-1';
    
    await subagentManager.invokeSubagents(subagents, parentId, queue);
    
    const nextMsg = await queue.next();
    expect(nextMsg.type).toBe('subagent_notification');
    expect(nextMsg.content).toContain('[Subagent Notification]');
    expect(queue.isEmpty()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 3: Update `recordedSubagents` regex and single-source exit notification in `SubagentManager`**

In `src/core/workflow/subagent-manager.ts`:
```typescript
sendMessage(recipient: string, message: string) {
    const match = message.match(/\(subagent-[^)]+\)/i);
    if (match) {
        const matchedId = match[0].slice(1, -1);
        this.recordedSubagents.add(matchedId);
    }
    const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', recipient);
    fs.mkdirSync(mailboxDir, { recursive: true });
    const seq = (this.messageSeq++).toString().padStart(6, '0');
    const filePath = path.join(mailboxDir, `${Date.now()}-${seq}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ message }), 'utf-8');
}
```

And in `child.on('exit')`:
```typescript
child.on('exit', (exitCode) => {
    const state = this.subagents.get(id);
    if (state) {
        state.endedAt = Date.now();
        state.status = exitCode === 0 ? 'completed' : 'failed';
        this.saveSubagents();
    }

    let hasReturnedDetails = this.recordedSubagents.has(id);
    if (!hasReturnedDetails) {
        this.recordedSubagents.add(id);
        const statusStr = exitCode === 0 ? 'COMPLETED' : 'FAILED';
        const notificationContent = `[Subagent Notification] Subagent ${sub.Role} (${id}) has finished with status: ${statusStr}.`;
        
        if (parentQueue) {
            parentQueue.push({
                type: 'subagent_notification',
                content: notificationContent,
                timestamp: Date.now(),
                metadata: { subagentId: id, role: sub.Role, status: exitCode === 0 ? 'completed' : 'failed' }
            });
        }
    }
});
```

- [ ] **Step 4: Run unit test to verify pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat(subagents): implement single-source in-memory IPC notification on child exit"
```

---

### Task 2: Remove Disk Polling & Maintain Interactive REPL Lifecycle

**Files:**
- Modify: `src/core/agents/developer-agent.ts:175-195`
- Modify: `src/core/agents/developer-agent.ts:1060-1095`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `subagentManager.invokeSubagents(subagents, parentId, messageQueue)`
- Produces: Persistent `interactiveDeveloperAgent` loop execution in interactive CLI mode without `mailboxInterval` `setInterval`

- [ ] **Step 1: Write failing test verifying interactive agent loop stays alive (`keepGoing = true`) on `complete_task` in interactive mode**

In `src/core/agents/developer-agent.test.ts`:
```typescript
it('keeps interactive developer agent loop alive on complete_task in interactive mode', async () => {
    vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
        action: { type: 'complete_task', summary: 'Subtask done', content: 'Subtask details' },
        actions: [],
        message: 'Subtask complete',
        conversation_id: 'conv-123'
    });
    
    // In interactive mode (auto: false), completing task should log success and prompt for next input
    const promise = interactiveDeveloperAgent({ taskInstruction: 'Run task', auto: false });
    await new Promise(r => setTimeout(r, 50));
    expect(tui.text).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`

- [ ] **Step 3: Remove `mailboxInterval` disk polling and update interactive mode lifecycle in `developer-agent.ts`**

In `src/core/agents/developer-agent.ts`:
Remove `mailboxInterval = setInterval(...)`.

In `action.type === 'invoke_subagent'`:
```typescript
const invoked = await subagentManager.invokeSubagents(
    [{ TypeName: parsed.type, Role: parsed.role, Prompt: parsed.prompt }],
    parentId,
    messageQueue
);
```

In `action.type === 'complete_task'`:
```typescript
if (isSubagent || isBatchMode) {
    finalSummary = taskSummary;
    keepGoing = false;
    break;
} else {
    log.success(`✔ Task Completed: ${taskSummary}`);
    // In interactive mode, keep loop alive for user's next command or subagent notification
}
```

- [ ] **Step 4: Run full Vitest suite to verify all 266+ tests pass**

Run: `npx vitest run`
Expected: PASS (43 test files passing)

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix(developer-agent): remove disk polling interval and preserve interactive REPL loop lifecycle"
```
