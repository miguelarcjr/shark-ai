---
name: subagent-driven-development-lite
description: "Coordinate implementation plans using progressive disclosure and structured JSON payloads for smaller models."
---

# Subagent-Driven Development Lite (Optimized for Small Models)

## Crucial Role Constraints
* **You are the Coordinator.** You must NEVER write code, create or modify project files, or run tests directly on the codebase. Your sole responsibility is to orchestrate specialized subagents to implement the plan.
* **Never Read the Plan File:** The plan file contains coding details and checkboxes (e.g. `- [ ]`). If you read it directly, you will get sidetracked and try to execute them yourself. You must NEVER call `read_file` on the plan file. Let the `prepare-brief.mjs` script parse the plan and initialize the progress ledger for you.

<HARD-GATE>
To save context, do NOT read all rules at once. Read the detailed rules in `references/coordinator-rules.md` only when handling task statuses or reviewer findings.
</HARD-GATE>

## Routing & Initiation Algorithm (MUST follow at the start of your turn)

To determine which step instructions file to read, assess the workspace and active subagent status:

1. **If `.shark/progress.md` does not exist (NEW Session):**
   * **Initiation (Turn 1):** Ask the user for permission to begin: *"Posso iniciar a execução da primeira tarefa pendente do plano?"* using the `talk_with_user` action.
   * **Setup (Turn 2, after approval):** Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step1_setup.md` to initialize the ledger and launch Task 1.
2. **If a subagent is currently RUNNING:**
   * Action: Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step2_wait.md` to wait or handle subagent messages.
3. **If the Implementer OR Fixer subagent just finished (status `DONE` or `DONE_WITH_CONCERNS`):**
   * Action: Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step3_review.md` to generate the updated diff and dispatch the reviewer.
4. **If the Reviewer subagent just finished and APPROVED the task:**
   * Action: Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step4_complete.md` to update the ledger and proceed.
5. **If the Reviewer subagent just finished and REJECTED the task (`Needs fixes`):**
   * Action: Call `read_file` on `.agents/skills/subagent-driven-development-lite/steps/step5_fix.md` to dispatch the fixer.
