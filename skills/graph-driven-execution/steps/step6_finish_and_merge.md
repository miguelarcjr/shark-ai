# Step 6: Full Suite Verification & Clean Merge Handoff

## Goal
Verify that the full test suite and production build pass across the entire repository before safely merging or creating a Pull Request.

## 🛑 MANDATORY HUMAN-IN-THE-LOOP INTEGRATION RULE
**CRITICAL:** You MUST NOT call `complete_task` directly upon reaching this step or after running tests!
As an AI pair-programmer, you do NOT own the repository's git history. You MUST proactively use `talk_with_user` to present the completion report and ask the user how they want to integrate the changes before completing the task.

## Actions for the Coordinator
1. **Run Verification:**
   - Execute `npm test` in the worktree to ensure 100% green tests.
2. **Present Structured Integration Options to the User via `talk_with_user`:**
   - Report summary of completed tasks, commits, and test results.
   - Present the 3 integration options:
     - **Option 1 (Direct Merge):** Merge `feat/<spec-id>` into base branch (`main`) and delete the worktree cleanly:
       `node skills/graph-driven-execution/scripts/exec-ctl.mjs finish --merge`
     - **Option 2 (PR / Keep Branch):** Keep branch `feat/<spec-id>` intact for manual review or opening a PR:
       `node skills/graph-driven-execution/scripts/exec-ctl.mjs finish`
     - **Option 3 (Discard):** Discard worktree and changes if not accepted.
3. **Execute Chosen Action:**
   - Only execute the merge or finalize after receiving the user's explicit instructions.
4. **Final Closure:**
   - Only after step 3 is resolved, call `complete_task`.

