# Step 6/7: Review & Approve

## Goal
Get the user's final review and approval on the written spec.

## Actions
1. Confirm the state block in the design file is:
   ```markdown
   <!-- BRAINSTORM STATE
   - [x] 1/7 Explore Context
   - [x] 2/7 Clarifying Questions
   - [x] 3/7 Propose Approaches
   - [x] 4/7 Present Design
   - [x] 5/7 Write Design Doc
   - [/] 6/7 Review & Approve
   - [ ] 7/7 Transition to Plan
   -->
   ```
2. Ask the user: "Please review the design document at `<path>`. Let me know if you want any changes or if I should proceed to write the implementation plan."
3. Wait for the user's response. Do not transition to Step 7 until the user approves.

---

**Next Step:** Once the user approves the spec document:
1. Update the state block in the spec file to mark Step 6 as `[x]` and Step 7 as `[/]`.
2. Read and follow the instructions in [step7_transition.md](step7_transition.md).
