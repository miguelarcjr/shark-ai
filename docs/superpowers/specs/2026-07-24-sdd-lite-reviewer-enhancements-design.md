# SDD-Lite Reviewer Subagent Zero-Turn Enhancements Design

## Goal
Eliminate lazy review behavior and zero-read failures in the Revisor subagent by injecting both the Implementer's report and the Git diff directly into the Revisor's briefing file on Turn 0, while retaining explicit permissions for reading codebase files when evaluating cross-cutting risks.

## Context & Problem Statement
In `subagent-driven-development-lite`, the Revisor subagent previously received file paths (`[REPORT_FILE]` and `[DIFF_FILE]`) and had to spend 1-2 initial turns calling `read_file` before writing its review report. On certain fast or aggressive LLM models, the subagent attempted to complete the task in a single turn by skipping `read_file`, inventing justifications ("due to context limitations I didn't re-read the diff"), and writing an unverified approval report.

## Proposed Changes

### 1. Dual-Injection Briefing in `prepare-brief.mjs`
Modify `prepare-brief.mjs` in `reviewer` mode to automatically embed:
- **Implementer's Report Content:** Read from `task-subagent-[ID]-report.md` (or recovered from `.shark/subagents.json`).
- **Git Diff Content:** Generated via `git diff -U10` with 10 lines of surrounding context.

These two sections will be formatted into the placeholders `[IMPLEMENTER_REPORT_CONTENT]` and `[DIFF_CONTENT]` inside the briefing document `task-subagent-[REVIEWER_ID]-review-brief.md`.

### 2. Strict Hard-Gate & Codebase Read Rules in `task-reviewer-prompt.md`
Update `task-reviewer-prompt.md` with:
- A `<HARD-GATE>` forbidding empty reports or skipping review claims.
- Explicit instructions that the embedded Implementer Report and Git Diff form the primary review source.
- Clear authorization for the Revisor to use `read_file` on codebase files if:
  1. A diff hunk is cut off mid-function/class.
  2. Evaluating concrete cross-cutting risks (such as modified API contracts, shared state, or exported interfaces).

### 3. File Creation & Task Completion Requirements
- The Revisor MUST write its final review report using the native `create_file` action with `path` set to `[REVIEW_REPORT_FILE]`.
- The Revisor MUST conclude by calling `complete_task` with a concise technical summary in `content`.

## Verification Plan
1. **Dry-Run Briefing Compilation:** Run `prepare-brief.mjs reviewer` to verify that both the Implementer report and git diff are correctly embedded into `.shark/sdd/task-subagent-[ID]-review-brief.md`.
2. **Build Verification:** Run `npm run build` in `bmadspot` to confirm project build success.
