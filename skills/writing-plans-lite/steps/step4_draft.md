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
2. **Propose Task List (Scope-Based Dynamic Sizing):**
   - Propose a list of tasks where each task represents an independent, testable deliverable with its own TDD cycle.
   - Do NOT artificially restrict the plan to "3-5 tasks". Create as many tasks as needed so that no task becomes a broad, vague "catch-all" or groups multiple subsystems together.
   - If the total task count exceeds 4 tasks, note that Step 5 will use a 2-stage chunked writing flow (Tasks 1-3 first, then Tasks 4+).
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
