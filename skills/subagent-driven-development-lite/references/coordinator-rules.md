# SDD Coordinator Reference Rules (Lite Version)

This file documents the durable progress tracking and detailed execution rules for the Subagent-Driven Development Lite workflow. Read this reference when preparing prompts, reviewing task status, or resolving review findings.

---

## 1. Durable Progress (The Ledger)

To prevent duplicate work due to context compaction or session resets, always track progress in a durable ledger file: `.shark/progress.md`.

### Ledger Rules:
1. **Initialize/Resume:** At startup, check if `.shark/progress.md` exists. If it exists, read it. Any tasks marked complete are already done. Resuming developers must check git commits and the ledger rather than relying on session memory.
2. **Format of the Ledger:** Maintain the ledger as a markdown list:
   ```markdown
   # Subagent-Driven Development Progress Ledger

   - [x] Task 1: Hook installation script (commits a1b2c3d..e4f5g6h, review clean)
   - [/] Task 2: Recovery modes (in progress)
   - [ ] Task 3: Error reporting
   ```
3. **Commit Handoffs:** When a task passes review, immediately update the task line in the ledger with the exact commit range and mark it complete (`[x]`). Use the same message to perform this bookkeeping.

---

## 2. Managing Implementer Statuses

When the implementer subagent reports back, handle their status according to these rules:

| Status | Definition | Action Required |
| :--- | :--- | :--- |
| **DONE** | Task complete, tests passing. | Run `scripts/review-package BASE HEAD` to generate the diff file. Then dispatch the reviewer subagent. |
| **DONE_WITH_CONCERNS** | Completed, but flagged doubts. | Read the concerns first. If they affect correctness, fix them before review. If they are informational (e.g. file size warning), proceed to review. |
| **NEEDS_CONTEXT** | Missing information to proceed. | Use `talk_with_user` to ask the user, or provide the context and re-dispatch. |
| **BLOCKED** | Unable to proceed due to tool errors, design conflict, or plan issues. | **Do not force retry.** Assess the issue:<br>1. If missing context: provide it.<br>2. If complexity issue: upgrade to a more capable model.<br>3. If too large: split the task.<br>4. If plan issue: escalate to the user. |

---

## 3. Handling Reviewer Findings

The reviewer evaluates spec compliance (✅/❌/⚠️) and code quality (Critical/Important/Minor).

### Resolution Rules:
- **Spec Compliant (✅) & Quality Approved:** Mark task complete in `.shark/progress.md`.
- **Reviewer ⚠️ Items (Cannot verify from diff):** The reviewer lacks cross-task context. Check these items yourself. If they are actual gaps, treat as failed review (re-dispatch implementer to fix). If clean, document your analysis and proceed.
- **Critical / Important Findings:** Send the task back to the implementer for a fix. Re-run reviewer after the fix is reported.
- **Minor Findings:** Record minor findings in the progress ledger `.shark/progress.md` as "deferred items" or "known polish items". The final whole-branch reviewer will triage these before merge. Do not block task completion for Minor findings.

---

## 4. File-Based Handoffs (Zero Context Bloat)

To keep the coordinator's context clean and prevent token inflation, pass all documents as file paths.

1. **Task Briefs:** Use `scripts/task-brief PLAN_FILE N` to extract the task description to a temporary file (e.g. `.shark/sdd/task-N-brief.md`). Reference this path in the implementer's prompt instead of pasting the requirements text.
2. **Review Packages:** Use `scripts/review-package BASE HEAD` to write the commits, stat summary, and full diff with context to a temporary file (e.g. `.shark/sdd/review-X..Y.diff`). Pass this path to the reviewer instead of pasting diffs.
3. **Reports:** Tell the implementer to write the full implementation report to `.shark/sdd/task-N-report.md` and only return a short summary (under 15 lines) containing Status, Commits, Test Summary, and Concerns.
