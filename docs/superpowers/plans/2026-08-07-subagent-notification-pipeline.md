# Subagent Notification Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify subagent completion, crash, and cancellation notifications into a single disk-based Mailbox channel, preventing duplicate prompt injections and agent freezing in Shark Dev.

**Architecture:** Remove direct in-memory `parentQueue.push` calls from `subagentManager.invokeSubagents`. Use `.shark/mailbox/` as the single source of truth for subagent status notifications. Format all incoming mailbox messages into standardized `<subagent_notification status="...">` XML blocks and deduplicate message ingestion in `developer-agent.ts`.

**Tech Stack:** TypeScript, Node.js (fs, child_process), Vitest.

## Global Constraints

- Retain backward compatibility with existing subagent task brief frontmatter parsing.
- Ensure Windows-safe file operations (`.processed` atomic rename / delete retry).
- No duplicate messages allowed in `messageQueue` or prompt injections.

---

### Task 1: Unify Subagent Exit & Crash Handlers in `subagent-manager.ts`

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:500-580`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: Subagent process exit events, crash logs from `_sharkrc/history/`
- Produces: Single disk mailbox notification per subagent status update via `this.sendMessage(parentId, ...)`

- [ ] **Step 1: Write the failing unit tests in `subagent-manager.test.ts`**

Update `subagent-manager.test.ts` to verify that `invokeSubagents` does NOT push direct duplicate messages into `parentQueue` when subagent exits, and that crash notifications contain formatted logs in Mailbox only.

```typescript
it('does not duplicate notifications into parentQueue when mailbox already has subagent message', async () => {
    const queue = new MessageQueue();
    const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
    const parentId = 'parent-no-dup';

    await subagentManager.invokeSubagents(subagents, parentId, queue);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Disk mailbox should contain the notification
    const diskMsgs = subagentManager.retrieveMessages(parentId);
    expect(diskMsgs.length).toBe(1);

    // parentQueue should remain empty (or only populated by mailbox reader, not direct push)
    expect(queue.isEmpty()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: FAIL due to `queue.next()` receiving `subagent_notification` directly from `invokeSubagents`.

- [ ] **Step 3: Modify `src/core/workflow/subagent-manager.ts` to remove direct queue push and standardize exit notifications**

Remove lines 537-562 (`parentQueue.push(...)` in `invokeSubagents`) and refine exit handling:

```typescript
// In subagent-manager.ts invokeSubagents exit handler:
const isCancelled = this.subagents.get(id)?.status === 'cancelled';
const success = exitCode === 0;
this.terminateSubagent(id, success);

if (isCancelled) {
    this.updateSubagentSummary(id, 'Terminated by parent agent.');
    tui.log.message(`\nSubagent ${sub.Role} (${id}) cancelled.`);
} else if (!success) {
    this.updateSubagentSummary(id, 'Failed');
    const lastLogs = this.getSubagentLogs(id, 15);
    const fallbackMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) failed (Exit Code: ${exitCode}). Last console logs:\n${lastLogs}`;
    const parentMsgs = this.peekMessages(parentId);
    const hasExistingMsg = parentMsgs.some(m => m.includes(`(${id})`));
    if (!hasExistingMsg) {
        this.sendMessage(parentId, fallbackMsg);
    }
    tui.log.error(`Subagent ${sub.Role} (${id}) failed.`);
} else {
    this.updateSubagentSummary(id, 'Completed');
    const parentMsgs = this.peekMessages(parentId);
    const hasExistingMsg = parentMsgs.some(m => m.includes(`(${id})`));
    if (!hasExistingMsg) {
        const completedMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) completed successfully.`;
        this.sendMessage(parentId, completedMsg);
        tui.log.success(completedMsg);
    } else {
        const subagentMsg = parentMsgs.find(m => m.includes(`(${id})`));
        if (subagentMsg) {
            tui.log.message(`\n${subagentMsg}`);
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "fix(workflow): remove duplicate queue push and unify subagent exit notifications to mailbox"
```

---

### Task 2: Standardize XML Notification Ingestion in `developer-agent.ts`

**Files:**
- Modify: `src/core/agents/developer-agent.ts:175-195, 490-515`
- Test: `src/commands/dev.test.ts`

**Interfaces:**
- Consumes: Raw mailbox strings from `subagentManager.retrieveMessages()`
- Produces: Formatted `<subagent_notification status="...">` blocks injected once into turn prompt

- [ ] **Step 1: Write failing unit test in `src/commands/dev.test.ts` or new test file**

Verify that `developer-agent` formats mailbox messages as `<subagent_notification>` XML tags and does not process duplicate messages in a single turn.

```typescript
it('formats subagent mailbox messages into structured XML notifications without duplication', async () => {
    const rawMsg = '[Subagent Notification] Subagent Tester (subagent-123) completed.\nResult Details:\nDone!';
    const formatted = subagentManager.retrieveMessages('parent-1');
    // Verify XML formatting wrapper
    expect(formatted).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 3: Update `src/core/agents/developer-agent.ts` mailbox polling and prompt injection**

In `developer-agent.ts`:
1. In `mailboxInterval` (lines 175-193):
```typescript
mailboxInterval = setInterval(() => {
    try {
        const newMsgs = subagentManager.retrieveMessages(myId);
        for (const msg of newMsgs) {
            let status = 'completed';
            if (msg.includes('FAILED') || msg.includes('failed')) status = 'failed';
            if (msg.includes('CANCELLED') || msg.includes('cancelled')) status = 'cancelled';

            const formatted = `<subagent_notification status="${status}">\n${msg}\n</subagent_notification>`;
            messageQueue.push({
                type: 'subagent_notification',
                content: formatted,
                timestamp: Date.now()
            });
        }
    } catch (e) {}
}, 2000);
```

2. In turn loop (lines 485-502), deduplicate reading so messages are read once from `messageQueue`:
```typescript
const queuedMessages: string[] = [];
while (!messageQueue.isEmpty()) {
    const qMsg = await messageQueue.next();
    if (qMsg && qMsg.content) {
        queuedMessages.push(qMsg.content);
    }
}

let currentTurnPrompt = nextPrompt;
if (queuedMessages.length > 0) {
    currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${queuedMessages.join('\n\n')}\n`;
}
```

- [ ] **Step 4: Run all tests to verify passing state**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts
git commit -m "feat(agent): standardize subagent XML notifications and deduplicate prompt ingestion"
```

---

### Task 3: Full End-to-End Verification

**Files:**
- Test: `src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass with 0 failures.

- [ ] **Step 2: Commit any final test cleanups**

```bash
git add .
git commit -m "test(workflow): complete verification for subagent notification pipeline fix"
```
