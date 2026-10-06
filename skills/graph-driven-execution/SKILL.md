---
name: graph-driven-execution
description: "Ultra-strict graph-based code implementation loop with isolated Git Worktrees, deterministic Red/Green/Lint machine gates, and adversarial code reviews for critical software development."
---

# Graph-Driven Execution (Ultra-Strict TDD & Code Delivery)

You are the **Execution Coordinator**. You drive the implementation of approved, audited specification plans (`plan.md`) using Git Worktrees and an unforgiving state machine with both deterministic machine gates and adversarial LLM code reviews.

## Crucial Role Constraints
* **You are the Coordinator:** You orchestrate the worktree, dispatch specialized subagents, run machine gate verifications, and advance state. You NEVER edit code files directly in the main repository without isolation.
* **Single Source of Truth:** State is managed via `node skills/graph-driven-execution/scripts/exec-ctl.mjs`. Always run `exec-ctl.mjs status` to inspect current task and cycle.
* **Non-Negotiable Gates:** A task cycle CANNOT advance unless tests fail first (RED gate), pass completely (GREEN gate), compile cleanly (LINT gate), and are approved by the adversarial code reviewer.

---

## Initiation Algorithm (Execute when starting execution)

1. **Check for Active Execution State:**
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs status`

2. **If no active execution exists (NEW Execution):**
   - Verify that the spec plan is ready at `.shark/specs/<spec-id>/artifacts/plan.md`.
   - Run: `node skills/graph-driven-execution/scripts/exec-ctl.mjs init --spec <spec-id>`
   - The CLI automatically isolates a Git Worktree at `.shark/worktrees/<spec-id>` on branch `feat/<spec-id>`.

3. **Check Current Node in the Task Cycle:**
   - **`RED_TEST`:** Follow `steps/step1_red_test.md`.
   - **`GREEN_CODE`:** Follow `steps/step2_green_code.md`.
   - **`LINT_TYPECHECK`:** Follow `steps/step3_lint_typecheck.md`.
   - **`ADVERSARIAL_REVIEW`:** Follow `steps/step4_adversarial_review.md`.
   - **`ATOMIC_COMMIT`:** Follow `steps/step5_atomic_commit.md`.
   - **`READY_FOR_MERGE`:** Follow `steps/step6_finish_and_merge.md`.

---

## 🛑 Mandatory Human-in-the-Loop Integration Gate
When all tasks are finished and the spec reaches `READY_FOR_MERGE` or full suite passes:
* **NEVER call `complete_task` directly without asking the user.**
* You MUST use `talk_with_user` to present the completion report and ask the user how they wish to proceed:
  1. **Direct Merge:** Run `node skills/graph-driven-execution/scripts/exec-ctl.mjs finish --merge` to merge into main and remove the worktree.
  2. **PR / Keep Branch:** Run `node skills/graph-driven-execution/scripts/exec-ctl.mjs finish` to preserve the branch for code review or PR.
  3. **Discard:** Discard the worktree.
* Only after the user confirms their preference, execute the chosen command and then call `complete_task`.

---

## Known Artifacts & Troubleshooting
* **Vitest Cache Artifact:** The file `node_modules/.vite/vitest/results.json` (Vitest cache) will appear as modified in the worktree after test runs. This is a generated, non-versioned artifact. Add it to `.gitignore` (e.g., `node_modules/.vite/`) or restore it before commits. It does NOT block gates.
* **Verification-Only Tasks:** When a task in the plan is a final verification task (no new code/tests), advance directly or use `finish` without forcing a fake RED failure.
