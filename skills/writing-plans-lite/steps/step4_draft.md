# Step 4/7: Draft Tasks

## Goal
Outline the implementation plan tasks following TDD and modularity.

## Actions
1. Use the `modify_file` action on the plan file to update the state block:
   ```markdown
   <!-- PLAN STATE
   - [x] 1/7 Analyze Spec
   - [x] 2/7 Clarify Constraints
   - [x] 3/7 Map File Structure
   - [/] 4/7 Draft Tasks
   - [ ] 5/7 Write Plan Doc
   - [ ] 6/7 Self-Review
   - [ ] 7/7 Handoff
   -->
   ```
2. Propose a high-level list of tasks (typically 3-5 tasks).
3. Ensure each task structure is ready to follow TDD:
   - Write failing test.
   - Run and verify failure.
   - Write minimal implementation.
   - Run and verify pass.
   - Commit.
4. Use the `talk_with_user` action to ask if the proposed tasks make sense and wait for their response.

---

**Next Step:** Once the user confirms:
1. Use the `modify_file` action on the plan file to update the state block (mark Step 4 as `[x]` and Step 5 as `[/]`).
2. Read and follow the instructions in [step5_write.md](step5_write.md).
