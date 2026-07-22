# Step 6/7: Self-Review & User Approval

## Goal
Review the plan for gaps and consistency, then present it to the user.

## Actions
1. Confirm the state block in the plan file is:
   ```markdown
   <!-- PLAN STATE
   - [x] 1/7 Analyze Spec
   - [x] 2/7 Clarify Constraints
   - [x] 3/7 Map File Structure
   - [x] 4/7 Draft Tasks
   - [x] 5/7 Write Plan Doc
   - [/] 6/7 Self-Review
   - [ ] 7/7 Handoff
   -->
   ```
2. Scan the plan for type/interface consistency across tasks and ensure all spec requirements are covered.
3. Use the `talk_with_user` action to ask the user: "Please review the implementation plan at `<path>`. Let me know if you approve or want any changes." and wait for their response.

---

**Next Step:** Once the user approves the plan:
1. Use the `modify_file` action on the plan file to update the state block (mark Step 6 as `[x]` and Step 7 as `[/]`).
2. Read and follow [step7_handoff.md](step7_handoff.md).
