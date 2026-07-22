# Step 2/7: Clarify Constraints

## Goal
Ensure you understand the tech stack, platform constraints, and any potential dependencies.

## Actions
1. Use the `talk_with_user` action to ask the user 1 or 2 clear questions to confirm details like libraries to use, database versions, or exact project architecture constraints.
2. Keep questions concise. Prefer multiple choice options.
3. Keep the state block in the plan file as:
   ```markdown
   <!-- PLAN STATE
   - [x] 1/7 Analyze Spec
   - [/] 2/7 Clarify Constraints
   - [ ] 3/7 Map File Structure
   - [ ] 4/7 Draft Tasks
   - [ ] 5/7 Write Plan Doc
   - [ ] 6/7 Self-Review
   - [ ] 7/7 Handoff
   -->
   ```
4. Wait for the user's response. Do not transition to Step 3 until the user replies.

---

**Next Step:** Once the user replies:
1. Use the `modify_file` action on the plan file to update the state block (mark Step 2 as `[x]` and Step 3 as `[/]`).
2. Read and follow the instructions in [step3_structure.md](step3_structure.md).
