# Subagent Notification Pipeline & Non-Blocking Draft-Preserving TUI Design

**Date**: 2026-08-07  
**Status**: Approved  
**Topic**: Fix duplicate notifications, eliminate exit fallbacks, and implement non-blocking TUI input with draft buffer preservation in Shark Dev  

---

## 1. Context & Problem Statement

### Identified Issues
1. **Duplicate Message Fallback**: When a subagent calls `complete_task`, it writes a detailed message to `.shark/mailbox/[parentId]/...json`. When the subagent child process exits (`exitCode === 0`), `SubagentManager` checks disk for mailbox files containing `(${id})`. If the parent agent had already read and unlinked/renamed the message, `SubagentManager` falsely assumed no result details were sent and wrote a 2nd generic fallback message (`"[Subagent Notification] Subagent Role (id) completed successfully but did not return detailed results."`). This caused 5 subagents to produce 8 notifications.
2. **TUI Stdin Blocking & Unresponsive Input**: In interactive mode (`!isAuto`), `@clack/prompts` locked `process.stdin` synchronously. When a subagent notification arrived in `messageQueue`, `waitForInputOrNotification` attempted to emit synthetic `process.stdin.emit('keypress', '\r')` events, which were ignored by `@clack/prompts` on Windows/Mac. This left the CLI hanging until the user physically pressed Enter on the keyboard.

---

## 2. Architecture & Design Decisions

### 2.1 In-Memory Recorded Subagents Ledger (`subagent-manager.ts`)
- Maintain a `recordedSubagents: Set<string>` inside `SubagentManager`.
- Whenever a subagent dispatches a completion or failure result via `sendMessage(parentId, ...)`, its ID is registered in `recordedSubagents`.
- When child process `exit` fires in `SubagentManager.invokeSubagents`:
  - If `recordedSubagents.has(id)` is true, **no fallback message is written**.
  - This guarantees exactly 1 notification per subagent lifecycle and eliminates duplicate notifications.

### 2.2 Instant FS Watcher / Event Trigger
- Add an instant file system watcher (`fs.watch` on `.shark/mailbox/`) or direct event emitter when `sendMessage` is invoked.
- When a mailbox file is written, trigger notification dispatch immediately to eliminate 2-second polling delays.

### 2.3 Non-Blocking Event-Driven Input (`waitForInputOrNotification`)
- Replace blocking `@clack/prompts` input waiting with an asynchronous `readline` event listener.
- Concurrent listening: `process.stdin` listens for user keystrokes while `messageQueue` listens for incoming subagent notifications.

### 2.4 Draft Preservation UX (`draftBuffer`)
- As the user types characters into the CLI, input is captured into an in-memory `draftBuffer` string.
- If a subagent notification arrives while the prompt line is active:
  1. The prompt line is smoothly cleared (`clearLine`).
  2. `draftBuffer` retains whatever partial text the user had typed.
  3. The parent agent consumes the subagent notification and executes the model turn.
  4. When the turn finishes and the prompt is re-opened, the text box is restored with `initialValue: draftBuffer`.
- If the user submits input (Enter), `draftBuffer` is cleared.

---

## 3. Component Modifications

### 3.1 [subagent-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/subagent-manager.ts)
- Add `private recordedSubagents = new Set<string>();`.
- In `sendMessage`, record subagent ID if present in message content `(subagent-uuid)`.
- In `child.on('exit')`, check `recordedSubagents.has(id)` before attempting any fallback message dispatch.

### 3.2 [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts)
- Update `waitForInputOrNotification` to manage non-blocking input with `draftBuffer`.
- Restore `draftBuffer` as `initialValue` when re-prompting the user.
- Eliminate synthetic `process.stdin.emit('keypress')` hacks.

---

## 4. Verification & Testing Plan

### 4.1 Unit Tests (`subagent-manager.test.ts`)
- Test that a subagent sending a completion message puts its ID in `recordedSubagents`.
- Test that process exit with `exitCode 0` does not send a duplicate fallback message when `recordedSubagents` has the ID.

### 4.2 TUI & Queue Integration Tests (`developer-agent.test.ts`)
- Test `waitForInputOrNotification` with concurrent `subagent_notification` arrival while preserving `draftBuffer`.
