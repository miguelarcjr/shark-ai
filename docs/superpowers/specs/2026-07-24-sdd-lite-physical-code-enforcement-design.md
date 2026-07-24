# SDD-Lite Physical Code Enforcement Design

## Goal
Ensure subagents perform physical code edits on disk using file tools (`create_file` / `modify_file`) rather than dry-run text proposals in markdown reports. Fix misleading system prompt phrasing in orchestrator and implement programmatic untracked-file diff validation in `prepare-brief.mjs`.

## Context & Problem Statement
On certain LLM models (e.g. DeepSeek-R1 / Qwen), subagents interpreted the system instruction:
`Para concluir a tarefa e enviar o resultado detalhado em markdown, use obrigatoriamente a ação 'complete_task' com suas descobertas no campo 'content'`
as meaning their primary deliverable was writing code text into `complete_task` content. Implementers generated text patches in reports without modifying disk files, and Reviewers approved them without verifying physical git diffs.

## Proposed Changes

### 1. Role-Agnostic System Prompt Refactoring
Update `subagent-manager.ts` and `prompts.ts` line instructions to be role-agnostic and clarify that `complete_task` is the completion notification:
- **New Phrasing:** `- Quando você tiver EXECUTADO integralmente todas as ações da sua tarefa, use a ação 'complete_task' com um resumo técnico no campo 'content' para notificar a conclusão.`

### 2. Physical File Edit Guidance in Prompts
In `implementer-prompt.md` and `step5_fix.md`:
- Add positive directive: `Você é responsável pela implementação física das alterações no código do projeto. Você DEVE criar ou modificar arquivos reais no código-fonte utilizando as ferramentas create_file ou modify_file e executar os testes.`

In `task-reviewer-prompt.md`:
- Add hard-gate: `Se o git diff estiver vazio (0 arquivos alterados no disco), a tarefa DEVE ser REPROVADA imediatamente com o veredito: ❌ Nenhuma alteração física realizada no código do projeto.`

### 3. Programmatic Untracked-File Diff Validation in `prepare-brief.mjs`
In `prepare-brief.mjs` (reviewer mode):
- Run `git add -N .` (intent-to-add) before running `git diff` so new untracked files created on disk are captured.
- Check if git diff output is empty (0 bytes / 0 files changed). If empty, inject an explicit alert header in the reviewer's briefing:
  `⚠️ ATENÇÃO CRÍTICA: O Git Diff está VAZIO. O Implementador não alterou nenhum arquivo físico no disco.`

## Verification Plan
1. **Dry-Run Briefing Compilation:** Test `prepare-brief.mjs reviewer` with 0 diff and verify warning header injection.
2. **Build Verification:** Run `npm run build` in `bmadspot` to confirm project build success.
