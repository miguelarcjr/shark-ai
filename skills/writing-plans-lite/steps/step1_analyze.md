# Step 1/7: Analyze Spec

## Goal
Read the active design spec doc from `docs/superpowers/specs/` to understand the features to be planned.

## Actions
1. Use the `read_file` action to read the design spec file (e.g. `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`).
2. Use the `create_file` action to create the plan document file `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. **State Machine Header:** Write this exact header at the top of the new plan document:
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
4. Output a summary of the spec details you read, and state that you are ready for Step 2.

---

**Next Step:** Once this step is completed (the plan file is created with Step 2 marked as `[/]`), the next file to read is [step2_clarify.md](step2_clarify.md).
