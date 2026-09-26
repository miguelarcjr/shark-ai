# Design Spec: Strict Action Validation & Self-Teaching Errors with Automatic Tool Describe

- **Date:** 2026-09-26
- **Author:** Shark AI Team
- **Status:** Approved

---

## 1. Problem Statement

During autonomous agent runs (such as the recent `proximodesafio-lovable` execution), the LLM emitted a flat, malformed action payload:
```json
{"action":"read_file","path":"src/routes/index.tsx","start_line":0,"end_line":250}
```
instead of the required uniform envelope:
```json
{
  "thought": "...",
  "action": {
    "type": "read_file",
    "args": {
      "path": "src/routes/index.tsx",
      "start_line": 0,
      "end_line": 250
    }
  },
  "summary": "..."
}
```

This caused a critical silent failure in the agent runtime:
1. **Fallback Without System Error Prefix in Parser:**
   In `src/core/agents/agent-response-parser.ts`, the parser extracts `normalizedAction = parsedObj.action` (which evaluates to the string `"read_file"`). Because `hasValidType` expects an object with a string `.type`, validation fails and execution falls into the fallback block (lines 387–397).
   Instead of generating a `[SYSTEM ERROR]` with educational recovery instructions, it created a synthetic `talk_with_user` containing the raw stringified payload without any error prefix.
2. **Premature Task Termination in Batch Mode:**
   In `src/core/engine/turn-loop-runner.ts`, `talk_with_user` only continues the loop automatically if `talkContent.startsWith('[SYSTEM ERROR]')`. Because the synthetic message lacked this prefix, the runner treated it as a completed response delivered to the user. In batch/headless mode, this immediately halted execution and marked the task as `Completed: {"action":"read_file",...}`.
3. **Lack of Educational Self-Teaching Guidance:**
   The model was never instructed on what went wrong, which envelope was required, or what parameters the tool expected (missing the automatic `tool_describe` capability envisioned in the progressive tools architecture).

---

## 2. Goals & Non-Goals

### Goals
- **Strict Envelope Enforcement:**
  Reject any response that does not adhere to `{ "action": { "type": string, "args": object } }` or lacks required parameters. Do not silently auto-heal flat syntax; educate the model so it learns the contract.
- **Centralized Action Validator & Schema Registry:**
  - Define an explicit schema contract for all core tools (`read_file`, `modify_file`, `create_file`, `delete_file`, `list_files`, `search_file`, `search_code`, `run_command`, `process`, `send_file`, `complete_task`, `talk_with_user`, `wait`, `notify_user`, `invoke_subagent`, `memory`, `session_search`, etc.).
  - Connect with `BridgeToolsManager` to dynamically look up schemas for MCP tools (`knownToolsMap` and catalog search).
- **Self-Teaching Error Formatting with Automatic Tool Describe:**
  - When an envelope or tool call is invalid, generate an educational error message containing:
    1. An explanation of the syntax or parameter violation.
    2. The canonical envelope specification.
    3. The exact parameter schema / description of the attempted tool (automatically populated via native schemas or MCP `tool_describe`).
    4. A drop-in JSON example showing how to invoke the tool correctly.
  - Ensure the resulting action is a synthetic `talk_with_user` with `isSynthetic: true`, `isError: true`, and prefixed with `[SYSTEM ERROR]`.
- **Loop Continuity in `TurnLoopRunner`:**
  - Guarantee that any response where `isError === true` or content starts with `[SYSTEM ERROR]` is fed back to the LLM as the next turn prompt, preventing batch-mode exit.

### Non-Goals
- Permissive auto-normalization of flat action calls (user explicitly chose the strict educational approach).
- Altering the system prompt JSON schemas already defined in `prompts.ts`.

---

## 3. Technical Architecture & Components

```
                    ┌────────────────────────────┐
                    │ Raw LLM Assistant Response │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │    AgentResponseParser     │
                    │   (extractFirstJson)       │
                    └─────────────┬──────────────┘
                                  │
                                  ▼
                    ┌────────────────────────────┐
                    │      ActionValidator       │
                    │  - Checks Envelope         │
                    │  - Checks Required Args    │
                    │  - Checks MCP Tools        │
                    └──────┬──────────────┬──────┘
                           │              │
              [Invalid]    │              │    [Valid]
                           ▼              ▼
         ┌────────────────────────┐  ┌───────────────────────┐
         │ Build Self-Teaching    │  │ AgentResponseSchema   │
         │ [SYSTEM ERROR] with    │  │ Validated Result      │
         │ Tool Describe & Example│  └───────────┬───────────┘
         └──────────┬─────────────┘              │
                    │                            │
                    └──────────────┬─────────────┘
                                   │
                                   ▼
                    ┌────────────────────────────┐
                    │      TurnLoopRunner        │
                    │  - If [SYSTEM ERROR],      │
                    │    continue loop to retry  │
                    │  - Else execute action     │
                    └────────────────────────────┘
```

### 3.1 `ActionValidator` (`src/core/agents/action-validator.ts`)

A dedicated module responsible for validating agent action payloads and assembling self-teaching error messages:

