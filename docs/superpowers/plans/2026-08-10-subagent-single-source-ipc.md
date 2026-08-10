# Single-Source In-Memory Subagent IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single-source in-memory IPC pipeline for subagent notifications to eliminate lost notifications, background disk polling (`setInterval`), and premature parent execution loop exit during sequential subagent orchestration.

**Architecture:** Replace dual-channel notification handling (disk mailbox polling + exit handler) with a single-source in-memory IPC queue event on subagent child process exit (`child.on('exit')`). Remove `mailboxInterval` disk polling. Preserve parent loop lifecycle across multi-step plan executions in `developer-agent.ts`.

**Tech Stack:** TypeScript, Node.js `child_process` (fork), Vitest, `@clack/prompts`.

## Global Constraints

- Never use background disk polling (`setInterval`) for process notification delivery.
- Subagent completion events must deliver exactly ONE in-memory event to `parentQueue`.
- Prevent duplicate messages using `recordedSubagents` tracking ledger.
- Interrupted TUI prompts must preserve user draft text in `userDraftBuffer`.

---

### Task 1: Single-Source In-Memory IPC Notification & Deduplication Ledger

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:500-540`
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

### Task 2: Remove Disk Polling & Preserve Parent Loop Lifecycle

**Files:**
- Modify: `src/core/agents/developer-agent.ts:175-195`
- Modify: `src/core/agents/developer-agent.ts:1060-1090`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `subagentManager.invokeSubagents(subagents, parentId, messageQueue)`
- Produces: Persistent `interactiveDeveloperAgent` loop execution without `mailboxInterval` `setInterval`

- [ ] **Step 1: Write failing test verifying parent agent loop does not terminate when active subagents count drops to 0**

In `src/core/agents/developer-agent.test.ts`:
```typescript
it('does not exit developer agent loop on intermediate task complete when active subagents is zero', async () => {
    vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
        action: { type: 'complete_task', summary: 'Subtask 1 done', content: 'Subtask 1 details' },
        actions: [],
        message: 'Subtask 1 complete',
        conversation_id: 'conv-123'
    });
    
    // Simulate subagentManager active subagents count = 0
    vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([]);
    
    // Loop should stay active and not return immediately with finalSummary
    const promise = interactiveDeveloperAgent({ taskInstruction: 'Run plan', auto: true });
    await new Promise(r => setTimeout(r, 50));
    expect(subagentManager.getActiveSubagentsForParent).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`

- [ ] **Step 3: Remove `mailboxInterval` disk polling and pass `messageQueue` to `invokeSubagents` in `developer-agent.ts`**

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
Do not exit loop if plan/workflow tasks remain pending in `.shark/progress.md`.

- [ ] **Step 4: Run full Vitest suite to verify all 266+ tests pass**

Run: `npx vitest run`
Expected: PASS (43 test files passing)

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix(developer-agent): remove disk polling interval and preserve loop lifecycle across subagent steps"
```
