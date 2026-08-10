# Design Spec: Pure In-Memory Full Payload Subagent IPC & Non-Blocking TUI

## Goal Description
Establish a 100% pure in-memory IPC delivery pipeline for subagents that delivers full detailed subagent report payloads directly in memory without relying on disk mailbox files or generating truncated 1-line messages.
1. When a subagent finishes, its complete detailed markdown report payload is pushed directly into `parentQueue` in memory (`parentQueue.push(...)`).
2. When the parent agent executes the `wait` action waiting for subagent completion, the full report payload unblocks `waitForInputOrNotification` instantly (0ms) in memory without requiring Enter or physical disk file polling.
3. In interactive CLI mode (`shark dev`), `keepGoing` remains `true` continuously across task completions until explicit user exit (`Ctrl+C`, `/exit`, `/quit`).

---

## 1. Architectural Design

### A. Pure In-Memory Full Payload IPC Delivery (`subagent-manager.ts`)
- In `subagentManager.sendMessage(recipient, message)` or `child.on('exit')`, eliminate disk dependency for process communication.
- Deliver the **FULL detailed subagent report payload** (`content`, `summary`, `status`, code diffs) directly to `parentQueue.push({ type: 'subagent_notification', content: fullPayload })`.
- Maintain `recordedSubagents: Set<string>` to track subagent IDs and ensure zero duplicate messages are delivered.

### B. Immediate Payload Consumption in Wait Loop (`developer-agent.ts`)
- When the parent agent executes `action: wait` or handles subagent notifications in `waitForInputOrNotification`:
  - As soon as the subagent completes, `messageQueue.next()` resolves with the **FULL subagent report payload**.
  - `resultMsg` receives the complete detailed report content.
  - The parent LLM receives the full subagent report on turn $N+1$, allowing it to update `.shark/progress.md` and immediately launch the next subagent without issuing repeated `wait` actions or stopping at `Your answer:`.

### C. Non-Blocking Async Keypress Reader (`developer-agent.ts`)
- Replace blocking `clack.text()` calls inside `waitForInputOrNotification` with a non-blocking `process.stdin` keypress listener styled with Clack UI borders (`│  Your answer:`).
- When a subagent completion event arrives in `messageQueue`, resolve `waitForInputOrNotification` instantly (0ms) in memory without waiting for a physical Enter keypress.
- Preserve any typed characters in `userDraftBuffer` and restore them when rendering prompt lines.

---

## 2. Verification Plan

### Automated Tests
1. Unit tests in `src/core/workflow/subagent-manager.test.ts`:
   - Verify subagent process exit delivers the **FULL detailed report payload** to `parentQueue`.
   - Verify zero duplicate messages are pushed.
2. Unit tests in `src/core/agents/developer-agent.test.ts`:
   - Verify `action: wait` unblocks instantly upon receiving full subagent report payload in memory.
   - Verify interactive agent loop stays alive (`keepGoing = true`) on `complete_task` in interactive mode.
3. Run full Vitest suite: `npx vitest run`.

### Manual Verification
1. Run `shark dev` interactively on Mac, execute a multi-subagent task (`/super` or sequential briefs), verify subagent 1 delivers full report to parent agent in memory instantly (0ms), and verify parent agent launches subagent 2 ➔ 3 ➔ 4 automatically without stopping at `wait` or requiring Enter.
