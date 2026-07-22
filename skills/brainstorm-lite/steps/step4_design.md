# Step 4/7: Present Design

## Goal
Outline the design and get user approval.

## Actions
1. Update the state block in the design file to:
   ```markdown
   <!-- BRAINSTORM STATE
   - [x] 1/7 Explore Context
   - [x] 2/7 Clarifying Questions
   - [x] 3/7 Propose Approaches
   - [/] 4/7 Present Design
   - [ ] 5/7 Write Design Doc
   - [ ] 6/7 Review & Approve
   - [ ] 7/7 Transition to Plan
   -->
   ```
2. Outline the design of the solution: Architecture, Components, and Data Flow.
3. Focus on:
   - **Isolation:** Small, single-purpose components.
   - **YAGNI:** Keep it simple, remove unnecessary features.
   - **Patterns:** Follow existing codebase conventions.
4. Ask the user: "Do you approve this design? Let me know if you want to adjust anything."

---

**Next Step:** Once the user approves the design:
1. Update the state block in the spec file to mark Step 4 as `[x]` and Step 5 as `[/]`.
2. Read and follow the instructions in [step5_write.md](step5_write.md).
