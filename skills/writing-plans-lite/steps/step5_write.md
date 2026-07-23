# Step 5/7: Write Plan Doc

## Goal
Write the full implementation plan using the standard format.

## Actions
1. Update the state block in the plan file: Step 4 -> `[x]`, Step 5 -> `[/]`.
2. Write the full plan below the state block in `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.
3. **Mandatory Header:** Every plan must start with:
   ```markdown
   # [Feature Name] Implementation Plan
   
   > **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development-lite (recommended) or superpowers:executing-plans-lite to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
   
   **Goal:** [One sentence goal]
   **Architecture:** [2-3 sentences]
   **Tech Stack:** [Libraries/languages]
   ```
4. **Task Structure:**
   ```markdown
   ### Task N: [Component Name]
   
   **Files:**
   - Create: `exact/path`
   - Modify: `exact/path`
   - Test: `exact/path`
   
   **Interfaces:**
   - Consumes: [Signatures]
   - Produces: [Signatures]
   
   - [ ] Step 1: Write the failing test [code block]
   - [ ] Step 2: Run test to verify failure [command and expected fail output]
   - [ ] Step 3: Write minimal implementation [code block]
   - [ ] Step 4: Run test to verify pass [command and expected pass output]
   - [ ] Step 5: Commit [git commands]
   ```
5. **No Placeholders & Equal Task Granularity:**
   - **Zero Placeholders:** Never write "TODO", "TBD", "implement later", "add error handling", or "similar to Task 1".
   - **Concrete Code & Commands:** Every step across every task must show exact file paths, complete code blocks (failing test and minimal implementation), exact execution commands, and expected PASS/FAIL output.
   - **Equal Detail Rule:** Task N must be written with the same depth and specificity as Task 1. Do NOT simplify or compress final tasks into vague summaries.
6. **Chunked Document Writing (for plans > 4 tasks):**
   - **Single Pass ($\le 4$ tasks):** Write Header + Global Constraints + All Tasks in a single `modify_file` operation.
   - **Two-Stage Chunking ($> 4$ tasks):**
     - *Stage 1:* Use `modify_file` to write Header + `## Global Constraints` + **Tasks 1 to 3**.
     - *Stage 2:* Use `modify_file` to append **Tasks 4 through N** without dropping detail or code snippets.
7. Use the `modify_file` action to update the state block to mark Step 5 as `[x]` and Step 6 as `[/]`.

---

**Next Step:** Once the plan is written and the state block is updated, read and follow [step6_review.md](step6_review.md).
