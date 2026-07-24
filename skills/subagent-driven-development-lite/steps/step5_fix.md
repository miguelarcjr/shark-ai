# Step 5/5: Dispatch Fix Subagent

## Goal
Dispatch a subagent to fix the Critical or Important issues raised by the reviewer.

## Actions
1. **Prepare Fixer Briefing:** Use the `run_command` action to run the preparation script to generate the fixer briefing:
   `node .agents/skills/subagent-driven-development-lite/scripts/prepare-brief.mjs fix docs/superpowers/plans/PLAN_FILE_NAME.md N`
   (Replace PLAN_FILE_NAME.md with the plan filename, and N with the task number).
2. **Dispatch Fixer:** Once `.shark/sdd/task-N-fix-run.md` has been written:
   * Action: Use the `invoke_subagent` action to spawn a fix subagent with the flat properties:
     - `type_name`: "self"
     - `role`: "Fixer"
     - `task_file`: ".shark/sdd/task-N-fix-run.md"
   * Note: O subagente Fixer DEVE realizar alterações físicas no código-fonte utilizando as ferramentas `create_file` ou `modify_file` e executar os testes.
3. **Start Waiting:** Once dispatched:
   * Action: Use the `wait` action without `duration_seconds` (or set to `null`) to wait indefinitely.

---

**Next Step:** Once the fixer is running, call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step2_wait.md` to wait for it. Once it reports `DONE`, call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step3_review.md` to run the review package and reviewer again.
