# Design Spec: Interactive /chat Command in Shark Dev

## Goal
Add a `/chat` command to the interactive Shark Developer Agent shell (`shark dev`) to list, select, and resume existing conversation histories.

---

## User Experience

1. **Triggering the Command**:
   While inside the interactive `shark dev` CLI session, typing `/chat` will invoke the conversation selector.

2. **Selecting a Conversation**:
   - The CLI will scan saved histories from `_sharkrc/history/` (`*.raw.json` or `*.json`).
   - The CLI displays an interactive dropdown selection (using `tui.select`) showing available conversations.
   - Conversations are sorted chronologically (newest first).
   - Display format:
     ```text
     [01KEQD2V...] (developer_agent) | 16/07 09:25 | Topic: "gostaria de adicionar um comando /chat..."
     ```
     - IDs are abbreviated to 8 characters.
     - Agent keys (e.g. `developer_agent`) are displayed if the ID matches a conversation key in `shark-workflow.json`.
     - Topic snippet is derived from the first user instruction in that conversation (truncated to 60 characters).

3. **Post-selection Feedback**:
   - Once selected, the terminal screen clears or prints a status indicating switching.
   - The CLI prints the last 4 messages (excluding system instructions) of the chosen conversation history, with clear user and assistant role identifiers and coloring:
     - `👤 [Você]: <message>` (yellow)
     - `🤖 [Shark Dev]: <message>` (green/primary)
   - Prompt loop immediately resumes, awaiting the next user instruction for that conversation.

---

## Architecture & Implementation Details

### 1. Variables and State Management
In [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts):
- Replace the local immutable constant `existingConversationId` read every turn from `conversationManager.getConversationId(conversationKey)` with a local mutable variable `activeConversationId`.
- At startup:
  ```typescript
  let activeConversationId = await conversationManager.getConversationId(conversationKey);
  ```
- All provider and state synchronization calls within the loop will use `activeConversationId`.

### 2. Conversation Scan & Format
Create a utility or helper in [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts) to:
- Read files in `_sharkrc/history`.
- Parse metadata (last modified time, first user message content).
- Load the active workflow state from `workflowManager.load()` to map conversation IDs back to agent keys.
- Prepare option objects `{ value: conversationId, label: formattedLabel }`.

### 3. Command Handler Hook
Extend the `onCommandHandler` in [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts) to handle `/chat`:
- If `/chat` is inputted:
  1. Retrieve option list.
  2. If list is empty, notify the user and exit command handler.
  3. Invoke `tui.select` for user selection.
  4. If cancelled or invalid, do nothing and return.
  5. If a conversation is selected:
     - Set `activeConversationId = selectedId`.
     - Save the new association: `await conversationManager.saveConversationId(conversationKey, selectedId);`
     - Read conversation raw history using `HistoryManager.getRawHistory(selectedId)`.
     - Print the last 4 non-system messages.
     - Set `handled = true`.

---

## Verification Plan

### Automated Tests
- Add a new unit test in [developer-agent.test.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.test.ts) to verify:
  - Command `/chat` lists, prompts, and updates `activeConversationId`.
  - Switching conversation prints recent messages.
  - Subsequent prompt uses the switched conversation ID.

### Manual Verification
1. Run `npm run build` or compile TypeScript.
2. Start interactive dev shell: `node dist/bin/shark.js dev`
3. Type `/chat` and confirm the menu is shown with existing history records.
4. Select one and verify the last 4 messages are displayed correctly.
5. Send a new message and verify that the conversation resumes from that state.
