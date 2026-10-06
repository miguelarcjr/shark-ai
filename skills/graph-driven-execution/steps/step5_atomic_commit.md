# Step 5: Atomic Git Commit & Working Tree Cleanliness

## Goal
Record a clean, conventional commit in the worktree branch and verify that zero untracked or temporary files remain.

## Actions for the Coordinator
1. **Execute Commit Gate:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs transition --next`
   - The CLI stages changed files, creates a conventional commit with the task title, captures the commit hash in `execution.json`, and verifies `git status` cleanliness.
2. **Next Action:**
   - **If more tasks remain:** The CLI automatically advances to the next task at `RED_TEST`. Follow `step1_red_test.md`.
   - **If all tasks are finished:** The CLI advances to `READY_FOR_MERGE`. Proceed to `step6_finish_and_merge.md`.
