# Step 1/5: Pre-flight & Setup

## Goal
Initialize the progress ledger and dispatch the first task.

## Actions
1. **Initialize Ledger:** If `.shark/progress.md` does not exist:
   * Action: Use the `run_command` action to initialize it:
     `node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs init docs/superpowers/plans/PLAN_FILE_NAME.md`
     (Replace PLAN_FILE_NAME.md with the plan filename).
2. **Prepare Briefing:** If `.shark/progress.md` exists, but `.shark/sdd/task-N-run-brief.md` does not exist:
   * Action: Use the `run_command` action to run:
     `node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs implementer docs/superpowers/plans/PLAN_FILE_NAME.md N`
     (Replace PLAN_FILE_NAME.md with the plan filename, and N with the task number).
3. **Dispatch Implementer:** If the briefing file `.shark/sdd/task-N-run-brief.md` has been written:
   * Action: Use the `invoke_subagent` action to spawn the implementer subagent with the flat properties:
     - `type_name`: "self"
     - `role`: "Implementer"
     - `task_file`: ".shark/sdd/task-N-run-brief.md"
4. **Start Waiting:** Once dispatched:
   * Action: Use the `wait` action without `duration_seconds` (or set to `null`) to wait indefinitely.

---

**Next Step:** Once the implementer is running, call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step2_wait.md`.
