# Design Specification: `/rewind` Command for Shark Dev

## Overview
This document specifies the design for adding the `/rewind` slash command to `shark dev` (the interactive developer agent in `shark-ai`). 
The `/rewind` command allows users to roll back conversation history by N logical turns directly from the CLI/TUI interactive prompt. This provides a clean mechanism to recover from LLM JSON generation errors (such as StackSpot's `"An unexpected error occurred"`) or to revise previous instructions without polluting session history.

## User Experience & Interface

### Command Syntax
- `/rewind`: Reverts 1 logical turn (the latest user prompt and all subsequent assistant actions/tool execution messages associated with it).
- `/rewind <n>`: Reverts `<n>` logical user turns (e.g. `/rewind 2`).
- `/rewind list`: Lists the last N user interaction checkpoints with timestamps and prompt previews so the user can inspect history before rewinding.

### Terminal UI Feedback
When executed:
1. The history is updated and persisted to `_sharkrc/history/<conversationId>.raw.json` and `.json`.
2. A success notification is rendered via `tui.log.success`:
   `✔ Histórico rebobinado 1 turno. Conversa restaurada para o estado anterior (6 mensagens no contexto).`
3. The prompt loop refreshes and prompts the user for their next instruction.

## Architecture & Component Design

### 1. History Manager Enhancements (`src/core/workflow/history-manager.ts`)
Add logical turn helper methods to `HistoryManager`:
- `getLogicalTurns(conversationId: string)`: Parses history to identify real human user input turns (filtering out synthetic messages or system prompts).
- `rewindLogicalTurns(conversationId: string, count: number)`: Truncates history up to `count` logical user turns back, saving both `.raw.json` and `.json` files.

### 2. Slash Command Handler Integration (`src/core/agents/developer-agent.ts`)
In `developer-agent.ts`, extend `onCommandHandler` to catch commands starting with `/rewind`:
- Handle `/rewind list`: Display indexed list of recent turns.
- Handle `/rewind` or `/rewind <n>`: Invoke `HistoryManager.rewindLogicalTurns`, refresh local variables/prompts, and return `true` so the command loop knows it was handled.

## Edge Cases & Boundary Handling
- **Attempting to rewind beyond available turns**: If the requested rewind count exceeds available turns, history is reset to the initial state (preserving system prompts/context), and a warning is logged.
- **Rewinding after tool errors or StackSpot JSON failures**: Since all messages after the targeted user turn are truncated, any corrupted assistant JSON responses or pending tool errors are cleanly removed.
- **Active Subagent Notifications**: Rewinding only affects the active parent/dev agent conversation history; subagent state is maintained unless subagents are explicitly managed.

## Verification Plan
1. **Unit Tests**:
   - Add unit tests in `src/core/workflow/history-manager.test.ts` verifying logical turn identification and truncation.
2. **Manual CLI Verification**:
   - Run `shark dev`, send instructions, invoke `/rewind`, verify conversation history via `/context` and `/chat`.
