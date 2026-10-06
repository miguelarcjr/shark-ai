# Step 3/5: Adversarial Review & Resilience (Node 3)

## Goal
Subject the architecture design to critical scrutiny, hunting for edge cases, performance bottlenecks, and breaking changes.

## Actions for the Coordinator
1. **Generate Reviewer Briefing:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" brief reviewer`
2. **Dispatch Red Team Reviewer:**
   - Use `invoke_subagent` with:
     - `role`: "Red Team Reviewer"
     - `task_file`: `.shark/specs/<spec-id>/briefs/reviewer-brief.md`
3. **Handle Verdict Gate:**
   - Once `.shark/specs/<spec-id>/artifacts/critique.md` is generated, run:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" validate`
   - **Case A: Score < 7.0 (`VERDICT: BLOCKER`)**
     - O design possui falhas críticas ou incompatibilidades fatais.
     - You MUST perform a rollback to give the Architect another design iteration:
       `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" rollback --to TECHNICAL_ARCHITECTURE --reason "<summary of blockers>"`
     - Return to `step2_architect.md`.
   - **Case B: Score 7.0 a 8.9 (`VERDICT: PASS WITH WARNINGS`)**
     - O design é aprovado **SEM ROLLBACK**! Ressalvas não-bloqueantes (`- [WARN-xx]`) são salvas no estado e injetadas no briefing do planejador.
     - Advance the graph:
       `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" transition --next`
     - Proceed to `step4_plan.md`.
   - **Case C: Score 9.0 a 10.0 (`VERDICT: PASS`)**
     - Design excelente e aprovado integralmente.
     - Advance the graph:
       `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" transition --next`
     - Proceed to `step4_plan.md`.
