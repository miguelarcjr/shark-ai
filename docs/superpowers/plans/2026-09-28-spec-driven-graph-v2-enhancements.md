# Spec-Driven Graph v2 Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the `spec-driven-graph` pipeline with 4 production-grade capabilities: Multi-source Context Grounding (Node 0), Empirical Hypothesis Spikes, Reviewer Severity Classification, and a Human Circuit Breaker for runaway rollbacks.

**Architecture:** Extend the deterministic state machine in `spec-ctl.mjs` and documentation steps. Add nodes `CONTEXT_GROUNDING` (Node 0) and `HYPOTHESIS_SPIKES`, add `source` and `hypothesis` CLI subcommands, introduce smart defaults and circuit-breaker triggers in `rollback`, and support `PASS WITH WARNINGS` without triggering rollbacks.

**Tech Stack:** Node.js (ESM), JavaScript (`.mjs`), Markdown documentation, Vitest / Node test runner.

## Global Constraints

- Must maintain 100% backward compatibility with existing spec state files in `.shark/specs/`.
- The CLI `spec-ctl.mjs` must remain standalone with zero external npm runtime dependencies (uses native `node:fs`, `node:path`, `node:crypto`).
- All changes must be replicated across the three mirrors: `skills/spec-driven-graph/`, `.agent/skills/spec-driven-graph/`, and `test-sandbox/skills/spec-driven-graph/`.
- Automated test scripts must verify every CLI command without hanging or requiring interactive input.

---

### Task 1: Reviewer Severity Classification (`PASS`, `PASS WITH WARNINGS`, `BLOCKER`)

**Files:**
- Modify: `skills/spec-driven-graph/scripts/spec-ctl.mjs`
- Modify: `skills/spec-driven-graph/references/gate-criteria.md`
- Modify: `skills/spec-driven-graph/references/subagent-prompts.md`
- Test: `test-sandbox/test-severity-gate.mjs`

**Interfaces:**
- Consumes: `.shark/specs/<id>/artifacts/critique.md`
- Produces: `runValidation` accepts `VERDICT: PASS WITH WARNINGS`, saves extracted warnings to `state.auditWarnings`, and `cmdBrief('planner')` includes them as non-blocking guidance.

- [x] **Step 1: Write test for Severity Classification in CLI**
Create `test-sandbox/test-severity-gate.mjs` asserting that:
- `critique.md` with `VERDICT: PASS WITH WARNINGS\n- [WARN] Consider max integer guard` passes `node spec-ctl.mjs validate`.
- `spec-ctl.mjs brief planner` contains the warning section extracted from critique.
- `critique.md` with `VERDICT: BLOCKER: <reason>` fails validate and blocks transition.

- [x] **Step 2: Run test to confirm failure**
Run `node test-sandbox/test-severity-gate.mjs` and verify it fails on the current `spec-ctl.mjs`.

- [x] **Step 3: Implement Severity Classification in `spec-ctl.mjs`**
Update `runValidation`:
- Detect `VERDICT: PASS`, `VERDICT: PASS WITH WARNINGS`, or `VERDICT: BLOCKER`.
- Extract text after `VERDICT: PASS WITH WARNINGS` into `result.warnings`.
- In `cmdBrief` for `planner`, append `## ⚠️ Reviewer Warnings & Non-Blocking Observations` when present.
Update `gate-criteria.md` and `subagent-prompts.md` to document the 3 verdict tiers.

- [x] **Step 4: Verify test passes**
Run `node test-sandbox/test-severity-gate.mjs` and confirm all assertions pass.

- [x] **Step 5: Commit changes**
Completed Task 1 changes.

---

### Task 2: Human Circuit Breaker & Smart Default Rollback

**Files:**
- Modify: `skills/spec-driven-graph/scripts/spec-ctl.mjs`
- Test: `test-sandbox/test-circuit-breaker.mjs`

**Interfaces:**
- Consumes: `spec-ctl rollback [--to <node>] --reason "<text>"`, `spec-ctl intervene --decision "<text>"`
- Produces: Automatic fallback to `NODES[fromNode].prev` if `--to` is omitted; triggers `CIRCUIT_BREAKER_TRIGGERED` state when `rollbacksCount >= 5`, requiring `spec-ctl intervene` to unblock.

