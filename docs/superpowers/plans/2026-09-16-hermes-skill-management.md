# Hermes-Inspired Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Hermes Agent procedural memory triad (`skills_list`, `skill_view`, `skill_manage`) in Shark Dev, preserving LLM prompt caching, enabling dynamic template interpolation, safe surgical patching, pinned skill protection, staged write approvals, and `.archive/` backups.

**Architecture:** Refactor `SkillManager` into a complete procedural engine with template variable interpolation (`${SHARK_SKILL_DIR}`, `${SHARK_SESSION_ID}`), safety controls (quarantine staging, pinned protection, `.archive/`), and usage telemetry (`.usage.json`). Update `prompts.ts` with dedicated first-class actions and schema definitions. Integrate action execution in `developer-agent.ts` with TUI `/skills` commands and freeze system instructions to preserve LLM prompt caching.

**Tech Stack:** TypeScript (ESM), Node.js `fs/promises`, `path`, `os`, Vitest.

## Global Constraints

- Preserve LLM prompt caching: System prompt base MUST remain frozen across turns; skill contents are returned as tool/action observation messages.
- Backward compatibility: Keep `activate_skill` mapped internally to `skill_view`.
- Safe deletion: Never use permanent `rm -rf` on skill packages; move to `.archive/<name>_<timestamp>/`.
- Strict typing & validation: Validate all arguments using TypeScript and zod where appropriate.

---

### Task 1: Refactor `SkillManager` with Progressive Loading, Template Interpolation, and Safety Governance

**Files:**
- Modify: `src/core/workflow/skill-manager.ts`
- Test: `src/core/workflow/skill-manager.test.ts`

**Interfaces:**
- Consumes: `fs/promises`, `path`, `os`, `ConfigManager` from `src/core/config/config-manager.js`
- Produces:
  ```typescript
  export interface SkillMetadata {
      name: string;
      description: string;
      isPinned?: boolean;
  }

  export interface SkillUsageMetadata {
      created_by: 'user' | 'agent';
      created_at: string;
      last_used_at: string;
      use_count: number;
  }

  export interface SkillManageParams {
      action: 'create' | 'edit' | 'patch' | 'write_file' | 'remove_file' | 'delete';
      name: string;
      content?: string;
      file_path?: string;
      old_string?: string;
      new_string?: string;
      scope?: 'local' | 'global';
  }

  export interface PendingSkillChange {
      id: string;
      timestamp: string;
      params: SkillManageParams;
      summary: string;
  }
  ```
  Methods on `SkillManager`:
  - `listSkills(query?: string): Promise<string>`
  - `viewSkill(name: string, filePath?: string, sessionId?: string): Promise<string>`
  - `manageSkill(params: SkillManageParams): Promise<{ status: 'success' | 'pending' | 'error'; message: string; pendingId?: string }>`
  - `listPending(): Promise<PendingSkillChange[]>`
  - `approvePending(id: string): Promise<string>`
  - `rejectPending(id: string): Promise<string>`
  - `interpolateTemplateVariables(content: string, skillDir: string, sessionId?: string): string`

- [ ] **Step 1: Write the failing tests for SkillManager in `skill-manager.test.ts`**
  Add unit tests for:
  - `interpolateTemplateVariables` replacing `${SHARK_SKILL_DIR}` and `${SHARK_SESSION_ID}`.
  - `listSkills` returning compact 1-line markdown list with `[pinned]` indicator.
  - `viewSkill` loading `SKILL.md` or auxiliary file, interpolating variables, and updating `.usage.json`.
  - `manageSkill` create, edit, surgical patch (`old_string` -> `new_string`), auxiliary `write_file` / `remove_file`, and safe `delete` moving to `.archive/`.
  - `manageSkill` blocking deletion of pinned skills.
  - `manageSkill` staging changes when `write_approval: true`, and subsequent `approvePending` / `rejectPending`.

- [ ] **Step 2: Run test to verify failures**
  Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
  Expected: FAIL (new methods not defined).

