# Design Spec: Single-Source In-Memory Subagent IPC & Event-Driven Pipeline

## Goal Description
Establish a single, robust, in-memory IPC delivery pipeline for subagent notifications and correct interactive developer agent loop lifecycle behavior:
1. Eliminate subagent notification loss and background disk-polling (`setInterval`).
2. Fix interactive CLI session lifecycle so `keepGoing` stays `true` continuously during interactive CLI sessions (`shark dev`), keeping the agent alive across task completions until the user explicitly exits (`Ctrl+C`, `/exit`, `/quit`).

---

## 1. Architectural Design

### A. Single Delivery Channel (`subagent-manager.ts`)
1. **Child Process Exit Handler**:
   - In `SubagentManager.invokeSubagents`, when a child subagent process exits (`child.on('exit')`), deliver exactly **ONE** notification event to `parentQueue` in memory (`parentQueue.push(...)`).
   - Remove background disk polling intervals (`mailboxInterval` / `setInterval` reading `.shark/mailbox/`). Disk mailbox files are written solely as static audit logs.
2. **Deduplication Ledger**:
   - Maintain `recordedSubagents: Set<string>` to track subagent completion IDs and ensure fallback messages are never sent twice.

### B. Interactive REPL Lifecycle & `keepGoing` Rules (`developer-agent.ts`)
1. **Interactive CLI Mode (`isBatchMode: false`)**:
   - `keepGoing` remains `true` continuously throughout the session.
   - When `complete_task` or `TASK_COMPLETED:` is executed, log `✔ Task Completed: [summary]`, reset transient state, and remain in the active `while (keepGoing)` prompt loop ready for the user's next command or incoming subagent notifications.
   - `keepGoing` becomes `false` **only** upon explicit user exit (`Ctrl+C`, `/exit`, `/quit`, `tui.isCancel`) or fatal system error.
2. **Non-Interactive / Subagent Process Mode (`isBatchMode: true` or `isSubagent: true`)**:
   - `complete_task` sets `keepGoing = false` to exit the child process (`exit 0`) and notify the parent process.
3. **In-Memory Queue Wiring**:
   - Pass `messageQueue` as `parentQueue` when `interactiveDeveloperAgent` calls `subagentManager.invokeSubagents(...)`.
   - Subagent completion triggers `parentQueue.push`, immediately resolving `queue.next()` inside `waitForInputOrNotification` without waiting for disk polling intervals.

---

## 2. Verification Plan

### Automated Tests
1. Unit tests in `src/core/workflow/subagent-manager.test.ts`:
   - Verify subagent process exit delivers exactly ONE `subagent_notification` to `parentQueue`.
   - Verify zero duplicate messages are pushed.
2. Unit tests in `src/core/agents/developer-agent.test.ts`:
   - Verify interactive agent loop stays alive (`keepGoing = true`) on `complete_task` in interactive mode.
   - Verify subagent completion wakes up `waitForInputOrNotification` immediately in memory.
3. Run full Vitest suite: `npx vitest run`.

### Manual Verification
1. Run `shark dev` interactively, execute a task that spawns subagents, verify subagent notifications wake up parent agent instantly, and verify the CLI prompt stays open for subsequent user commands after task completion.
