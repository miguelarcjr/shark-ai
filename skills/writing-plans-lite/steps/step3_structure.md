# Step 3/7: Map File Structure

## Goal
Map out which files will be created or modified, including test files, and define their interfaces.

## Actions
1. Use the `modify_file` action on the plan file to update the state block:
   ```markdown
   <!-- PLAN STATE
   - [x] 1/7 Analyze Spec
   - [x] 2/7 Clarify Constraints
   - [/] 3/7 Map File Structure
   - [ ] 4/7 Draft Tasks
   - [ ] 5/7 Write Plan Doc
   - [ ] 6/7 Self-Review
   - [ ] 7/7 Handoff
   -->
   ```
2. List the exact paths of the files to create/modify (e.g. `src/api/controller.ts`, `tests/api/controller.test.ts`).
3. For each file, list the interfaces/signatures it will consume or produce.
4. Use the `talk_with_user` action to ask: "Does this file structure look good to you?" and wait for their response.

---

**Next Step:** Once the user confirms:
1. Use the `modify_file` action on the plan file to update the state block (mark Step 3 as `[x]` and Step 4 as `[/]`).
2. Read and follow the instructions in [step4_draft.md](step4_draft.md).
