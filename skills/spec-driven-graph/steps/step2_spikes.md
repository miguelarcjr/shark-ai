# Step 2: Empirical Spikes & Hypothesis Verification (Node: HYPOTHESIS_SPIKES)

## Goal
Empirically validate risky technical assumptions, performance boundaries, library behavior, or edge cases before architectural commitments are made.

## Actions for the Coordinator
1. **Inspect Pending Hypotheses:**
   - Check current hypotheses status:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" status`
2. **Register Hypotheses (if identified during Elicitation):**
   - Run:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" hypothesis add --statement "<empirical question or assumption>"`
   - If no technical risks or uncertain assumptions exist, the gate will automatically seed an empty `spikes.md` with zero hypotheses.
3. **Generate Spike Tester Briefing:**
   - Run:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" brief spike-tester`
4. **Dispatch Spike Tester:**
   - Use `invoke_subagent` with:
     - `role`: "Spike Tester"
     - `task_file`: `.shark/specs/<spec-id>/briefs/spike-tester-brief.md`
   - The Spike Tester runs fast disposable scripts in `test-sandbox/` to test behavior against Node.js runtime, native libraries, or external APIs, and creates `.shark/specs/<spec-id>/artifacts/spikes.md`.
5. **Resolve Registered Hypotheses:**
   - For each hypothesis in the state, run:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" hypothesis resolve --hId <id> --status <CONFIRMED|REFUTED> --evidence "<summary of spike result>"`
6. **Validate Gate:**
   - Run:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" validate`
   - Confirms all hypotheses are resolved (`CONFIRMED` or `REFUTED`) and `spikes.md` contains `# Empirical Spikes`, `# Hypotheses Evaluation`, and `# Findings`.
7. **Transition to Architecture:**
   - Advance the state:
     `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" transition --next`
   - Proceed to the technical architecture step.
