# Subagent Communication and Schema Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize subagent execution, prevent silent loops/failures, normalize schema field naming, and simplify invocation by segregating schemas/prompts, introducing a watchdog timer, and utilizing file-briefing.

**Architecture:** Split schema/prompts into `COORDINATOR` and `SUBAGENT` variants. Update CLI commands and provider logic to resolve target schemas based on execution context. Introduce a central ledger `.shark/subagents.json` on disk to store real-time execution snapshots and use `fs.watch` and watchdog timeouts to safely monitor and terminate unresponsive subagents.

**Tech Stack:** Node.js, TypeScript, Vitest, Commander.js, StackSpot AI API

## Global Constraints
- Target Node.js version is >= 18.
- Never write placeholder code (no `TODO`, `TBD`, or partial implementations).
- All changes must be verified using Vitest.
- Normalization: properties for subagent communication are snake_case (`recipient`, `message`).

---

### Task 1: Segregate Schemas & System Prompts

**Files:**
- Create/Modify: `src/core/api/prompts.ts`
- Test: `tests/core/api/prompts.test.ts`

**Interfaces:**
- Consumes: None (base prompts module)
- Produces: `COORDINATOR_RESPONSE_JSON_SCHEMA`, `SUBAGENT_RESPONSE_JSON_SCHEMA`, `COORDINATOR_SYSTEM_PROMPT`, `SUBAGENT_SYSTEM_PROMPT`

- [ ] **Step 1: Write the failing test**
  Add a test to verify both schemas exist, and that `SUBAGENT_RESPONSE_JSON_SCHEMA` has only the allowed actions and snake_case properties.
  ```typescript
  // File: tests/core/api/prompts.test.ts
  import { describe, it, expect } from 'vitest';
  import { COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA } from '../../src/core/api/prompts.js';

  describe('Schemas', () => {
      it('should have only task-level tools for subagents', () => {
          const subagentTools = SUBAGENT_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum;
          expect(subagentTools).not.toContain('invoke_subagent');
          expect(subagentTools).not.toContain('manage_subagents');
          expect(subagentTools).toContain('read_file');
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/core/api/prompts.test.ts`
  Expected: FAIL with "COORDINATOR_RESPONSE_JSON_SCHEMA/SUBAGENT_RESPONSE_JSON_SCHEMA not found"

