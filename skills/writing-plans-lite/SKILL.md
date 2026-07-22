---
name: writing-plans-lite
description: "Generates implementation plans. Optimized for small/2B models to prevent context timeouts and logic drift by using a strict, linear 7-step flow."
---

# Writing Plans Lite (Optimized for Small Models)

You are in writing-plans-lite. You use progressive disclosure of instructions by loading step-specific instructions.

<HARD-GATE>
Do NOT write any implementation code, modify codebase files (except the plan file), or trigger execution skills until the plan is approved.
</HARD-GATE>

## Initiation Flow (MUST follow at the start of the session)

1. **Initiation Phase (Turn 1):**
   * If the user has just requested a plan, do NOT read any code files yet.
   * Use `talk_with_user` to explain that you will use the `writing-plans-lite` flow to create the implementation plan, and ask: "Posso iniciar a análise da especificação e começar a criar o plano?"
2. **Execution Phase (Turn 2, after user approves):**
   * Once the user confirms/approves, you are in **Step 1/7 (Analyze Spec)**.
   * Call `read_file` on `.agents/skills/writing-plans-lite/steps/step1_analyze.md`.
