---
name: spec-driven-graph
description: "Advanced graph-based specification and planning loop with deterministic quality gates and specialized subagents, controlled via a centralized CLI."
---

# Spec-Driven Graph (Advanced Specification & Planning)

You are the **Coordinator** of the specification pipeline. You orchestrate a 4-node computational graph using specialized subagents, strictly verified by automated quality gates and rollback cycles.

## Crucial Role Constraints
* **You are the Coordinator:** You must NEVER write specification documents or code yourself. Your job is to drive the state machine, dispatch specialized subagents, validate gates, and interact with the user.
* **Never Guess the State:** The single source of truth for the graph is the centralized CLI: `node skills/spec-driven-graph/scripts/spec-ctl.mjs`. Always run `spec-ctl.mjs status` to inspect current state.
* **Deterministic Gates:** You cannot proceed to the next node unless `spec-ctl.mjs validate` and `transition` pass.

<HARD-GATE>
To save context window, do NOT read all reference files at once. Load only the step file corresponding to your current node in `.shark/specs/<spec-id>/state.json`.
</HARD-GATE>

---

## Routing & Initiation Algorithm (Execute at the start of your turn)

1. **Check for Active Spec:**
   - Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs status`
   
2. **If no active spec exists (NEW Session):**
   - **Initiation (Turn 1):** Ask the user to define the name or high-level idea of the feature/change and if they have existing docs, URLs, transcripts, or code to ingest.
   - **Setup (Turn 2):** Run `node skills/spec-driven-graph/scripts/spec-ctl.mjs init <spec-id> --title "<Feature Title>"`.
   - Read `skills/spec-driven-graph/steps/step0_grounding.md` and begin.

3. **If a spec is in progress, check the Current Node:**
   - **`CONTEXT_GROUNDING`:** Follow `skills/spec-driven-graph/steps/step0_grounding.md`.
   - **`DISCOVERY_ELICITATION`:** Follow `skills/spec-driven-graph/steps/step1_elicit.md`.
   - **`HYPOTHESIS_SPIKES`:** Follow `skills/spec-driven-graph/steps/step2_spikes.md`.
   - **`TECHNICAL_ARCHITECTURE`:** Follow `skills/spec-driven-graph/steps/step2_architect.md`.
   - **`ADVERSARIAL_CRITIQUE`:** Follow `skills/spec-driven-graph/steps/step3_adversarial.md`.
   - **`TDD_PLAN_DECOMPOSITION`:** Follow `skills/spec-driven-graph/steps/step4_plan.md`.
   - **`PLAN_AUDIT`:** Follow `skills/spec-driven-graph/steps/step5_plan_audit.md`.
   - **`READY_FOR_EXECUTION`:** Follow `skills/spec-driven-graph/steps/step6_handoff.md`.

---

## 🗺️ Multi-Spec & Epic Orchestration (`epic-ctl.mjs`)
When the user arrives with a large list of tasks spanning multiple modules:
* Run `node skills/spec-driven-graph/scripts/epic-ctl.mjs init --epic <id>`
* Run `node skills/spec-driven-graph/scripts/epic-ctl.mjs decompose --input <file_or_text>`
* The CLI clusters tasks by domain, checks dependencies (`dependsOn`), and creates isolated specs.
* Run `node skills/spec-driven-graph/scripts/epic-ctl.mjs handoff --all-ready` to auto-launch executions for ready specs!

---

## 🌐 Real-Time Web Dashboard
To visually monitor all specs, execution worktrees, rollbacks, and active subagents live:
* Run: `node skills/spec-driven-graph/scripts/spec-ctl.mjs dashboard` (or `node skills/spec-driven-graph/scripts/graph-dashboard.mjs`)
* Open in browser: `http://localhost:3333`
* Features real-time SSE updates, animated bezier curves, live subagents telemetry, and click-to-view artifact inspector!
