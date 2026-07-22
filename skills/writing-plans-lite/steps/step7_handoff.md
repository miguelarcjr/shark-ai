# Step 7/7: Handoff to Execution

## Goal
Complete the planning phase and hand off to execution skills.

## Actions
1. Use the `modify_file` action to update the state block in the plan file to mark all steps as completed:
   ```markdown
   <!-- PLAN STATE
   - [x] 1/7 Analyze Spec
   - [x] 2/7 Clarify Constraints
   - [x] 3/7 Map File Structure
   - [x] 4/7 Draft Tasks
   - [x] 5/7 Write Plan Doc
   - [x] 6/7 Self-Review
   - [x] 7/7 Handoff
   -->
   ```
2. Use the `talk_with_user` action to ask the user to choose the execution method:
   * **1. Subagent-Driven (Recommended):** Use the `activate_skill` action with `skill_name` set to `subagent-driven-development-lite` (located in the folder `.agents/skills/subagent-driven-development-lite/` or `.agent/skills/subagent-driven-development-lite/`).
   * **2. Inline Execution:** Use the `activate_skill` action with `skill_name` set to `executing-plans-lite`.
3. Do NOT write any implementation code.
