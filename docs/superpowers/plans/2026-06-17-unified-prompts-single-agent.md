# Unified Prompts, Single Agent Config, and Hash Anchor Edits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize prompts and providers, transition to a single-action execution loop, implement a token-efficient Hash Anchor edit system, and restructure CLI commands to deprecate old agents and expose `shark dev` and `shark legacy`.

**Architecture:** We will update the configuration schema and the agent response parser to validate a single `action` object. We will build an `AnchorStateManager` to manage line-to-anchor mapping using Myers Diff (`diff` package). We will rewrite the provider classes to support unified prompts (with hybrid injection for StackSpot) and replace the developer agent and CLI commands to expose the new flexible iterative loop.

**Tech Stack:** TypeScript, Node.js, Commander, Vitest, Zod, and the `diff` npm package.

## Global Constraints

- TypeScript Version: Defined in tsconfig.json.
- Zod Version: Must use zod for configuration and response schema validation.
- Environment: Linux/Bash terminal in Termux.
- Backward Compatibility: If no provider is configured, default to StackSpotProvider.

---

### Task 1: Update Configuration Schema

**Files:**
- Modify: `src/core/config/schema.ts`
- Modify: `src/core/config-manager.test.ts`

**Interfaces:**
- Consumes: ConfigSchema definition
- Produces: Updated schema supporting `stackspot.agentId`

- [ ] **Step 1: Write the failing test**
  Add a test in `src/core/config-manager.test.ts` verifying that `agentId` is correctly parsed under `stackspot` in configuration:
  ```typescript
  it('should parse stackspot configuration with agentId', () => {
      const config = ConfigSchema.parse({
          provider: 'stackspot',
          stackspot: {
              agentId: '01KEQCGJ65YENRA4QBXVN1YFFX'
          }
      });
      expect(config.stackspot?.agentId).toBe('01KEQCGJ65YENRA4QBXVN1YFFX');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/config-manager.test.ts`
  Expected: FAIL (Zod error: unrecognized key `agentId` under `stackspot` or similar)

- [ ] **Step 3: Write minimal implementation**
  Modify the StackSpot object schema in `src/core/config/schema.ts` to include `agentId`:
  ```typescript
  export const ConfigSchema = z.object({
      provider: z.enum(['stackspot', 'openai-compatible']).default('stackspot'),
      stackspot: z.object({
          agentId: z.string().default('01KEQCGJ65YENRA4QBXVN1YFFX'),
      }).optional().default({}),
      'openai-compatible': z.object({
          baseURL: z.string().default('http://localhost:11434/v1'),
          apiKey: z.string().default('ollama'),
          model: z.string().default('llama3'),
          useStructuredOutputs: z.boolean().default(true)
      }).optional()
  });
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/config-manager.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/config/schema.ts src/core/config-manager.test.ts
  git commit -m "feat: add stackspot.agentId to configuration schema"
  ```

---

