# Design Spec: Single-Source In-Memory Subagent IPC & Non-Blocking TUI Prompt

## Goal Description
Establish a single, robust, in-memory IPC delivery pipeline for subagent notifications and a non-blocking async keypress TUI prompt renderer:
1. Deliver subagent completion notifications directly in memory (`parentQueue.push`) on child process exit (`child.on('exit')`) in 0ms without duplicate messages or background disk-polling (`setInterval`).
2. Replace blocking `tui.text()` with a non-blocking Async Keypress Reader styled with 100% identical `@clack/prompts` visual design (`│  Your answer:`).
3. Ensure subagent completion notifications unblock the parent agent loop instantly in 0ms on Mac & Windows without requiring a physical Enter keypress, while preserving any user draft text seamlessly.
4. Maintain `keepGoing = true` continuously during interactive CLI sessions (`shark dev`) across task completions until explicit user exit (`Ctrl+C`, `/exit`, `/quit`).

---

## 1. Architectural Design

### A. Non-Blocking Async Keypress Reader (`developer-agent.ts`)
- Replace blocking `clack.text()` calls inside `waitForInputOrNotification` with a non-blocking `process.stdin` keypress listener in raw TTY mode.
- Render prompt lines using exact `@clack/prompts` visual formatting (`│  Your answer: ` in cyan/gray with live draft text buffer).
- When a subagent completion event arrives in `messageQueue`, resolve `waitForInputOrNotification` instantly (0ms) without waiting for a physical Enter keypress.
- Preserve any typed characters in `userDraftBuffer` and restore them when rendering the prompt on subsequent turns.

### B. Single Delivery Channel (`subagent-manager.ts`)
1. **Child Process Exit Handler**:
   - In `SubagentManager.invokeSubagents`, when a child subagent process exits (`child.on('exit')`), deliver exactly **ONE** notification event to `parentQueue` in memory (`parentQueue.push(...)`).
   - Remove background disk polling intervals (`mailboxInterval` / `setInterval` reading `.shark/mailbox/`). Disk mailbox files are written solely as static audit logs.
2. **Deduplication Ledger**:
   - Maintain `recordedSubagents: Set<string>` to track subagent completion IDs and ensure fallback messages are never sent twice.

### C. Interactive REPL Lifecycle & `keepGoing` Rules (`developer-agent.ts`)
1. **Interactive CLI Mode (`isBatchMode: false`)**:
   - `keepGoing` remains `true` continuously throughout the session.
   - When `complete_task` or `TASK_COMPLETED:` is executed, log `✔ Task Completed: [summary]`, reset transient state, and remain in the active `while (keepGoing)` prompt loop ready for the user's next command or incoming subagent notifications.
   - `keepGoing` becomes `false` **only** upon explicit user exit (`Ctrl+C`, `/exit`, `/quit`, `tui.isCancel`) or fatal system error.
2. **Non-Interactive / Subagent Process Mode (`isBatchMode: true` or `isSubagent: true`)**:
   - `complete_task` sets `keepGoing = false` to exit the child process (`exit 0`) and notify the parent process.

---

## 2. Verification Plan

### Automated Tests
1. Unit tests in `src/core/workflow/subagent-manager.test.ts`:
   - Verify subagent process exit delivers exactly ONE `subagent_notification` to `parentQueue`.
   - Verify zero duplicate messages are pushed.
2. Unit tests in `src/core/agents/developer-agent.test.ts`:
   - Verify interactive agent loop stays alive (`keepGoing = true`) on `complete_task` in interactive mode.
   - Verify subagent completion resolves `waitForInputOrNotification` instantly in memory.
3. Run full Vitest suite: `npx vitest run`.

### Manual Verification
1. Run `shark dev` interactively on Mac/Windows, execute a multi-subagent task, verify subagent notifications unblock parent agent instantly on every step without pressing Enter, and verify user draft text is preserved.
