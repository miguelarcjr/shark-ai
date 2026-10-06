# Step 1/5: Elicitation & Requirements (Node 1)

## Goal
Establish the problem space, scope boundaries, and acceptance criteria through collaborative dialogue.

## Actions for the Coordinator
1. **Initialize Spec (if not already initialized):**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" init <spec-id> --title "<Feature Title>"`
2. **Generate Analyst Briefing:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" brief analyst`
3. **Dispatch Product Analyst:**
   - Use `invoke_subagent` with:
     - `role`: "Product Analyst"
     - `task_file`: `.shark/specs/<spec-id>/briefs/analyst-brief.md`
4. **Interactive Dialogue Phase:**
   - The Analyst will engage with the user via `talk_with_user`, asking questions one by one and proposing 2-3 approaches with trade-offs.
   - Wait until the Analyst has completed the user dialogue and saved `.shark/specs/<spec-id>/artifacts/brief.md`.
5. **Validate Gate & Align:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" validate`
6. **Transition:**
   - Run: `node "${SHARK_SKILL_DIR}/scripts/spec-ctl.mjs" transition --next`
   - Proceed to `step2_architect.md`.
