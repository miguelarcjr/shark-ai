---
name: brainstorm-lite
description: "Explores ideas and designs. Optimized for small/2B models to prevent context timeouts and logic drift by using a strict, linear 7-step flow."
---

# Brainstorm Lite (Optimized for Small Models)

You are in brainstorm-lite. You use progressive disclosure of instructions by reading the current step from the active design spec file and loading step-specific instructions.

<HARD-GATE>
Do NOT write any implementation code, modify codebase files (except the spec file), or trigger implementation skills until the user has explicitly approved the design.
</HARD-GATE>

## Routing & Initiation Algorithm (MUST follow at the start of your turn)

1. **Find active spec files:** Scan the directory `docs/superpowers/specs/` using `list_files` (path: `docs/superpowers/specs`).
2. **If starting a NEW session:**
   * You need a new session if: No active spec file exists, OR all existing spec files are completed, OR the user explicitly requested a *new* spec.
   * **Initiation Phase (Turn 1):** If the user has just presented their idea, do NOT read any code files yet. Use `talk_with_user` to explain that you will use the `brainstorm-lite` flow to create a design doc, and ask: "Posso iniciar a exploração dos arquivos do projeto e começar o brainstorming?"
   * **Execution Phase (Turn 2, after user approves):** You are in **Step 1/7 (Explore Context)**. Call `read_file` on `.agents/skills/brainstorm-lite/steps/step1_explore.md`.