- [x] **Step 1: Write test for Smart Rollback & Circuit Breaker**
Create `test-sandbox/test-circuit-breaker.mjs` asserting that:
- Running `node spec-ctl.mjs rollback --reason "test"` without `--to` automatically rolls back to the previous node.
- After 5 rollbacks, `spec-ctl.mjs status` displays `CIRCUIT BREAKER TRIGGERED` and `transition` is blocked.
- Running `node spec-ctl.mjs intervene --decision "Use Math.round with EPSILON"` records the human resolution, resets the breaker, and allows execution to continue.

- [x] **Step 2: Run test to confirm failure**
Run `node test-sandbox/test-circuit-breaker.mjs` and verify failure.

- [x] **Step 3: Implement Circuit Breaker and Smart Rollback in `spec-ctl.mjs`**
- In `cmdRollback`:
  - If `!targetNode`, fallback to `NODES[fromNode]?.prev`.
  - Increment `state.rollbacksCount`.
  - If `state.rollbacksCount >= 5`:
    - Set `state.status = 'CIRCUIT_BREAKER_TRIGGERED'`.
    - Print clear intervention alert.
- In `cmdTransition`:
  - If `state.status === 'CIRCUIT_BREAKER_TRIGGERED'`, block with error explaining that human intervention is required via `intervene`.
- Implement `cmdIntervene(specId, decision)`:
  - Validates active circuit breaker.
  - Appends human decision to `state.history` and `feedback-history.json`.
  - Resets `state.status = 'IN_PROGRESS'`.

- [x] **Step 4: Verify test passes**
Run `node test-sandbox/test-circuit-breaker.mjs` and verify all checks pass.

- [x] **Step 5: Commit changes**
Completed Task 2 changes.

---

### Task 3: Empirical Spikes & Hypothesis Governance (`HYPOTHESIS_SPIKES`)

**Files:**
- Modify: `skills/spec-driven-graph/scripts/spec-ctl.mjs`
- Modify: `skills/spec-driven-graph/references/gate-criteria.md`
- Modify: `skills/spec-driven-graph/references/subagent-prompts.md`
- Create: `skills/spec-driven-graph/steps/step2_spikes.md`
- Test: `test-sandbox/test-spikes-flow.mjs`

**Interfaces:**
- Consumes: CLI commands `hypothesis add`, `hypothesis resolve`, `brief spike-tester`
- Produces: Topology includes `HYPOTHESIS_SPIKES` node; outputs `.shark/specs/<id>/artifacts/spikes.md`.

- [x] **Step 1: Write test for Hypothesis Spikes**
Create `test-sandbox/test-spikes-flow.mjs` asserting:
- `node spec-ctl.mjs hypothesis add <id> --hId H1 --statement "EPSILON solves 100.005"` records hypothesis with `status: PENDING`.
- `validate` on `HYPOTHESIS_SPIKES` fails while any hypothesis is `PENDING`.
- `node spec-ctl.mjs hypothesis resolve <id> --hId H1 --status CONFIRMED --evidence "100.005 -> 120.01"` resolves it.
- When all are resolved and `artifacts/spikes.md` exists, `validate` passes and advances to `TECHNICAL_ARCHITECTURE`.
- `brief architect` automatically includes the confirmed spikes table as required background.

- [x] **Step 2: Run test to confirm failure**
Run `node test-sandbox/test-spikes-flow.mjs` and confirm failure.

- [x] **Step 3: Implement Hypothesis Governance in `spec-ctl.mjs`**
- Add `HYPOTHESIS_SPIKES` node to `NODES` (between `DISCOVERY_ELICITATION` and `TECHNICAL_ARCHITECTURE`).
- Add `cmdHypothesisAdd`, `cmdHypothesisResolve`.
- Add role `spike-tester` in `cmdBrief`.
- Update `cmdBrief('architect')` to inject resolved hypotheses from `state.hypotheses` and `artifacts/spikes.md`.
- Create `skills/spec-driven-graph/steps/step2_spikes.md`.

