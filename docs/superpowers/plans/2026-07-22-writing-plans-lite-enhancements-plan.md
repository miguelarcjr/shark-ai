# Writing Plans Lite Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `writing-plans-lite` step files (`step4_draft.md` and `step5_write.md`) to enforce dynamic task sizing, strict no-placeholder rules, and chunked writing for plans with more than 4 tasks.

**Architecture:** Modify step 4 to remove the artificial 3-5 task limit and introduce scope-based task decomposition. Update step 5 with comprehensive quality and anti-placeholder guidelines, along with a 2-stage chunked document writing workflow for larger plans (>4 tasks).

**Tech Stack:** Markdown (Skill Definition Files)

## Global Constraints
- Must maintain 100% compatibility with `subagent-driven-development-lite` parsing (`prepare-brief.mjs`).
- Preserve existing step navigation and state block format (`<!-- PLAN STATE ... -->`).
- All rule additions must be explicit, concrete, and unambiguous.

---

### Task 1: Update Task Drafting Rules in step4_draft.md

**Files:**
- Modify: `skills/writing-plans-lite/steps/step4_draft.md`

**Interfaces:**
- Consumes: Design spec requirements for dynamic task sizing.
- Produces: Updated draft guidelines for `step4_draft.md`.

- [ ] **Step 1: Inspect current step4_draft.md file content**

Read `skills/writing-plans-lite/steps/step4_draft.md` to confirm target lines.

- [ ] **Step 2: Update step4_draft.md with dynamic task sizing and chunking prep**

Replace line 19 (`Propose a high-level list of tasks (typically 3-5 tasks).`) with rules for dynamic scope-based sizing and chunking preparation if task count > 4.

- [ ] **Step 3: Verify changes in step4_draft.md**

Verify that line 19 no longer mentions `typically 3-5 tasks` and clearly explains how tasks are sized and flagged for chunking.

- [ ] **Step 4: Commit changes**

```bash
git add skills/writing-plans-lite/steps/step4_draft.md
git commit -m "feat(writing-plans-lite): update step4_draft.md for dynamic task sizing"
```

---

### Task 2: Update Quality Rules and Add Chunked Writing in step5_write.md

**Files:**
- Modify: `skills/writing-plans-lite/steps/step5_write.md`

**Interfaces:**
- Consumes: Drafted tasks from Step 4.
- Produces: Standardized implementation plan file `docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md`.

- [ ] **Step 1: Inspect current step5_write.md file content**

Read `skills/writing-plans-lite/steps/step5_write.md` to confirm target lines.

- [ ] **Step 2: Update step5_write.md with strict anti-placeholder rules and chunked writing flow**

Enhance section 5 (No Placeholders) and add section 6 (Chunked Writing for >4 Tasks) detailing 2-stage generation for large plans, keeping equal detail depth for all tasks.

- [ ] **Step 3: Verify changes in step5_write.md**

Check `step5_write.md` to ensure all rules against `TODO`/`TBD`/simplification are explicit and the chunked writing procedure is clearly documented.

- [ ] **Step 4: Commit changes**

```bash
git add skills/writing-plans-lite/steps/step5_write.md
git commit -m "feat(writing-plans-lite): update step5_write.md with strict quality rules and chunked writing"
```
