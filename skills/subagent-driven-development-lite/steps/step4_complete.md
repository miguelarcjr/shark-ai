# Step 4/5: Mark Task Complete

## Goal
Mark the completed task in the progress ledger and advance or hand off.

## Actions
1. **Update Ledger:** Use the `run_command` action to mark the current task as complete:
   `node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs complete docs/superpowers/plans/PLAN_FILE_NAME.md N`
   (Replace PLAN_FILE_NAME.md with the plan filename, and N with the task number).
2. **Determine Next Action:**
   * **If more tasks remain pending:** Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step1_setup.md` to start the next task.
   * **If all tasks are complete:** Use the `talk_with_user` action to notify the user that all tasks are complete, and then use the `activate_skill` action with `skill_name` set to `finishing-a-development-branch`.
