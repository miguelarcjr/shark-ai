# Design Spec: Single-Source In-Memory Subagent IPC & Event-Driven Pipeline

## Goal Description
Establish a single, robust, in-memory IPC delivery pipeline for subagent notifications, eliminating duplicate messages, background disk-polling (`setInterval`), and premature parent loop termination during multi-subagent sequential executions (e.g. `subagent-driven-development-lite`).

---

## 1. Architectural Design: Pure In-Memory Channel (Single Source of Truth)

### A. Single Delivery Channel (`subagent-manager.ts`)
1. **Child Process Exit Handler**:
   - In `SubagentManager.invokeSubagents`, when the subagent process exits (`child.on('exit')`), deliver exactly **ONE** notification event to `parentQueue` in memory (`parentQueue.push(...)`).
   - Remove background disk polling intervals (`mailboxInterval` / `setInterval` reading `.shark/mailbox/`). Disk mailbox files are written solely as static audit logs.
2. **Deduplication Ledger**:
   - Maintain `recordedSubagents: Set<string>` to track subagent completion IDs and ensure fallback messages are never sent twice.

### B. Event-Driven Parent Loop & Lifecycle (`developer-agent.ts`)
1. **In-Memory Queue Wiring**:
   - Pass `messageQueue` as `parentQueue` when `interactiveDeveloperAgent` calls `subagentManager.invokeSubagents(...)`.
   - Subagent completion triggers `parentQueue.push`, immediately resolving `queue.next()` inside `waitForInputOrNotification` without waiting for disk polling intervals.
2. **Lifecycle Preservation During Workflows**:
   - In `interactiveDeveloperAgent`, update intermediate completion checks (`action.type === 'complete_task'` or `TASK_COMPLETED:`): do NOT exit the parent loop (`keepGoing = false`) if active workflow/plan tasks remain pending in `.shark/progress.md`.
   - Maintain `userDraftBuffer` preservation so interrupted TUI prompts retain user draft text seamlessly.

---

## 2. Verification Plan

### Automated Tests
1. Unit tests in `src/core/workflow/subagent-manager.test.ts`:
   - Verify that subagent process exit delivers exactly ONE `subagent_notification` to `parentQueue`.
   - Verify zero duplicate messages are pushed.
2. Unit tests in `src/core/agents/developer-agent.test.ts`:
   - Verify subagent completion wakes up `waitForInputOrNotification` immediately in memory.
   - Verify parent agent loop continues execution across sequential subagent delegations.
3. Run full Vitest suite: `npx vitest run`.

### Manual Verification
1. Run a 4-step sequential subagent workflow to confirm every subagent delivers its completion notification in memory and the parent agent triggers "Shark Dev working..." instantly on every step.
