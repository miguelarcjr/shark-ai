# Pure In-Memory Full Payload Subagent IPC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 100% pure in-memory full payload IPC delivery for subagents so that detailed reports (analyses, code diffs, findings) are delivered directly to `parentQueue` in memory in 0ms, unblocking the parent agent during `wait` without physical disk files or truncated 1-line messages.

**Architecture:** Update `subagentManager.sendMessage` and subagent child process exit handling to capture the full detailed report payload and push it directly into `parentQueue` in memory. Update `waitForInputOrNotification` to unblock instantly on `messageQueue.next()`.

**Tech Stack:** TypeScript, Node.js EventEmitter / `MessageQueue`, Vitest.

## Global Constraints

- Deliver 100% full detailed subagent report payloads directly in memory (`parentQueue.push`).
- Do not truncate or reduce subagent reports to 1-line summaries.
- Subagent completion events must unblock `action: wait` in 0ms without disk reads.

---

### Task 1: Direct Full Payload In-Memory IPC Delivery (`subagent-manager.ts`)

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:235-255`
- Modify: `src/core/workflow/subagent-manager.ts:500-555`
- Test: `src/core/workflow/subagent-manager.test.ts:210-245`

**Interfaces:**
- Consumes: `SubagentManager.sendMessage(recipient, message)` and `SubagentManager.invokeSubagents(subagents, parentId, parentQueue)`
- Produces: Direct `parentQueue.push({ type: 'subagent_notification', content: fullPayload })` with full report content

- [ ] **Step 1: Write failing unit test for full payload in-memory delivery**

In `src/core/workflow/subagent-manager.test.ts`:
```typescript
it('delivers full detailed report payload directly to parentQueue in memory without truncation', async () => {
    const queue = new MessageQueue();
    const subagents = [{ TypeName: 'self', Role: 'Implementer', Prompt: 'Build feature' }];
    const parentId = 'parent-full-payload-test';
    
    // Simulate subagent sending full detailed report via sendMessage
    const detailedReport = `[Subagent Notification] Subagent Implementer (subagent-test-123) completed.\nResult Details:\n- Created file src/foo.ts\n- Passed 10 unit tests`;
    subagentManager.registerSubagent('subagent-test-123', 'self', 'Implementer', parentId);
    
    // Wire parentQueue to subagentManager
    (subagentManager as any).parentQueues = (subagentManager as any).parentQueues || new Map();
    (subagentManager as any).parentQueues.set(parentId, queue);
    
    subagentManager.sendMessage(parentId, detailedReport);
    
    const nextMsg = await queue.next();
    expect(nextMsg.type).toBe('subagent_notification');
    expect(nextMsg.content).toContain('Result Details:');
    expect(nextMsg.content).toContain('- Created file src/foo.ts');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`

- [ ] **Step 3: Update `sendMessage` in `subagent-manager.ts` to push full payload directly to `parentQueue` in real time**

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

    // Real-time direct in-memory delivery of full payload
    const parentQueue = this.parentQueues.get(recipient);
    if (parentQueue) {
        const formattedContent = message.startsWith('<subagent_notification')
            ? message
            : `<subagent_notification status="completed">\n${message}\n</subagent_notification>`;
        parentQueue.push({
            type: 'subagent_notification',
            content: formattedContent,
            timestamp: Date.now()
        });
    }
}
```

- [ ] **Step 4: Run unit test to verify pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat(subagents): deliver full detailed subagent report payload directly to parentQueue in memory"
```

---

### Task 2: Full Suite Verification & REPL Lifecycle

**Files:**
- Test: `src/core/agents/developer-agent.test.ts`

- [ ] **Step 1: Run full Vitest test suite**

Run: `npx vitest run`
Expected: PASS (44 test files passing, 273+ tests passing)

- [ ] **Step 2: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix(developer-agent): verify full payload subagent IPC delivery and test suite"
```
