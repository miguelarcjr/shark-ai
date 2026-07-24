# SDD-Lite Physical Code Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure subagents physically create and modify codebase files on disk using file actions rather than outputting text proposals in markdown reports. Refactor orchestrator system prompts to be role-agnostic and implement untracked-file diff validation in `prepare-brief.mjs`.

**Architecture:** Update `subagent-manager.ts` and `prompts.ts` system prompts to clarify that `complete_task` is a completion notification, not execution itself. Add physical edit guidance to `implementer-prompt.md` and `step5_fix.md`. Add a 0-diff hard-gate to `task-reviewer-prompt.md` and `git add -N .` untracked diff validation in `prepare-brief.mjs`.

**Tech Stack:** TypeScript, Node.js (ESM), Vitest, Git CLI.

## Global Constraints

- Keep orchestrator prompts in `subagent-manager.ts` and `prompts.ts` 100% role-agnostic.
- Support untracked files created by implementers via `git add -N .` before extracting git diffs.
- Maintain native action format (`create_file`, `modify_file`, `complete_task`).

---

### Task 1: Refactor Orchestrator System Prompts to Role-Agnostic Phrasing

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts:433`
- Modify: `src/core/api/prompts.ts:72`

**Interfaces:**
- Consumes: Subagent execution request
- Produces: System prompt instruction clarifying `complete_task` purpose.

- [ ] **Step 1: Update `subagent-manager.ts` customContext line 433**

In `src/core/workflow/subagent-manager.ts`:
Replace:
```typescript
customContext += `- Para concluir a tarefa e enviar o resultado detalhado em markdown, use obrigatoriamente a ação 'complete_task' com suas descobertas no campo 'content'.\n`;
```
With:
```typescript
customContext += `- Quando você tiver EXECUTADO integralmente todas as ações da sua tarefa, use a ação 'complete_task' com um resumo técnico no campo 'content' para notificar a conclusão.\n`;
```

- [ ] **Step 2: Update `SUBAGENT_SYSTEM_PROMPT` in `src/core/api/prompts.ts` line 72**

In `src/core/api/prompts.ts`:
Replace:
```typescript
- Para concluir a tarefa com sucesso e enviar os resultados detalhados em markdown, use obrigatoriamente a ação 'complete_task' com suas descobertas no campo 'content'.
```
With:
```typescript
- Quando você tiver EXECUTADO integralmente todas as ações da sua tarefa, use a ação 'complete_task' com um resumo técnico no campo 'content' para notificar a conclusão.
```

- [ ] **Step 3: Run Vitest prompt tests**

Run: `npx vitest run tests/core/api/prompts.test.ts`
Expected: PASS

- [ ] **Step 4: Commit Task 1 changes**

```bash
git add src/core/workflow/subagent-manager.ts src/core/api/prompts.ts
git commit -m "refactor(core): make subagent complete_task prompt instruction role-agnostic"
```

---

### Task 2: Add Physical Code Edit Guidance to Prompts & Reviewer Hard-Gate

**Files:**
- Modify: `skills/subagent-driven-development-lite/implementer-prompt.md`
- Modify: `skills/subagent-driven-development-lite/steps/step5_fix.md`
- Modify: `skills/subagent-driven-development-lite/task-reviewer-prompt.md`

**Interfaces:**
- Consumes: SDD-lite prompt templates
- Produces: Updated prompts with physical file edit directives and 0-diff reviewer gate.

- [ ] **Step 1: Add physical edit directive to `implementer-prompt.md`**

In `skills/subagent-driven-development-lite/implementer-prompt.md`, add under `<HARD-GATE>`:
```markdown
Você é responsável pela implementação física das alterações no código do projeto. Você DEVE criar ou modificar arquivos reais no código-fonte utilizando as ferramentas `create_file` ou `modify_file` e executar os testes.
```

- [ ] **Step 2: Add physical edit directive to `step5_fix.md`**

In `skills/subagent-driven-development-lite/steps/step5_fix.md`, add under actions:
```markdown
* Note: O subagente Fixer DEVE realizar alterações físicas no código-fonte utilizando as ferramentas `create_file` ou `modify_file` e executar os testes.
```

- [ ] **Step 3: Add 0-diff rejection rule to `task-reviewer-prompt.md`**

In `skills/subagent-driven-development-lite/task-reviewer-prompt.md`, add inside `<HARD-GATE>`:
```markdown
3. Se o git diff estiver vazio (0 arquivos alterados no disco), a tarefa DEVE ser REPROVADA imediatamente com o veredito: `❌ Nenhuma alteração física realizada no código do projeto`.
```

- [ ] **Step 4: Commit Task 2 changes**

```bash
git add skills/subagent-driven-development-lite/implementer-prompt.md skills/subagent-driven-development-lite/steps/step5_fix.md skills/subagent-driven-development-lite/task-reviewer-prompt.md
git commit -m "docs(sdd-lite): add physical code edit guidance and 0-diff reviewer gate"
```

---

### Task 3: Implement Untracked-File Diff Validation in `prepare-brief.mjs`

**Files:**
- Modify: `skills/subagent-driven-development-lite/scripts/prepare-brief.mjs:293-315`

**Interfaces:**
- Consumes: Git working tree state (tracked + untracked files)
- Produces: Diff report with untracked files captured and 0-diff warning header if empty.

- [ ] **Step 1: Add `git add -N .` call in `prepare-brief.mjs` before git diff**

In `skills/subagent-driven-development-lite/scripts/prepare-brief.mjs` in `reviewer` mode:
Before executing `git diff --stat`:
```javascript
try { execSync('git add -N .', { encoding: 'utf8' }); } catch {}
```

- [ ] **Step 2: Add 0-diff warning header injection when diff is empty**

In `prepare-brief.mjs` (reviewer mode):
If `diff.trim() === ''`:
Prepend warning text to `diffReport`:
`⚠️ ATENÇÃO CRÍTICA: O Git Diff está VAZIO. O Implementador não alterou nenhum arquivo físico no disco.`

- [ ] **Step 3: Test `prepare-brief.mjs` syntax**

Run: `node -c skills/subagent-driven-development-lite/scripts/prepare-brief.mjs`
Expected: Clean output (zero syntax errors).

- [ ] **Step 4: Commit Task 3 changes**

```bash
git add skills/subagent-driven-development-lite/scripts/prepare-brief.mjs
git commit -m "feat(sdd-lite): support untracked files via git add -N and add empty diff warning in prepare-brief"
```

---

### Task 4: Compilation & Test Verification

**Files:**
- Verify: `skills/subagent-driven-development-lite/`

- [ ] **Step 1: Run project build**

Run: `npm run build`
Expected: Build success with zero errors.

- [ ] **Step 2: Run full Vitest test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit final verification**

```bash
git add .
git commit -m "chore(sdd-lite): verify physical code enforcement enhancements build and tests"
```