- [x] **Step 4: Verify test passes**
Run `node test-sandbox/test-spikes-flow.mjs` and verify pass.

- [x] **Step 5: Commit changes**
Completed Task 3 changes.

---

### Task 4: Multi-Source Grounding & Pre-Elicitation Intake (`CONTEXT_GROUNDING`)

**Files:**
- Modify: `skills/spec-driven-graph/scripts/spec-ctl.mjs`
- Create: `skills/spec-driven-graph/steps/step0_grounding.md`
- Modify: `skills/spec-driven-graph/references/gate-criteria.md`
- Modify: `skills/spec-driven-graph/references/subagent-prompts.md`
- Test: `test-sandbox/test-grounding-flow.mjs`

**Interfaces:**
- Consumes: `node spec-ctl.mjs source add <id> --type <transcript|url|code|doc> --origin <path_or_url>`
- Produces: `NODES.CONTEXT_GROUNDING` (Node 0), role `researcher`, generating `artifacts/context-pack.md`; `brief analyst` consumes `context-pack.md` to focus interviews on contradictions and gaps.

- [x] **Step 1: Write test for Context Grounding**
Create `test-sandbox/test-grounding-flow.mjs` asserting:
- `spec-ctl.mjs source add <id> --type transcript --origin "meeting.txt"` saves source in `state.groundingSources`.
- `spec-ctl.mjs brief researcher` creates briefing for multi-source distillation.
- `spec-ctl.mjs validate` checks `artifacts/context-pack.md` for `# Context Pack`, `## 1. Regras de Negócio`, and `## 2. Matriz de Conflitos`.
- `spec-ctl.mjs brief analyst` extracts and includes conflict items (`CONF-xx`) so the analyst interviews with laser focus.

- [x] **Step 2: Run test to confirm failure**
Run `node test-sandbox/test-grounding-flow.mjs` and verify failure.

- [x] **Step 3: Implement Context Grounding in `spec-ctl.mjs`**
- Add `CONTEXT_GROUNDING` as Node 0 in `NODES` (optional/skipable if no sources provided).
- Implement `cmdSourceAdd(specId, type, origin)`.
- Implement `researcher` role briefing in `cmdBrief`.
- Update `analyst` brief to parse `context-pack.md` conflicts if present.
- Create `skills/spec-driven-graph/steps/step0_grounding.md`.

- [x] **Step 4: Verify test passes**
Run `node test-sandbox/test-grounding-flow.mjs` and verify pass.

- [x] **Step 5: Commit changes**
Completed Task 4 changes.

---

### Task 5: End-to-End Verification & 3-Way Mirror Synchronization

**Files:**
- Sync: Copy `skills/spec-driven-graph/` to `.agent/skills/spec-driven-graph/` and `test-sandbox/skills/spec-driven-graph/`
- Test: `test-sandbox/test-e2e-v2-graph.mjs`

**Interfaces:**
- Consumes: Entire v2 pipeline
- Produces: Complete end-to-end integration test passing, identical file hashes across all 3 directories.

- [x] **Step 1: Write End-to-End integration test**
Create `test-sandbox/test-e2e-v2-graph.mjs` executing a mock spec through all nodes:
`init` ➔ `source add` ➔ `brief researcher` ➔ `validate (context-pack)` ➔ `transition` ➔ `hypothesis add/resolve` ➔ `validate (spikes)` ➔ `transition` ➔ `brief architect` ➔ `validate (design)` ➔ `transition` ➔ `critique (PASS WITH WARNINGS)` ➔ `validate` ➔ `transition` ➔ `brief planner` ➔ `validate (plan)` ➔ `transition` ➔ `export`.

- [x] **Step 2: Run End-to-End test**
Execute `node test-sandbox/test-e2e-v2-graph.mjs` and confirm smooth zero-error execution.

- [x] **Step 3: Synchronize mirrors**
Copy updated files to `.agent/skills/spec-driven-graph/` and `test-sandbox/skills/spec-driven-graph/`. Verify file hashes match 100%.

- [x] **Step 4: Final verification and commit**
Completed all verification and mirror synchronization.
