# Writing Plans Lite Enhancements Design

## Overview
Enhance `skills/writing-plans-lite` to prevent detail degradation, over-simplification, and overly broad tasks in final plan stages, while maintaining full compatibility with `skills/subagent-driven-development-lite`.

## Goal
Ensure implementation plans generated via `writing-plans-lite` maintain bite-sized task granularity, complete code blocks, and zero placeholders across all tasks (from Task 1 to Task N), introducing chunked writing for plans with more than 4 tasks.

## Design Details

### 1. Dynamic Task Sizing in Step 4 (`step4_draft.md`)
- Remove the artificial "typically 3-5 tasks" constraint.
- Task boundaries are determined dynamically by component boundaries and independently testable deliverables.
- When drafting >4 tasks, explicitly plan a multi-stage writing process for Step 5.

### 2. Strict Quality & No-Placeholder Rules in Step 5 (`step5_write.md`)
- Strictly prohibit placeholders (`TODO`, `TBD`, "add generic error handling", "implement later", "similar to Task 1").
- Enforce full code blocks (failing test, minimal code), exact commands with PASS/FAIL expectations, and git commit instructions for every task step.
- Equal Detail Rule: Task N must be as detailed, concrete, and explicit as Task 1.

### 3. Chunked Writing Flow in Step 5 (`step5_write.md`)
- For plans with $\le 4$ tasks: Generate the plan document in a single file operation.
- For plans with $> 4$ tasks:
  - Operation 1: Write Header + Global Constraints + Tasks 1–3.
  - Operation 2: Append Tasks 4..N without losing code snippet quality or interface definitions.

## Compatibility
The plan format remains 100% compatible with `subagent-driven-development-lite` (`prepare-brief.mjs`), preserving headers (`### Task N:`), section `## Global Constraints`, and checkboxes (`- [ ]`).
