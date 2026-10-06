# Step 2/5: System Architecture & Technical Design (Node 2)

## Goal
Design the technical solution, map file changes, and define interface contracts without writing implementation code.

## Actions for the Coordinator
1. **Generate Architect Briefing:**
   - Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs brief architect`
2. **Dispatch System Architect:**
   - Use `invoke_subagent` with:
     - `role`: "System Architect"
     - `task_file`: `.shark/specs/<spec-id>/briefs/architect-brief.md`
3. **Validate Gate:**
   - When the Architect outputs `.shark/specs/<spec-id>/artifacts/design.md`, run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs validate`
4. **Transition to Review:**
   - If validation passes, advance the state:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs transition --next`
   - Proceed to `step3_adversarial.md`.