1. **Native Tool Schemas:**
   A registry mapping core tools to their required fields, optional fields, and descriptions:
   - `read_file`: required `['path']`
   - `modify_file`: required `['path', 'start_anchor', 'end_anchor', 'content']`
   - `create_file`: required `['path', 'content']`
   - `delete_file`: required `['path']`
   - `list_files`: optional `['path']`
   - `search_code`: required `['query']`
   - `search_file`: required `['query']`
   - `run_command`: required `['command']`
   - `tool_call`: required `['name']` (with `arguments` object or string)
   - `tool_describe`: required `['names']`
   - `tool_search`: required `['queries']`
   - `complete_task`: optional `['summary', 'content']`

2. **Validation Logic:**
   - **Check 1: Envelope Structure.**
     If `parsedObj.action` is not an object or lacks `type` (e.g. `parsedObj.action === "read_file"` or `parsedObj.type === "read_file"` at root):
     - Identify candidate tool name from `parsedObj.action` or `parsedObj.type`.
     - Generate an envelope violation error with the schema and example of the candidate tool.
   - **Check 2: Tool Existence.**
     - If `type` is neither in native schemas nor in bridge tools (`BridgeToolsManager.isBridgeTool(type)`), format an "Unknown Tool" error with available core tools and a hint to use `tool_search`.
   - **Check 3: Parameter Validation.**
     - For native tools: check required fields in `args`.
     - For MCP tools called via `tool_call`: inspect `BridgeToolsManager.knownToolsMap` for the tool's parameter schema. If required properties are missing, extract the MCP schema.
     - For MCP tools called directly as `type`: extract schema from `BridgeToolsManager` and instruct the model to use the proper envelope or `tool_call`.

3. **Self-Teaching Error Template:**
   ```text
   [SYSTEM ERROR]: Formato de chamada de ação inválido para '{toolName}'.
   Motivo: {violationDetails}

   📋 ENVELOPE OBRIGATÓRIO:
   {
     "thought": "Seu raciocínio detalhado...",
     "action": {
       "type": "{toolName}",
       "args": { ... }
     },
     "summary": "Resumo de 1 frase."
   }

   💡 SCHEMA DA FERRAMENTA (tool_describe automático):
   {schemaJson}

   💡 EXEMPLO DE USO CORRETO:
   {exampleJson}
   ```

### 3.2 Parser Updates (`src/core/agents/agent-response-parser.ts`)

- In `parseAgentResponse`:
  - Run `ActionValidator.validate(parsedObj, bridgeToolsManager)`.
  - If validation fails, return:
    ```typescript
    return {
        thought: parsedObj.thought || '',
        action: {
            type: 'talk_with_user',
            content: validationResult.errorMessage,
            path: '',
            isSynthetic: true
        },
        actions: [{
            type: 'talk_with_user',
            content: validationResult.errorMessage,
            path: '',
            isSynthetic: true
        }],
        summary: 'Action validation failed (Self-Teaching Error)',
        isError: true,
        errorMessage: validationResult.errorMessage
    };
    ```
  - Eliminate the silent fallback in lines 387–397 that previously returned raw content without `[SYSTEM ERROR]`.

### 3.3 Engine Continuity (`src/core/engine/turn-loop-runner.ts`)

- In the `talk_with_user` handler:
  ```typescript
  const isSystemError = (typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]')) || response?.isError === true;
  if (isSystemError) {
      currentPrompt = talkContent || response?.errorMessage || '[SYSTEM ERROR]: Invalid action structure.';
      continue;
  }
  ```
  This ensures that whenever `isError` is true or content starts with `[SYSTEM ERROR]`, the runner feeds the error back to the LLM and retries, regardless of batch mode.

---

## 4. Edge Cases & Resilience

1. **Model sends markdown code blocks around JSON:** Handled by existing `extractFirstJson`.
2. **Model sends flat format with unknown action name:** The validator reports invalid envelope and lists core actions plus suggestion to use `tool_search`.
3. **Model targets an MCP tool before running `tool_describe`:** The validator automatically retrieves the MCP tool's parameter schema from `BridgeToolsManager` and embeds it in the `[SYSTEM ERROR]`.
4. **Multiple consecutive format errors:** `TurnLoopRunner` will loop and provide educational feedback until max turns or recovery.

---

## 5. Verification Plan

1. **Unit Tests (`tests/core/agents/action-validator.test.ts`):**
   - Test envelope rejection for `{ "action": "read_file", "path": "..." }` -> returns `[SYSTEM ERROR]` with `read_file` schema and example.
   - Test envelope rejection for root `{ "type": "read_file", "path": "..." }` -> returns `[SYSTEM ERROR]`.
   - Test missing required parameters (e.g. `read_file` without `path`, `modify_file` without anchors).
   - Test MCP tool validation with dynamic schema retrieval from mock `BridgeToolsManager`.
2. **Parser Integration Tests (`tests/core/agents/agent-response-parser-self-teaching.test.ts`):**
   - Verify `parseAgentResponse` sets `isError: true` and prefixes `action.content` with `[SYSTEM ERROR]`.
3. **Turn Loop Runner Tests (`tests/core/engine/turn-loop-runner.test.ts`):**
   - Verify that when `isError: true` or `[SYSTEM ERROR]` is returned in batch mode, execution does NOT exit and instead loops back with the error as `currentPrompt`.
4. **Regression Testing:**
   - Run entire test suite `npx vitest run` to ensure no existing agent behaviors regress.
