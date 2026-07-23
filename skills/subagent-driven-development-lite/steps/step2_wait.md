# Step 2/5: Monitor & Wait

## Goal
Monitor the active subagent and handle any questions it asks.

## Actions
1. **Handle Questions:** If the running subagent asks a question in its status:
   * Action: Use the `send_message` action to reply with the required answer or context.
2. **Keep Waiting:** If the subagent is still running and has not finished:
   * Action: Use the `wait` action without `duration_seconds` (or set to `null`) to wait indefinitely until a notification arrives.
3. **If Subagent Finished:**
   * **If Implementer OR Fixer finished** with status `DONE` or `DONE_WITH_CONCERNS`: Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step3_review.md` to generate the diff and review the changes.
   * **If Reviewer finished** with `Approved` (Spec ✅ and Quality Approved): Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step4_complete.md`.
   * **If Reviewer finished** with `Needs fixes` (Critical/Important findings found): Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step5_fix.md`.
