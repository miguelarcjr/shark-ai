# Design Spec: Non-Blocking Event-Driven Concurrency Queue for Subagent Notifications

## Status
Approved by user.

## Context
In the previous implementation (`2026-06-18-interactive-subagents-design.md`), continuous interactive mode and subagent notifications were added. However:
1. When a subagent finishes, it writes its notification to the parent's mailbox.
2. If the parent agent is idle, it is blocked on a synchronous prompt (`await promptUser('Your answer:')` which calls `tui.text` -> `@clack/prompts`).
3. While blocked, the parent process cannot check the mailbox or update the screen in real-time.
4. The user is only notified of the subagent's result *after* they manually type a new response and press Enter, creating a confusing and unresponsive user experience.

## Goals
1. Unify user inputs and subagent completions under a single event-driven `MessageQueue`.
2. Process subagent notifications in real-time, even when the parent agent is waiting for user input.
3. Automatically cancel the active user input prompt, print the subagent summary, process it, and reopen the prompt without user intervention.
4. Ensure no CPU-bound polling loops or file watchers are used; communication must be fully event-driven.

## Design Details

### 1. Unified Message Queue (`MessageQueue`)
Implement an asynchronous producer-consumer queue class to hold user inputs and subagent completion events:
```typescript
export interface QueueMessage {
    type: 'user' | 'subagent_notification';
    content: string;
    timestamp: number;
    metadata?: {
        subagentId?: string;
        role?: string;
        status?: 'completed' | 'failed';
    };
}
```
The queue will use a promise resolution mechanism to allow the main loop to await the next message without blocking:
- `push(message: QueueMessage)`: Adds a message and resolves any pending consumer promise.
- `next(): Promise<QueueMessage>`: Retrieves the next message or waits for one to be pushed.

### 2. Event-Driven Subagent Termination Watcher
In `subagent-manager.ts`:
- Modify `invokeSubagents` to accept the parent's `MessageQueue`.
- When the child process exits (monitored via the native Node.js `'exit'` event), read the completed subagent's summary from the mailbox.
- Immediately push a `subagent_notification` message directly to the parent's queue.

### 3. Non-Blocking Prompt & Race Condition Handling
In `developer-agent.ts`:
- Replace the direct `promptUser` call with `waitForInputOrNotification(queue)`.
- Use `Promise.race` to await EITHER:
  1. The user input prompt resolving.
  2. The queue resolving with a subagent notification.
- If the subagent notification wins:
  - Simulate a carriage return (`\r`) to `process.stdin` to unblock/terminate the active Clack prompt.
  - Erase the incomplete prompt lines from the terminal screen using ANSI escape codes.
  - Return the subagent notification to the loop for immediate processing and LLM action.
  - Re-prompt the user in the next loop iteration.

### 4. LLM Injection Loop
When a `subagent_notification` is popped from the queue:
- Format it as a system event containing the subagent summary.
- Send it to the LLM so the parent agent can decide on the next action (e.g. updating the workflow stage, executing a tool, or responding to the user).

## Verification Plan
1. Start the CLI: `node dist/bin/shark.js dev`.
2. Ask the agent to run a subagent: *"invoque um subagente e analise o codigo e resuma as principais funcionalidades"*.
3. Wait at the `Your answer:` prompt.
4. Verify that as soon as the subagent completes, the prompt is cleared, the subagent's success/summary is displayed, and a new prompt is opened automatically without typing anything.
5. Verify that the parent agent continues to process the summary and decides on the next step.
