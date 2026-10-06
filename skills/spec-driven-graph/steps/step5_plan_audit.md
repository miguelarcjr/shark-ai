# Step 5/6: Plan Quality & Traceability Audit (Node 6)

## Goal
Audit the TDD implementation plan against the requirements brief and approved architecture, ensuring 100% test coverage, strict TDD sequence, and zero forward references before execution begins.

## Actions for the Coordinator
1. **Generate Auditor Briefing:**
   - Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs brief plan-auditor`
2. **Dispatch Plan Auditor:**
   - Use `invoke_subagent` with:
     - `role`: "plan-auditor"
     - `task_file`: `.shark/specs/<spec-id>/briefs/plan-auditor-brief.md`
3. **Validate Gate:**
   - Once `.shark/specs/<spec-id>/artifacts/plan-critique.md` is generated, run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs validate`
4. **Handle Verdict:**
   - **If VERDICT: BLOCKER:**
     - The coordinator MUST execute a rollback:
       `node skills/spec-driven-graph/scripts/spec-ctl.mjs rollback --to TDD_PLAN_DECOMPOSITION --reason "<blocker description>"`
     - Re-dispatch the `planner` subagent to fix the plan.
   - **If VERDICT: PASS or PASS WITH WARNINGS:**
     - Transition to completion:
       `node skills/spec-driven-graph/scripts/spec-ctl.mjs transition --next`
     - Proceed to `step6_handoff.md`.
