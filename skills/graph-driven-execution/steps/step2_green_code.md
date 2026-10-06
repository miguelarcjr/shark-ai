# Step 2: TDD GREEN Phase (Minimal Implementation)

## Goal
Implement the minimal code required to turn the failing test green, respecting the approved architecture and task file boundaries.

## Actions for the Coordinator
1. **Generate Brief:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs brief tdd-dev`
2. **Dispatch Developer Subagent:**
   - Use `invoke_subagent` with:
     - `role`: "tdd-dev"
     - `task_file`: `.shark/specs/<spec-id>/briefs/exec-tdd-dev-task-<N>.md`
3. **Run Deterministic Gate:**
   - Execute: `node skills/graph-driven-execution/scripts/exec-ctl.mjs verify green`
   - *Requirement:* All tests in the worktree must pass cleanly (exit code 0).
4. **Transition to Lint & Typecheck:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs transition --next`
   - Proceed to `step3_lint_typecheck.md`.
