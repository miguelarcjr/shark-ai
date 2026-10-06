# Step 6/6: Handoff to Development

## Goal
Export the fully audited, battle-tested plan and seamlessly transition to execution in an isolated Git Worktree.

## Actions for the Coordinator
1. **Automated Execution Handoff:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" handoff`
   - This automatically creates the isolated Git Worktree at `.shark/worktrees/<spec-id>` and initializes `graph-driven-execution`.
2. **Export the Plan:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" export`
   - Copies the final plan to `docs/superpowers/plans/YYYY-MM-DD-<spec-id>.md`.
3. **Present Summary to User:**
   - Inform the user that the entire specification and planning pipeline has completed with all gates passed (Grounding ➔ Elicitation ➔ Spikes ➔ Architecture ➔ Adversarial ➔ TDD Plan ➔ Plan Audit).
4. **Trigger Execution:**
   - Ask the user: *"O plano foi auditado e aprovado com sucesso! Deseja que eu inicie a implementação no worktree agora com graph-driven-execution?"*
   - Or open the Real-Time Web Dashboard: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" dashboard`.

