# Design Spec: Single-Source In-Memory Subagent IPC & Event-Driven Pipeline

## Goal Description
Fix subagent notification loss and premature parent loop termination during multi-subagent sequential executions (e.g. `subagent-driven-development-lite`). 

Previously, commit `9359627` removed direct in-memory `parentQueue.push` notifications upon child process exit to eliminate duplicate notifications. However, this left notification delivery 100% dependent on disk polling (`mailboxInterval`). When active subagent count briefly dropped to 0 between sequential tasks (such as task 3 implementer completing before task 4 reviewer was spawned), the parent loop checked `getActiveSubagentsForParent.length === 0` and exited early (`keepGoing = false`), shutting down `mailboxInterval` and losing subsequent subagent notifications.

This spec details a single-source, event-driven in-memory IPC pipeline that guarantees instant notification delivery upon process exit without duplicate messages or premature process termination.

---

## 1. Architectural Changes

### A. Single-Source In-Memory IPC Delivery (`subagent-manager.ts`)
1. **Child Process Exit Handler**:
   - In `SubagentManager.invokeSubagents`, when the subagent child process exits (`child.on('exit')`), check `recordedSubagents.has(id)`.
   - If `recordedSubagents` does not yet contain `id`, format the completion/failure notification payload and push it directly to `parentQueue` in memory (`parentQueue.push(...)`).
   - Add `id` to `recordedSubagents`.
2. **Deduplication Ledger**:
   - Update `recordedSubagents` regex matching in `sendMessage` to `/\(subagent-[^)]+\)/i` to support all subagent ID formats.
   - When a notification is pushed via `parentQueue` or `sendMessage`, record `id` in `recordedSubagents` to suppress duplicate exit fallback messages.

### B. Event-Driven Parent Loop & Lifecycle (`developer-agent.ts`)
1. **In-Memory Queue Wiring**:
   - Pass `messageQueue` as `parentQueue` when `interactiveDeveloperAgent` calls `subagentManager.invokeSubagents(...)`.
   - When a subagent exits, `parentQueue.push` immediately resolves `queue.next()` inside `waitForInputOrNotification`, waking up the parent loop instantly in memory without waiting for disk polling intervals.
2. **Lifecycle Preservation During Workflows**:
   - In `interactiveDeveloperAgent`, update intermediate completion checks (`action.type === 'complete_task'` or `TASK_COMPLETED:`): do NOT exit the parent loop (`keepGoing = false`) if active workflow/plan tasks remain pending in `.shark/progress.md`.
   - Maintain `userDraftBuffer` preservation so interrupted TUI prompts retain user draft text seamlessly.

---

## 2. Verification Plan

### Automated Tests
1. Unit tests in `src/core/workflow/subagent-manager.test.ts`:
   - Verify that subagent process exit delivers exactly ONE `subagent_notification` to `parentQueue`.
   - Verify `recordedSubagents` prevents duplicate fallback messages on exit.
2. Unit tests in `src/core/agents/developer-agent.test.ts`:
   - Verify subagent completion wakes up `waitForInputOrNotification` immediately.
   - Verify parent agent loop continues execution across sequential subagent delegations.
3. Run full Vitest suite: `npx vitest run`.

### Manual Verification
1. Run a 4-step sequential subagent workflow to confirm every subagent delivers its completion notification and the parent agent triggers "Shark Dev working..." instantly on every step.
