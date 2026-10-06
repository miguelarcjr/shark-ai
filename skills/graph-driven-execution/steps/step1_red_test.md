# Step 1: TDD RED Phase (Write Failing Test)

## Goal
Write the specific unit/integration test required for the active task and prove that it fails for the right reason (anti-tautology check).

## Actions for the Coordinator
1. **Generate Brief:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs brief tdd-dev`
2. **Dispatch Developer Subagent:**
   - Use `invoke_subagent` with:
     - `role`: "tdd-dev"
     - `task_file`: `.shark/specs/<spec-id>/briefs/exec-tdd-dev-task-<N>.md`
3. **Run Deterministic Gate:**
   - Execute: `node skills/graph-driven-execution/scripts/exec-ctl.mjs verify red`
   - *Requirement:* The test command must return exit code $\neq 0$. If the test passes without implementation code, the gate rejects it as a false-positive/tautological test!
4. **Transition to GREEN:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs transition --next`
   - Proceed to `step2_green_code.md`.