### Task 2: Update Parser and Response Schema

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Modify: `src/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Consumes: AgentResponse definition
- Produces: Updated parser validating single `action` object instead of `actions` array

- [ ] **Step 1: Write the failing tests**
  Update `src/core/agents/agent-response-parser.test.ts` to assert single `action` output:
  ```typescript
  it('should parse response with a single action', () => {
      const raw = {
          summary: 'Created test file',
          action: { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' }
      };
      const result = parseAgentResponse(raw);
      expect(result.action?.type).toBe('create_file');
      expect(result.action?.path).toBe('test.ts');
  });

  it('should fallback to talk_with_user action for raw text', () => {
      const result = parseAgentResponse('Hello user');
      expect(result.action?.type).toBe('talk_with_user');
      expect(result.action?.content).toBe('Hello user');
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  1. Modify `AgentActionSchema` in `src/core/agents/agent-response-parser.ts` to add `start_anchor` and `end_anchor`:
     ```typescript
     export const AgentActionSchema = z.object({
         type: z.enum([
             'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
             'run_command', 'talk_with_user', 'use_mcp_tool'
         ]),
         path: z.string().nullable().optional(),
         content: z.string().nullable().optional(),
         target_content: z.string().nullable().optional(),
         command: z.string().nullable().optional(),
         tool_name: z.string().nullable().optional(),
         tool_args: z.string().nullable().optional(),
         start_anchor: z.string().nullable().optional(),
         end_anchor: z.string().nullable().optional(),
     });
     ```
  2. Modify `AgentResponseSchema`:
     ```typescript
     export const AgentResponseSchema = z.object({
         action: AgentActionSchema.nullable().optional(),
         commands: z.array(AgentCommandSchema).optional(), // Maintain backward compatibility
         summary: z.string().optional(),
         message: z.string().optional(),
         conversation_id: z.string().optional(),
     });
     ```
  3. Update `parseAgentResponse` function to handle `action` (instead of `actions`) and format outputs correctly. Update existing tests in `src/core/agents/agent-response-parser.test.ts` to match the new schema structure.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/agents/agent-response-parser.ts src/core/agents/agent-response-parser.test.ts
  git commit -m "refactor: update response parser to validate single action schema"
  ```

---

### Task 3: Implement AnchorStateManager & Reconciler

**Files:**
- Create: `src/core/workflow/anchor-state-manager.ts`
- Create: `src/core/workflow/anchor-state-manager.test.ts`

**Interfaces:**
- Consumes: `diff` npm package for Myers Diff
- Produces: `AnchorStateManager` class for reading anchored files and applying anchored modifications

- [ ] **Step 1: Write the failing tests**
  Create `src/core/workflow/anchor-state-manager.test.ts` with tests for mapping, diffing, and editing:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { AnchorStateManager } from './anchor-state-manager.js';
  import fs from 'node:fs';
  import path from 'node:path';

  describe('AnchorStateManager', () => {
      it('should prefix file lines with unique anchors on read', () => {
          const manager = new AnchorStateManager();
          const filePath = path.resolve('test-anchor-file.txt');
          fs.writeFileSync(filePath, 'line1\nline2\nline3');

          try {
              const anchored = manager.getAnchoredContent(filePath);
              const lines = anchored.split('\n');
              expect(lines).toHaveLength(3);
              expect(lines[0]).toMatch(/^\w+§line1$/);
          } finally {
              fs.unlinkSync(filePath);
          }
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/workflow/anchor-state-manager.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  Create `src/core/workflow/anchor-state-manager.ts` containing the `AnchorStateManager` logic:
  - Generate a pool of 1,000 common short words (e.g. `apple`, `beach`, `cabin`, `dust`, `edge`, etc.).
  - Implement `getAnchoredContent(filePath: string): string` to read file contents, assign anchors to each line, and cache the mapping.
  - Implement `applyAnchoredEdit(filePath: string, startAnchor: string, endAnchor: string, content: string): void` to modify the file content at the specified line indices, save to disk, and reconcile the line-to-anchor mapping via the `diff` library (`diffLines` function).

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/workflow/anchor-state-manager.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/workflow/anchor-state-manager.ts src/core/workflow/anchor-state-manager.test.ts
  git commit -m "feat: implement AnchorStateManager with Myers Diff reconciliation"
  ```

---

### Task 4: Update Providers (StackSpot & OpenAICompatible)

**Files:**
- Modify: `src/core/api/stackspot-provider.ts`
- Modify: `src/core/api/openai-compatible-provider.ts`
- Modify: `src/core/api/stackspot-provider.test.ts`
- Modify: `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: AIProvider interfaces
- Produces: Updated provider classes supporting the single Joker Agent ID, hybrid injection, and the single-action schema prompt.

- [ ] **Step 1: Write the failing tests**
  Add unit tests asserting:
  - `StackSpotProvider` uses the single `agentId` from config.
  - `StackSpotProvider` prepends the system instructions only if `conversationId` is undefined.
  - `OpenAICompatibleProvider` uses the new system prompt and `response_format` JSON Schema with `action` object.

- [ ] **Step 2: Run tests to verify they fail**
  Run: `npx vitest run src/core/api/stackspot-provider.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Update `StackSpotProvider.ts`:
    - Read `agentId` from `config.stackspot?.agentId`.
    - If `options.conversationId` is empty/undefined, format the `user_prompt` payload as:
      ```text
      SYSTEM INSTRUCTIONS:
      [Unified System Prompt]

      USER REQUEST:
      [prompt]
      ```
  - Update `OpenAICompatibleProvider.ts`:
    - Define the unified system prompt (in Portuguese) mapping to the single `action` object.
    - Set the output `response_format` JSON schema properties to require `action` instead of `actions`.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run src/core/api/stackspot-provider.test.ts src/core/api/openai-compatible-provider.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts src/core/api/stackspot-provider.test.ts src/core/api/openai-compatible-provider.test.ts
  git commit -m "feat: update providers with unified prompts, Joker ID, and single action schema"
  ```

---

### Task 5: Implement New Flexible Developer Agent

**Files:**
- Create: `src/core/agents/legacy-developer-agent.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `AnchorStateManager`, `ProviderResolver`
- Produces: Flexible, iterative agent loop that confirms critical actions and integrates Hash Anchor edits

- [ ] **Step 1: Save the old developer agent logic as legacy**
  Copy `src/core/agents/developer-agent.ts` to `src/core/agents/legacy-developer-agent.ts`. Update imports in `legacy-developer-agent.ts` to prevent errors.

- [ ] **Step 2: Write tests for the new developer agent**
  Update `src/core/agents/developer-agent.test.ts` to verify the execution of `modify_file` with anchors, `read_file` with anchors, and the iterative loop handling.

- [ ] **Step 3: Implement new flexible developer agent**
  Replace `src/core/agents/developer-agent.ts` with:
  - An interactive loop (`while (keepGoing)`) that:
    - Queries the model via `ProviderResolver.getProvider('developer_agent').streamChat()`.
    - Receives `response.action`.
    - If `action.type === 'read_file'`: calls `AnchorStateManager.getAnchoredContent(filePath)` and appends the result to the history/next prompt.
    - If `action.type === 'modify_file'`: checks confirmation (or auto-approves if `--auto` flag is active), calls `AnchorStateManager.applyAnchoredEdit()`, and appends the success message.
    - If `action.type === 'create_file'`, `delete_file`, or `run_command`: prompts the user for confirmation (or auto-executes if `--auto` is active), runs the action, and returns results.
    - If `action.type === 'talk_with_user'`: prints the message and prompts the user for text input to continue the conversation.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run src/core/agents/developer-agent.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/agents/legacy-developer-agent.ts src/core/agents/developer-agent.test.ts
  git commit -m "feat: replace developer agent with new flexible iterative loop"
  ```

---

### Task 6: Update Commands and CLI Entries

**Files:**
- Create: `src/commands/legacy.ts`
- Create: `src/commands/export-schema.ts`
- Modify: `src/commands/dev.ts`
- Modify: `src/bin/shark.ts`

**Interfaces:**
- Consumes: `developer-agent.ts`, `legacy-developer-agent.ts`
- Produces: Clean CLI registration containing `dev`, `legacy`, and `export-schema` commands. Removes deprecated agent commands.

- [ ] **Step 1: Write the export schema command**
  Create `src/commands/export-schema.ts` defining a command `export-schema` that outputs the JSON Schema from Section 3 of the spec to stdout.

- [ ] **Step 2: Write the legacy command**
  Create `src/commands/legacy.ts` defining the `legacy` command (the old task orchestration loop utilizing `legacy-developer-agent.ts`).

- [ ] **Step 3: Update dev command**
  Modify `src/commands/dev.ts` to remove the `TaskManager` orchestrator loop. Update it to call the new `interactiveDeveloperAgent` with the `-t, --task` and `-y, --yes` (auto mode) parameters.

- [ ] **Step 4: Update bin entry point**
  Modify `src/bin/shark.ts`:
  - Register `devCommand`, `legacyCommand`, and `exportSchemaCommand`.
  - Remove CLI command registrations for `ba`, `spec`, `qa`, and `scan`.

- [ ] **Step 5: Verify all tests in the codebase pass**
  Run: `npm test`
  Expected: All tests pass.

- [ ] **Step 6: Commit**
  ```bash
  git add src/commands/ src/bin/shark.ts
  git commit -m "feat: restructure CLI commands for dev, legacy, and export-schema"
  ```
