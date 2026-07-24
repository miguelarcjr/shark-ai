# SDD-Lite Reviewer Zero-Turn Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `subagent-driven-development-lite` reviewer briefing generation to inject both the Implementer's report and the Git diff directly into the Revisor's briefing file, update the reviewer prompt template with a strict hard-gate, and authorize reading codebase files for cross-cutting risks.

**Architecture:** Modify `prepare-brief.mjs` in `reviewer` mode to extract the Implementer report content and the `git diff -U10` output, replacing `[IMPLEMENTER_REPORT_CONTENT]` and `[DIFF_CONTENT]` placeholders in the briefing file. Update `task-reviewer-prompt.md` with `<HARD-GATE>` constraints and explicit codebase read permissions.

**Tech Stack:** Node.js (ESM), Git CLI, Markdown templates.

## Global Constraints

- Preserve backwards compatibility with `subagents.json` fallback recovery.
- Use native `create_file` action format for file writes.
- Maintain zero-dependency Node.js script design in `prepare-brief.mjs`.

---

### Task 1: Update `prepare-brief.mjs` to Implement Dual-Injection in Reviewer Mode

**Files:**
- Modify: `skills/subagent-driven-development-lite/scripts/prepare-brief.mjs:254-340`

**Interfaces:**
- Consumes: `.shark/sdd/task-subagent-[IMPLEMENTER_ID]-report.md` or `.shark/subagents.json`
- Produces: `.shark/sdd/task-subagent-[REVIEWER_ID]-review-brief.md` containing embedded Implementer report and Git diff.

- [ ] **Step 1: Locate reviewer mode logic in `prepare-brief.mjs`**

Read `skills/subagent-driven-development-lite/scripts/prepare-brief.mjs` around line 254 to inspect current report reading and diff creation.

- [ ] **Step 2: Add Implementer report content extraction and Git diff string embedding**

In `prepare-brief.mjs` (reviewer mode), extract the implementer report text using `getLatestSubagentReportContent('Implementer')` or direct file read, format it into `[IMPLEMENTER_REPORT_CONTENT]`, format the git diff output into `[DIFF_CONTENT]`, and replace both placeholders in the template text before writing `runBriefFile`.

- [ ] **Step 3: Run dry-run verification node script**

Run: `node skills/subagent-driven-development-lite/scripts/prepare-brief.mjs reviewer` with mock arguments or syntax check.
Expected: No syntax errors.

- [ ] **Step 4: Commit Task 1 changes**

```bash
git add skills/subagent-driven-development-lite/scripts/prepare-brief.mjs
git commit -m "feat(sdd-lite): inject implementer report and diff into reviewer brief"
```

---

### Task 2: Update `task-reviewer-prompt.md` with Hard-Gate and Codebase Read Guidelines

**Files:**
- Modify: `skills/subagent-driven-development-lite/task-reviewer-prompt.md:20-60`

**Interfaces:**
- Consumes: Placeholders `[IMPLEMENTER_REPORT_CONTENT]` and `[DIFF_CONTENT]`
- Produces: Updated reviewer prompt template with strict Hard-Gate and explicit codebase read guidelines.

- [ ] **Step 1: Add `<HARD-GATE>` block to `task-reviewer-prompt.md`**

In `task-reviewer-prompt.md`, insert:
```markdown
<HARD-GATE>
É estritamente PROIBIDO gerar relatórios de revisão sem inspecionar o diff e o relatório do implementador contidos nesta instrução.
</HARD-GATE>
```

- [ ] **Step 2: Add embedded placeholders and codebase read authorization**

Update the prompt template to show the embedded `[IMPLEMENTER_REPORT_CONTENT]` and `[DIFF_CONTENT]` sections, and add explicit instructions permitting the use of `read_file` on codebase files when:
1. A diff hunk is cut off mid-function/class.
2. Evaluating concrete cross-cutting risks (modified API contracts, shared state, or exported interfaces).

- [ ] **Step 3: Commit Task 2 changes**

```bash
git add skills/subagent-driven-development-lite/task-reviewer-prompt.md
git commit -m "docs(sdd-lite): update reviewer prompt template with hard-gate and codebase read guidelines"
```

---

### Task 3: Dry-Run Briefing Compilation & Build Verification

**Files:**
- Verify: `skills/subagent-driven-development-lite/`

- [ ] **Step 1: Test dry-run compilation of reviewer brief**

Run: `node skills/subagent-driven-development-lite/scripts/prepare-brief.mjs reviewer HEAD~1 HEAD docs/superpowers/plans/2026-07-23-sdd-lite-improvement-plan.md 1` (or dry-run test command).
Expected: Briefing file compiled successfully with embedded report and diff content.

- [ ] **Step 2: Execute project build**

Run: `npm run build`
Expected: Build success with zero errors.

- [ ] **Step 3: Commit final task verification**

```bash
git add .
git commit -m "chore(sdd-lite): verify reviewer zero-turn enhancements build"
```
