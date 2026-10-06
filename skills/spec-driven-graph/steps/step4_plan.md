# Step 4/6: TDD Plan Decomposition (Node 5)

## Goal
Transform the approved, resilient architecture into a sequential, bite-sized TDD plan compatible with Subagent-Driven Development.

## Actions for the Coordinator
1. **Generate Planner Briefing:**
   - Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs brief planner`
2. **Dispatch Lead Planner:**
   - Use `invoke_subagent` with:
     - `role`: "planner"
     - `task_file`: `.shark/specs/<spec-id>/briefs/planner-brief.md`
3. **Validate Gate:**
   - Once `.shark/specs/<spec-id>/artifacts/plan.md` is generated, run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs validate`
4. **Transition to Plan Audit:**
   - Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs transition --next`
   - Proceed to `step5_plan_audit.md`.
