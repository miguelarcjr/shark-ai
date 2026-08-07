# Subagent Notification Pipeline Design

**Date**: 2026-08-07  
**Status**: Approved  
**Topic**: Unify and fix subagent completion & failure notification pipeline in Shark Dev  

---

## 1. Context & Problem Statement

When Shark Dev invokes subagent child processes via `subagentManager.invokeSubagents(...)`, the parent agent receives duplicate completion notifications simultaneously. This overwhelms and confuses the parent LLM agent, causing it to freeze or fail to process either notification.

### Root Causes
1. **Dual Notification Channels**:
   - **Disk Mailbox**: When a subagent calls `complete_task`, it writes a file to `.shark/mailbox/[parentId]/...json`. In the parent process, `mailboxInterval` (polling every 2s) reads this file and pushes it to `messageQueue`.
   - **Direct In-Memory Queue Push**: In `subagentManager.invokeSubagents`, when the child process exits (`exitCode === 0`), it also executes `parentQueue.push(...)` directly into the same `messageQueue`.
2. **Race Condition & Generic Message Overwriting**:
   - Because `parentQueue.push(...)` inside `invokeSubagents` often runs before the disk file is read, it pushes a fallback message (`"Tarefa concluída sem resumo."`).
   - The parent loop receives both the detailed XML message from the disk mailbox and the fallback string from `parentQueue.push(...)`.
3. **Double Ingestion in Agent Loop**:
   - In `interactiveDeveloperAgent`, incoming messages were fetched both from `messageQueue.next()` and from draining `messageQueue` into `allIncomingMessages`, causing duplicated prompt injections per turn.

---

## 2. Architecture & Design Decisions

### 2.1 Single Channel Architecture (Disk Mailbox Only)
- The disk mailbox (`.shark/mailbox/[parentId]/`) is established as the **single source of truth** for all subagent status updates (completions, failures, crashes, watchdog timeouts, and cancellations).
- Direct `parentQueue.push(...)` calls inside `subagentManager.invokeSubagents` are completely removed.
- `MessageQueue` in memory is reserved strictly as the internal queue populated by `mailboxInterval` when reading disk mailbox files.

### 2.2 Standardized XML Notification Format
All messages read from the mailbox are formatted uniformly into structured XML blocks before being presented to the parent agent LLM:

```xml
<subagent_notification id="subagent-uuid" role="Backend Developer" status="completed|failed|cancelled">
[Detailed summary, task output, or console error logs]
</subagent_notification>
```

### 2.3 Subagent Exit & Crash Handling (`SubagentManager.invokeSubagents`)
When a subagent child process exits (`child.on('exit')`):
- **Success (`exitCode === 0`)**:
  - Check if the subagent has already written a detailed completion result to `.shark/mailbox/[parentId]`.
  - If it did, log success to TUI console and do not write duplicate fallback messages.
  - If no message was written by the subagent, write a single standardized completion message to the mailbox via `sendMessage(parentId, ...)`.
- **Failure / Crash (`exitCode !== 0` or `child.on('error')`)**:
  - Check if a failure message was already recorded.
  - If not, retrieve the last 15 console log lines from `_sharkrc/history/subagent-[id]-console.log`.
  - Send a failure notification containing these crash logs to the parent mailbox via `sendMessage(parentId, ...)`.
- **Watchdog / Cancellation**:
  - Retain single notification dispatch via `sendMessage(parentId, ...)` when killed or timed out.

### 2.4 Agent Loop Ingestion (`interactiveDeveloperAgent`)
- In `interactiveDeveloperAgent`, incoming messages are processed deterministically at the start of each turn.
- Drained messages from `messageQueue` are formatted into `<subagent_notification>` blocks and injected into the prompt exactly once under `✉️ NEW MAILBOX MESSAGES:`.
- When the agent is waiting (`action: wait`), `waitForInputOrNotification` listens to `messageQueue`. Upon arrival of a notification, it resumes execution cleanly without duplicate prompt injections.

---

## 3. Component Modifications

### 3.1 [subagent-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/subagent-manager.ts)
- Remove `parentQueue` parameter usage in `invokeSubagents` that directly pushes to `parentQueue`.
- Update `child.on('exit')` logic to handle success, failure (with crash logs), and cancellation via `sendMessage(...)` exclusively.
- Ensure atomic message renaming (`.processed`) and file cleanup in `retrieveMessages()` to prevent concurrent read issues.

### 3.2 [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts)
- Update `interactiveDeveloperAgent` loop to handle mailbox notifications cleanly.
- Ensure incoming mailbox messages are formatted as `<subagent_notification>` and appended once per turn.
- Update system instructions for handling `<subagent_notification status="completed">` and `<subagent_notification status="failed">`.

---

## 4. Verification & Testing Plan

### 4.1 Unit Tests
- `subagent-manager.test.ts`:
  - Verify that invoking a subagent that exits with `code 0` generates exactly 1 mailbox message if `complete_task` was not called, or 0 extra messages if `complete_task` was called.
  - Verify that subagent crashes (`code 1`) generate a single mailbox message containing console log output.

### 4.2 Integration Tests
- `dev.test.ts`:
  - Run full subagent lifecycle test: parent invokes subagent -> subagent completes -> parent receives exactly 1 `<subagent_notification>` -> parent resumes work.