- [ ] **Step 3: Implement new methods and governance logic in `src/core/workflow/skill-manager.ts`**
  - Implement interpolation of `${SHARK_SKILL_DIR}` and `${SHARK_SESSION_ID}`.
  - Implement `.usage.json` tracking (`created_by`, `created_at`, `last_used_at`, `use_count`).
  - Implement `manageSkill` with validation, surgical patching, archive moving, and pending approval quarantine.
  - Freeze `getSystemInstructionExtension` to return empty string (or mark deprecated) to keep prompt cache frozen.

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run src/core/workflow/skill-manager.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/core/workflow/skill-manager.ts src/core/workflow/skill-manager.test.ts
  git commit -m "feat(skills): implement hermes procedural skill management in SkillManager"
  ```

---

### Task 2: Update System Prompts and Action JSON Schemas

**Files:**
- Modify: `src/core/api/prompts.ts`
- Test: `src/core/api/prompts.test.ts`

**Interfaces:**
- Consumes: `TOOL_ARGS_PROPERTIES`, `COORDINATOR_RESPONSE_JSON_SCHEMA`, `buildUnifiedSystemPrompt`
- Produces: Updated JSON schema including `"skills_list" | "skill_view" | "skill_manage"` and argument properties `file_path`, `old_string`, `new_string`, `scope`.

- [ ] **Step 1: Write the failing tests in `src/core/api/prompts.test.ts`**
  Add assertions checking that:
  - `COORDINATOR_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum` contains `'skills_list'`, `'skill_view'`, and `'skill_manage'`.
  - `TOOL_ARGS_PROPERTIES` contains `file_path`, `old_string`, `new_string`, `scope`.
  - `buildUnifiedSystemPrompt` contains guidance for `skills_list`, `skill_view`, and `skill_manage`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/api/prompts.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Update `src/core/api/prompts.ts`**
  - Add `file_path`, `old_string`, `new_string`, `scope` to `TOOL_ARGS_PROPERTIES`.
  - Add `'skills_list'`, `'skill_view'`, `'skill_manage'` to `COORDINATOR_RESPONSE_JSON_SCHEMA`.
  - Update instructions in `corePrompt` under `⚡ CATÁLOGO DE SKILLS E MEMÓRIA PROCEDURAL` explaining on-demand `skill_view` and `skill_manage`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/api/prompts.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/core/api/prompts.ts src/core/api/prompts.test.ts
  git commit -m "feat(prompts): add skills_list, skill_view and skill_manage schemas"
  ```

---

### Task 3: Integrate Skills Actions in `developer-agent.ts` and Enhance `/skills` TUI

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `skillManager.listSkills`, `skillManager.viewSkill`, `skillManager.manageSkill`, `skillManager.listPending`, `skillManager.approvePending`, `skillManager.rejectPending`
- Produces: Action handling for `skills_list`, `skill_view`, `skill_manage` inside coordinator loop, with action output returned in conversation history; TUI commands `/skills`, `/skills pending`, `/skills approve <id>`.

- [ ] **Step 1: Write failing tests in `src/core/agents/developer-agent.test.ts`**
  Add tests for:
  - Agent executing `skills_list` action.
  - Agent executing `skill_view` action returning skill markdown without altering dynamic system prompt.
  - Agent executing `skill_manage` action.
  - Handling `/skills pending` and `/skills approve <id>` command.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run src/core/agents/developer-agent.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement action handlers and TUI commands in `src/core/agents/developer-agent.ts`**
  - In coordinator action processing:
    - `action.type === 'skills_list'` -> calls `skillManager.listSkills(action.args?.query)`.
    - `action.type === 'skill_view'` -> calls `skillManager.viewSkill(action.args?.name, action.args?.file_path, activeConversationId)`.
    - `action.type === 'skill_manage'` -> calls `skillManager.manageSkill(action.args)`.
    - `action.type === 'activate_skill'` -> fallback forwarding to `skill_view`.
  - In `onCommandHandler`:
    - Handle `/skills pending` to list quarantined proposals.
    - Handle `/skills approve <id>` and `/skills reject <id>`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/agents/developer-agent.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
  git commit -m "feat(agent): support skills_list, skill_view, skill_manage and tui approvals"
  ```

---

### Task 4: Full Regression and Provider Prompt Caching Verification

**Files:**
- Modify: `src/core/api/stackspot-provider.ts`, `src/core/api/openai-compatible-provider.ts` (if any leftover dynamic skill extensions exist)
- Test: `src/core/api/stackspot-provider.test.ts`, `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: LLM providers
- Produces: Verifies that system prompts remain completely static across multi-turn conversations.

- [ ] **Step 1: Check and update provider tests**
  Verify that providers send clean, static system instructions and do not concatenate mutable skill bodies.

- [ ] **Step 2: Run all unit and integration tests**
  Run: `npx vitest run`
  Expected: All tests PASS.

- [ ] **Step 3: Commit any adjustments**
  ```bash
  git add src/core/api/
  git commit -m "test(providers): ensure static system instruction for prompt caching"
  ```
