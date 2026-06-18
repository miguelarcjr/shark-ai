# Design Spec: Continuous Interactive Chat & Subagent Notifications

## Status
Approved by user.

## Context
When running `shark dev` in interactive mode (without a task parameter `-t` or `--task`), the CLI is expected to behave like a continuous chat session. 
Currently:
1. When a task completes (`TASK_COMPLETED:`) or fails (`TASK_FAILED:`), the `interactiveDeveloperAgent` loop terminates, causing the CLI process to exit.
2. If subagents were invoked and are still executing in the background, the exit of the parent process kills them prematurely.
3. Subagents do not notify the parent agent when they complete, and the parent agent does not check its mailbox unless it is running as a subagent itself.

## Goals
1. Keep the CLI open in continuous interactive mode (when run without `-t` or `--task`).
2. Programmatically notify the parent agent's mailbox when a subagent finishes.
3. Retrieve and inject mailbox messages for the parent agent so the LLM is informed of subagent completions.
4. Keep the subagent execution alive by keeping the parent process open.

## Design Details

### 1. Continuous Interactive Mode in `developer-agent.ts`
- Detect continuous interactive mode: `const isInteractiveMode = !options.taskInstruction && !options.taskId;`.
- Modify `TASK_COMPLETED:` and `TASK_FAILED:` handlers:
  - In `isInteractiveMode`, log the status, but do NOT set `keepGoing = false`.
  - Prompt the user for the next input: `const userReply = await promptUser('Your answer:', ...);`.
  - If the user cancels the prompt (Ctrl+C), exit.
  - Otherwise, set `nextPrompt = userReply` and continue the loop.

### 2. Retrieve Parent Mailbox Messages
- Update mailbox message retrieval in `developer-agent.ts` to check `options.taskId || 'parent'`.
- This ensures the parent agent fetches and appends any subagent messages to the next LLM prompt.

### 3. Programmatic Notification from Subagent to Parent
- Update `subagentManager.invokeSubagents` in `subagent-manager.ts` so that when a subagent's promise resolves:
  - Send a message to `parentId` using `this.sendMessage(parentId, ...)`.
  - Include the subagent's ID, role, success status, and summary.

## Verification Plan
1. Start the CLI in interactive mode: `node dist/bin/shark.js dev`.
2. Confirm the prompt stays open and we can execute tasks/questions continuously without the CLI exiting.
3. Verify subagents can be invoked, run in the background, and print their final success status to the console.
4. Verify that sending a subsequent message retrieves the completed subagent details and updates the parent LLM.
