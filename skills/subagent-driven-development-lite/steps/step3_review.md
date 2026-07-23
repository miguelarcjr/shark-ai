# Step 3/5: Review Package & Dispatch Reviewer

## Goal
Generate the diff package and dispatch the quality reviewer subagent.

## Actions
1. **Prepare Review Package:** Use the `run_command` action to run the preparation script to generate the reviewer briefing and diff:
   `node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs reviewer HEAD docs/superpowers/plans/PLAN_FILE_NAME.md N`
   (Replace HEAD with current commit hash or 'HEAD', PLAN_FILE_NAME.md with the plan filename, and N with the task number. The base commit is loaded automatically).
2. **Dispatch Reviewer:** Once `.shark/sdd/task-N-review-run.md` has been written:
   * Action: Use the `invoke_subagent` action to spawn the reviewer subagent with the flat properties:
     - `type_name`: "self"
     - `role`: "Reviewer"
     - `task_file`: ".shark/sdd/task-N-review-run.md"
3. **Start Waiting:** Once dispatched:
   * Action: Use the `wait` action without `duration_seconds` (or set to `null`) to wait indefinitely.

---

**Next Step:** Once the reviewer is running, call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step2_wait.md` to wait for its completion.
