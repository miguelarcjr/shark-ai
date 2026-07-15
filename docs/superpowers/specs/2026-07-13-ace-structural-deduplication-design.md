# Design Spec: ACE Structural Deduplication & Priority RAM Allocation

## Goal Description
Enhance the **Adaptive Context Elasticizer (ACE)** framework inside `bmadspot` with two advanced memory-management layers to prevent context window bloat and resolve semantic redundancies under long-horizon execution:
1. **Priority RAM Allocation**: Treat the context token budget strictly like a physical RAM memory. Allocate slots based on a weighted priority score combining recency and semantic relevance, and drop anything (including abstracts) that exceeds the budget.
2. **Structural Deduplication Layer**: Scan history in reverse-chronological order and automatically drop stale, duplicate file reads (`read_file`) and command executions (`run_command`), retaining only their most recent instances.

This design supersedes the legacy destructive retroactive compaction (`MemboxManager`), moving all active memory management to the lossless, reversible ACE Context Orchestrator.

---

## Proposed Changes

### 1. Structural Deduplication Layer

We will implement a pre-processing step inside the orchestrator that scans the history from newest to oldest (reverse chronological order) to detect and flag redundant actions.

* **File Reads (`read_file`)**:
  * Track `seenReadFiles = new Set<string>()`.
  * If an intermediate turn contains `[Action read_file(path) Success]`:
    * If `seenReadFiles.has(path)`, mark this turn to be **Dropped** (omitted completely).
    * Else, add `path` to `seenReadFiles`.
* **Command Executions (`run_command`)**:
  * Track `seenCommands = new Set<string>()`.
  * If an intermediate turn contains `[Action run_command(cmd) Success]`:
    * If `seenCommands.has(cmd)`, mark this turn to be **Dropped** (omitted completely).
    * Else, add `cmd` to `seenCommands`.

---

### 2. Weighted Priority RAM Allocation

We will replace the current binary classification with a prioritized slot-allocation algorithm that treats the context budget as a fixed physical memory space.

* **Priority Score Calculation**:
  * For each intermediate turn $i$ at index `idx` (relative to `intermediateTurns` length $N$):
    * Calculate `recencyScore` = $idx / (N - 1)$ (if $N > 1$, else $1.0$).
    * Calculate `priorityScore` = $(0.7 \times nScore) + (0.3 \times recencyScore)$.
* **Slot Allocation Process**:
  * **Slot 1 (Pinned - Always RAW)**: Turn 0 (System), Turn 1 (Task Description), Turn T-1 (Previous message), and Turn T (Current prompt). Deduct their token size from the physical budget ceiling.
  * **Slot 2 (High Priority Candidates)**: Sort intermediate turns with `nScore > 0.50` (RAW candidates) by `priorityScore` descending:
    * Try to fit each as `RAW` in the remaining budget.
    * If it doesn't fit, try to fit its `Abstract` version. If the abstract fits, allocate as `Abstract`.
    * If it still doesn't fit, **Drop** it.
  * **Slot 3 (Medium Priority Candidates)**: Sort intermediate turns with `0.20 <= nScore <= 0.50` (Abstract candidates) by `priorityScore` descending:
    * Try to fit its `Abstract` version in the remaining budget.
    * If it fits, allocate as `Abstract`.
    * If it doesn't fit, **Drop** it.
  * **Slot 4 (Low Priority)**: Intermediate turns with `nScore < 0.20` are automatically **Dropped**.

---

## Detailed File Modifications

### [MODIFY] [ace-context-orchestrator.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.ts)
* Update `orchestrateContext`:
  * Add the **Structural Deduplication** pre-processing scan.
  * Calculate `priorityScore` for intermediate turns using the $0.7 \cdot \text{relevance} + 0.3 \cdot \text{recency}$ weight equation.
  * Implement the slot allocation budget loop:
    * Allocate RAW to fitting high-priority candidates.
    * Allocate Abstract to fitting medium-priority and downgraded high-priority candidates.
    * Drop anything that does not fit in the remaining budget.

---

## Verification Plan

### Automated Tests
* Update `ace-context-orchestrator.test.ts` to add test cases asserting:
  * **Structural Deduplication**: Older reads of the same file path and older runs of the same command string are dropped.
  * **Priority RAM Allocation**: When token limit is very tight, less relevant abstracts are dropped to strictly respect the physical budget.
  * **Weighted Rank**: Recent turns with moderate scores are prioritized over slightly higher-scoring very old turns if the weights dictate it.