- [ ] **Step 3: Write minimal implementation**
  Modify `src/core/api/prompts.ts` to export:
  - `COORDINATOR_RESPONSE_JSON_SCHEMA` (clone of current full schema)
  - `SUBAGENT_RESPONSE_JSON_SCHEMA` (stripped version: 11 task actions, with `recipient` and `message` in snake_case)
  - `COORDINATOR_SYSTEM_PROMPT`
  - `SUBAGENT_SYSTEM_PROMPT` (focused on stateless tasks and complete_task/send_message)
  Keep the deprecated `AGENT_RESPONSE_JSON_SCHEMA` pointing to coordinator schema for backward compatibility.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/core/api/prompts.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/api/prompts.ts
  git commit -m "feat: segregate schemas and system prompts"
  ```

---

### Task 2: Update Providers (StackSpot & OpenAI Compatibility)

**Files:**
- Modify: `src/core/api/stackspot-provider.ts`
- Modify: `src/core/api/openai-compatible-provider.ts`
- Test: `tests/core/api/stackspot-provider.test.ts`

**Interfaces:**
- Consumes: `COORDINATOR_RESPONSE_JSON_SCHEMA`, `SUBAGENT_RESPONSE_JSON_SCHEMA`
- Produces: Correct schemas and prompts matched based on env/options

- [ ] **Step 1: Write the failing test**
  Verify that if `process.env.SHARK_SUBAGENT_ROLE` is set, `StackSpotProvider` uses `subagentId` and subagent prompt/schema.
  ```typescript
  // File: tests/core/api/stackspot-provider.test.ts
  import { describe, it, expect, vi } from 'vitest';
  import { StackSpotProvider } from '../../src/core/api/stackspot-provider.js';

  describe('StackSpotProvider', () => {
      it('should select subagent ID and prompt if running as subagent', async () => {
          process.env.SHARK_SUBAGENT_ROLE = 'Implementer';
          // Mock config with subagentId
          const provider = new StackSpotProvider('developer_agent');
          expect((provider as any).getAgentId()).toBe('subagent-agent-id');
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/core/api/stackspot-provider.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  Update `src/core/api/stackspot-provider.ts` and `src/core/api/openai-compatible-provider.ts` to:
  - Check if `process.env.SHARK_SUBAGENT_ROLE` is set.
  - If yes, use `config.stackspot.subagentId` and `SUBAGENT_RESPONSE_JSON_SCHEMA` / `SUBAGENT_SYSTEM_PROMPT`.
  - Otherwise, use the standard `agentId` and coordinator prompts.
  - Add mapping logic in the response handler: convert incoming snake_case `recipient`/`message` to internal variables if needed, or update consumers to accept snake_case.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/core/api/stackspot-provider.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts
  git commit -m "feat: resolve schema and agent id based on subagent context"
  ```

---

### Task 3: Implement File-Briefing for Subagent Spawn

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Test: `tests/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `SUBAGENT_RESPONSE_JSON_SCHEMA`
- Produces: CLI execution utilizing briefing files instead of raw JSON prompts

- [ ] **Step 1: Write the failing test**
  Verify that when `invokeSubagents` is called with a `BriefFile` path, it resolves and passes it directly.
  ```typescript
  // File: tests/core/workflow/subagent-manager.test.ts
  import { describe, it, expect, vi } from 'vitest';
  import { subagentManager } from '../../src/core/workflow/subagent-manager.js';

  describe('SubagentManager Spawn', () => {
      it('should spawn subagent with brief file reference', async () => {
          // Verify CLI arguments include the path
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/core/workflow/subagent-manager.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Update `SubagentManager.invokeSubagents` to write subagent prompt instructions to `.shark/sdd/task-<subagent_id>-brief.md`.
  - Update the subagent spawn fork arguments to pass this path (`--task-file`).
  - Modify `interactiveDeveloperAgent` in `developer-agent.ts` to read `--task-file` instructions directly into the local session context instead of resolving raw JSON instruction.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/core/workflow/subagent-manager.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/workflow/subagent-manager.ts src/core/agents/developer-agent.ts
  git commit -m "feat: implement file-briefing for subagent invocation"
  ```

---

### Task 4: Implement Central Subagent Ledger

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Test: `tests/core/workflow/subagent-manager-ledger.test.ts`

**Interfaces:**
- Consumes: Subagent status changes, tool calls
- Produces: `.shark/subagents.json` state updates

- [ ] **Step 1: Write the failing test**
  Verify ledger is updated when a subagent is registered and when a tool call occurs.
  ```typescript
  // File: tests/core/workflow/subagent-manager-ledger.test.ts
  import { describe, it, expect } from 'vitest';
  import { subagentManager } from '../../src/core/workflow/subagent-manager.js';
  import fs from 'node:fs';

  describe('Ledger', () => {
      it('should write execution info on disk', () => {
          subagentManager.registerSubagent('subagent-1', 'dev', 'Implementer');
          expect(fs.existsSync('.shark/subagents.json')).toBe(true);
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/core/workflow/subagent-manager-ledger.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Create a private method `writeLedger()` in `SubagentManager` that persists the state map to `.shark/subagents.json`.
  - Update `registerSubagent`, `terminateSubagent`, and `updateSubagentSummary` to invoke `writeLedger()`.
  - Intercept subagent tool executions (e.g. before calling `applyAnchoredEdit` or `runCommand` in `developer-agent.ts`) and update the ledger entry with `lastAction` and `lastActiveAt`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/core/workflow/subagent-manager-ledger.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/workflow/subagent-manager.ts src/core/agents/developer-agent.ts
  git commit -m "feat: implement central subagent status ledger"
  ```

---

### Task 5: Implement Watchdog & File Watcher

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Test: `tests/core/workflow/subagent-watchdog.test.ts`

**Interfaces:**
- Consumes: `.shark/subagents.json` updates
- Produces: Automated `SIGKILL` termination on inactivity

- [ ] **Step 1: Write the failing test**
  Verify watchdog terminates subagents that have not updated `lastActiveAt` in over 5 minutes.
  ```typescript
  // File: tests/core/workflow/subagent-watchdog.test.ts
  import { describe, it, expect, vi } from 'vitest';
  import { subagentManager } from '../../src/core/workflow/subagent-manager.js';

  describe('Watchdog', () => {
      it('should terminate unresponsive subagent', () => {
          // Setup subagent state with old lastActiveAt and verify termination
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/core/workflow/subagent-watchdog.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Use `fs.watch` to re-read `.shark/subagents.json` in the parent Coordinator process.
  - Implement a timer (every 10-30 seconds) in `SubagentManager` to iterate active subagents:
    - If `Date.now() - subagent.lastActiveAt > 300000` (5 minutes), call `subagent.childProcess.kill('SIGKILL')`, update status to `"timeout"`, and report to parent message queue.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/core/workflow/subagent-watchdog.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/workflow/subagent-manager.ts
  git commit -m "feat: implement watchdog timer for silent subagent failures"
  ```

---

### Task 6: Interactive CLI Commands (`export-schema` & `export-prompt`)

**Files:**
- Modify: `src/commands/export-schema.ts`
- Modify: `src/commands/export-prompt.ts`
- Test: `tests/commands/export-commands.test.ts`

**Interfaces:**
- Consumes: user CLI args, interactive selection
- Produces: Prompt/Schema output

- [ ] **Step 1: Write the failing test**
  Verify `export-schema` prints coordinator schema by default or prompts using TUI.
  ```typescript
  // File: tests/commands/export-commands.test.ts
  import { describe, it, expect, vi } from 'vitest';

  describe('Export commands', () => {
      it('should prompt when no args are provided', () => {
          // Mock tui.select and test
      });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/commands/export-commands.test.ts`
  Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
  - Modify `src/commands/export-schema.ts` and `src/commands/export-prompt.ts`.
  - Update the action handlers:
    - Check if parameter is provided.
    - If empty, use `tui.select` (already available in our TUI/prompts suite) with options: `Coordinator / Parent Agent` and `Subagent`.
    - Print the chosen asset (either the prompt or schema corresponding to the selection).

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/commands/export-commands.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/commands/export-schema.ts src/commands/export-prompt.ts
  git commit -m "feat: add interactive TUI selection to export commands"
  ```
