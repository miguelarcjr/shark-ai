# Subagent Non-Blocking Pipeline & Draft-Preserving TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate subagent completion fallback messages and implement non-blocking TUI input with automatic user draft preservation in Shark Dev.

**Architecture:** Maintain an in-memory `recordedSubagents: Set<string>` in `SubagentManager` to prevent duplicate exit messages. Refactor `waitForInputOrNotification` in `developer-agent.ts` to use asynchronous non-blocking input listening with a `draftBuffer` that saves partially typed user text when subagent notifications wake the agent, restoring the draft seamlessly when prompting resumes.

**Tech Stack:** TypeScript, Node.js (readline, events, fs), Vitest.

## Global Constraints

- Never lose user keystrokes typed into the CLI prompt line.
- Prevent duplicate mailbox notifications per subagent lifecycle.
- Maintain full compatibility with interactive (`!isAuto`) and batch (`--auto`) execution modes.

---

### Task 1: In-Memory Subagent Completion Tracking in `subagent-manager.ts`

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:20-40, 238-250, 500-535`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `sendMessage` calls with subagent ID tags `(subagent-uuid)`
- Produces: `recordedSubagents.has(id)` check in exit handler to skip duplicate fallback messages

- [ ] **Step 1: Write failing test in `subagent-manager.test.ts`**

```typescript
it('does not send fallback message on exit if subagent already recorded completion', async () => {
    const parentId = 'parent-ledger-test';
    const subId = 'subagent-recorded-123';
    subagentManager.registerSubagent(subId, 'self', 'Tester', parentId);

    // Simulate subagent calling complete_task which sends a message
    subagentManager.sendMessage(
        parentId,
        `[Subagent Notification] Subagent Tester (${subId}) completed.\nResult Details:\nDone`
    );

    // Retrieve the message (mailbox disk file is unlinked/renamed)
    const msgs = subagentManager.retrieveMessages(parentId);
    expect(msgs.length).toBe(1);

    // Simulate child process exit handler
    const state = subagentManager.getSubagentState(subId);
    if (state) {
        (subagentManager as any).terminateSubagent(subId, true);
    }

    // Check parent mailbox again - should NOT contain duplicate fallback message
    const extraMsgs = subagentManager.retrieveMessages(parentId);
    expect(extraMsgs.length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify failure state if present**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 3: Implement `recordedSubagents` tracking in `subagent-manager.ts`**

In `src/core/workflow/subagent-manager.ts`:
1. Add property `private recordedSubagents = new Set<string>();` to `SubagentManager`.
2. In `sendMessage(recipient, message)`:
```typescript
const match = message.match(/\(subagent-[a-f0-9-]+\)/i);
if (match) {
    const matchedId = match[0].slice(1, -1);
    this.recordedSubagents.add(matchedId);
}
```
3. In child exit handler (lines 505-535):
```typescript
if (this.recordedSubagents.has(id)) {
    // Already sent completion/failure message, skip fallback
    tui.log.success(`Subagent ${sub.Role} (${id}) completed.`);
} else {
    // Fallback if subagent exited without sending message
    const completedMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) completed successfully.`;
    this.sendMessage(parentId, completedMsg);
    tui.log.success(completedMsg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "fix(workflow): track recorded subagents in memory to prevent exit fallback duplicates"
```

---

### Task 2: Non-Blocking Input Handling & Draft Buffer Preservation in `developer-agent.ts`

**Files:**
- Modify: `src/core/agents/developer-agent.ts:74-148, 480-515, 620-640`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: Asynchronous keystrokes from `process.stdin`, subagent notifications from `messageQueue`
- Produces: Unblocked resolution on `subagent_notification` arrival while storing user text in `draftBuffer` and passing `initialValue: draftBuffer` back to prompt

- [ ] **Step 1: Write unit test in `developer-agent.test.ts`**

Verify that `waitForInputOrNotification` preserves user draft text when a subagent notification interrupts input:

```typescript
it('preserves draftBuffer when subagent notification interrupts prompt', async () => {
    const queue = new MessageQueue();
    // Push a notification after 10ms
    setTimeout(() => {
        queue.push({
            type: 'subagent_notification',
            content: '<subagent_notification status="completed">Done</subagent_notification>',
            timestamp: Date.now()
        });
    }, 10);

    const result = await waitForInputOrNotification(queue, 'Your answer:', '', undefined, false, 'my partial draft');
    expect(result.type).toBe('subagent_notification');
});
```

- [ ] **Step 2: Run test to verify failure or expected behavior**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`

- [ ] **Step 3: Update `waitForInputOrNotification` and `interactiveDeveloperAgent` in `developer-agent.ts`**

1. Update `waitForInputOrNotification` signature to accept `initialDraft?: string`:
```typescript
export async function waitForInputOrNotification(
    queue: MessageQueue,
    promptMessage: string = 'Your answer:',
    subagentPrefix: string = '',
    timeoutMs?: number,
    isAuto: boolean = false,
    initialDraft: string = ''
): Promise<{ message: QueueMessage, currentDraft: string }> {
    // ...
```
2. Refactor input listening: when a `subagent_notification` arrives, store the current user typed text in `currentDraft` and resolve immediately without blocking on `process.stdin`.
3. In `interactiveDeveloperAgent`: maintain `let userDraftBuffer = '';`. Pass `userDraftBuffer` to `waitForInputOrNotification`. If user submits input, reset `userDraftBuffer = ''`. If subagent notification arrives, keep `userDraftBuffer` intact so next prompt re-opens with `initialValue: userDraftBuffer`.

- [ ] **Step 4: Run tests to verify passing state**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(agent): implement non-blocking subagent notification handling with draft buffer preservation"
```

---

### Task 3: Full End-to-End Verification

**Files:**
- Test: Full Vitest suite

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: 264+ tests PASS.

- [ ] **Step 2: Commit clean state**

```bash
git add .
git commit -m "test(agent): complete non-blocking draft-preserving subagent pipeline implementation"
```
