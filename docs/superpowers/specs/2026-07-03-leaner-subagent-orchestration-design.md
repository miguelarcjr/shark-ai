# Design Spec: Leaner Subagent Orchestration and Schema Pruning

This document details the design for simplifying the subagent orchestration system in Shark AI. By removing legacy, dynamic, and low-level communication tools from the LLM-facing response schemas, we eliminate tool confusion (specifically around message transmission) and reduce context/token bloat.

## 1. Goal Description
Currently, the Coordinator (parent) and Subagent (child) agents are exposed to excessive orchestration tools in their JSON response schemas. The parent has actions to dynamically define subagents (`define_subagent`), manage them (`manage_subagents`), and send real-time mailbox messages (`send_message`). The child agent has `send_message` as well. 

This causes two main issues:
1. **Tool/Conversational Confusion**: The LLM frequently populates the `recipient` and `message` properties (intended for subagent mailbox IPC) when trying to talk to the human user (which should use `talk_with_user` and `content`).
2. **Context Bloat**: Dozens of unused properties (`name`, `description`, `system_prompt`, `enable_write_tools`, etc.) are declared in the strict JSON schema, wasting context tokens and output tokens.

We will prune all these legacy/low-level actions from the JSON schemas and parser, retaining only the clean, file-briefing `invoke_subagent` and `complete_task` workflows. IPC messages will be handled programmatically by the execution harness rather than as LLM-initiated actions.

---

## 2. Proposed Changes

### A. System Prompt & Schema Simplification (`src/core/api/prompts.ts`)
We will remove `define_subagent`, `manage_subagents`, `send_message`, and all associated unused parameters.

#### 1. JSON Schemas Updates
* **`COORDINATOR_RESPONSE_JSON_SCHEMA`**:
  * Keep the following actions in the `type` enum:
    `create_file`, `modify_file`, `read_file`, `list_files`, `search_file`, `search_code`, `delete_file`, `run_command`, `talk_with_user`, `use_mcp_tool`, `activate_skill`, `invoke_subagent`, `complete_task`, `wait`, `notify_user`
  * Remove from `type` enum: `"define_subagent"`, `"send_message"`, `"manage_subagents"`.
  * Delete all fields in the `properties` block except:
    `type`, `path`, `content`, `start_anchor`, `end_anchor`, `command`, `query`, `tool_name`, `tool_args`, `skill_name`, `duration_seconds`, `task_file`.
  * Specifically, remove: `subagents` (legacy array), `recipient`, `message`, `action` (list/kill), `conversation_ids`, `type_name`, `role`, `name`, `description`, `system_prompt`, `enable_write_tools`, `enable_subagent_tools`, `enable_mcp_tools`.
  
* **`SUBAGENT_RESPONSE_JSON_SCHEMA`**:
  * Remove `"send_message"` from the `type` enum.
  * Remove `recipient` and `message` from the properties list.
  * Subagent schema will contain only: `create_file`, `modify_file`, `read_file`, `list_files`, `search_file`, `search_code`, `delete_file`, `run_command`, `use_mcp_tool`, `complete_task`.

#### 2. System Prompt Content Updates
* Clean up the instruction sections in both `UNIFIED_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT` to remove all documentation, instructions, and examples for `define_subagent`, `manage_subagents`, and `send_message`.
* Add a dedicated `🤖 ORQUESTRAÇÃO DE SUB-AGENTES (Subagent Orchestration)` section to `UNIFIED_SYSTEM_PROMPT` giving clear guidelines on how to delegate tasks to subagents via `create_file` (writing the briefing markdown file to `.shark/sdd/`), `invoke_subagent` (passing the `task_file`), reading notifications from mailbox (`✉️ NEW MAILBOX MESSAGES`), and using the `wait` action when no local work is pending.

---

### B. Response Parser Cleanup (`src/core/agents/agent-response-parser.ts`)
* In `AgentActionSchema` (Zod validation):
  * Remove properties: `Subagents`, `Recipient`, `Message`, `Action` (the enum), `ConversationIds`, `type_name`, `role`, `name`, `description`, `system_prompt`, `enable_write_tools`, `enable_subagent_tools`, `enable_mcp_tools`.
  * Remove the preprocessing logic that maps snake_case properties of these deleted actions (`recipient`, `message`, etc.).
  * Keep `task_file` mapping.

---

### C. Execution Harness Cleanup (`src/core/agents/developer-agent.ts`)
* In `interactiveDeveloperAgent`'s main action processing loop:
  * Delete the `action.type === 'define_subagent'` handler block.
  * Delete the `action.type === 'send_message'` handler block.
  * Delete the `action.type === 'manage_subagents'` handler block.
* Note that programmatical communication using `subagentManager.sendMessage(...)` on exit/failure is preserved since it is triggered by JavaScript execution, not LLM tool selection.

---

### D. Subagent Manager Refactoring (`src/core/workflow/subagent-manager.ts`)
* Remove the `customTypes` Map, the `defineSubagentType` function, and the `getCustomSubagentType` helper from the class.
* Update `invokeSubagents` to spawn the subagent directly without resolving `customType` (system instructions are now loaded directly from the brief file anyway).

---

## 3. Verification Plan

### Automated Tests
1. Run schema and parser unit tests to verify Zod parsing behaves correctly with the pruned schema:
   `npm test tests/core/agents/agent-response-parser.test.ts`
2. Run developer agent tests and ensure they still pass (mocking out define/manage tests or replacing them with a simplified focus):
   `npm test tests/core/agents/developer-agent.test.ts`
3. Verify that exporting schema and prompts still works:
   `node dist/bin/shark.js export-schema coordinator`
   `node dist/bin/shark.js export-schema subagent`

### Manual Verification
1. Launch `shark dev` with a test task to ensure normal developer-agent operation.
