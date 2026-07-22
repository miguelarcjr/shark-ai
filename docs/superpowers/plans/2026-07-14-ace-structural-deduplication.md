# ACE Structural Deduplication & Priority RAM Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement structural deduplication and priority-weighted RAM slot allocation inside the ACE Context Orchestrator.

**Architecture:** A pre-processing pass will scan and drop stale duplicate file reads and command outputs. Then, intermediate turns will be ranked using a weighted priority score ($0.7 \times \text{relevance} + 0.3 \times \text{recency}$) and sequentially allocated context budget slots, dropping any items that exceed the token limit.

**Tech Stack:** TypeScript, Node.js, Vitest, `@ast-grep/napi`, `gpt-tokenizer`.

## Global Constraints
- Target context budget is exactly `0.80 * compactionTokenLimit`.
- Pinned messages (Turn 0, Turn 1, Turn T, Turn T-1) must always be kept RAW and are never eligible for deduplication or descarte.
- Linear recency score scales from `0.0` (oldest intermediate turn) to `1.0` (newest intermediate turn).
- Semantic relevance score uses normalized BM25 scores.

---

### Task 1: Structural Deduplication Layer

**Files:**
- Modify: `src/core/api/ace-context-orchestrator.ts`
- Test: `src/core/api/ace-context-orchestrator.test.ts`

**Interfaces:**
- Consumes: `rawHistory: ChatMessage[]`
- Produces: `forceDropIndices: Set<number>` indicating which intermediate turns are redundant and must be dropped.

- [ ] **Step 1: Write a failing test for deduplication**
  Add the following test case inside the `Orchestration and Pinning` describe block in [ace-context-orchestrator.test.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.test.ts):
  ```typescript
  it('should drop duplicate read_file and run_command executions, keeping only the latest', async () => {
      const rawHistory: ChatMessage[] = [
          { role: 'system', content: 'System' }, // 0: Pinned
          { role: 'user', content: 'Task' }, // 1: Pinned
          { role: 'user', content: '[Action read_file(src/main.ts) Success]:\nold content' }, // 2: Duplicate read (should be dropped)
          { role: 'user', content: '[Action run_command(npm test) Success]:\nold output' }, // 3: Duplicate command (should be dropped)
          { role: 'user', content: '[Action read_file(src/main.ts) Success]:\nnew content' }, // 4: Latest read (should be kept based on budget/score)
          { role: 'user', content: '[Action run_command(npm test) Success]:\nnew output' }, // 5: Pinned (T-1)
          { role: 'user', content: 'current prompt' } // 6: Pinned (T)
      ];

      mockScoreDocumentsBM25.mockReturnValue([10.0, 10.0, 10.0, 10.0]); // High scores for intermediate turns

      const result = await orchestrateContext(rawHistory, 'current prompt', 10); // low limit to trigger

      // Verify Turn 2 and Turn 3 are dropped
      const oldRead = result.find(m => m.content.includes('old content'));
      const oldCmd = result.find(m => m.content.includes('old output'));
      expect(oldRead).toBeUndefined();
      expect(oldCmd).toBeUndefined();

      // Verify Turn 4 is kept
      const newRead = result.find(m => m.content.includes('new content'));
      expect(newRead).toBeDefined();
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts -t "should drop duplicate"`
  Expected: FAIL (assertion fails or type check fails)

- [ ] **Step 3: Implement the structural deduplication pre-processing scan**
  Modify [ace-context-orchestrator.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.ts) at the start of the `orchestrateContext` function to perform a reverse chronological scan:
  ```typescript
  // 1. Structural Deduplication
  const seenReadFiles = new Set<string>();
  const seenCommands = new Set<string>();
  const forceDropIndices = new Set<number>();

  const pinnedIndices = new Set<number>();
  pinnedIndices.add(0); // Turn 0 (system message)
  pinnedIndices.add(rawHistory.length - 1); // Turn T (current prompt)
  if (rawHistory.length > 2) {
      pinnedIndices.add(rawHistory.length - 2); // Turn T-1 (previous tool output or assistant thought)
  }
  const firstUserMsgIdx = rawHistory.findIndex((m, idx) => m.role === 'user' && idx > 0);
  if (firstUserMsgIdx !== -1) {
      pinnedIndices.add(firstUserMsgIdx); // Turn 1 (original task instruction)
  }

  // Scan intermediate turns from newest to oldest
  for (let i = rawHistory.length - 1; i >= 0; i--) {
      if (pinnedIndices.has(i)) continue;

      const msg = rawHistory[i];
      if (msg.role === 'user' || msg.role === 'system') {
          if (msg.content.startsWith('[Action read_file(')) {
              const pathMatch = msg.content.match(/read_file\(([^)]+)\)/);
              const filePath = pathMatch ? pathMatch[1] : '';
              if (filePath) {
                  if (seenReadFiles.has(filePath)) {
                      forceDropIndices.add(i);
                  } else {
                      seenReadFiles.add(filePath);
                  }
              }
          } else if (msg.content.startsWith('[Action run_command(')) {
              const cmdMatch = msg.content.match(/run_command\(([^)]+)\)/);
              const cmd = cmdMatch ? cmdMatch[1] : '';
              if (cmd) {
                  if (seenCommands.has(cmd)) {
                      forceDropIndices.add(i);
                  } else {
                      seenCommands.add(cmd);
                  }
              }
          }
      }
  }
  ```
  Ensure these `forceDropIndices` are excluded from `intermediateTurns` or flagged as automatic drop candidates:
  ```typescript
  const intermediateTurns: { msg: ChatMessage, originalIndex: number }[] = [];
  for (let i = 0; i < rawHistory.length; i++) {
      if (!pinnedIndices.has(i) && !forceDropIndices.has(i)) {
          intermediateTurns.push({ msg: rawHistory[i], originalIndex: i });
      }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts -t "should drop duplicate"`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/core/api/ace-context-orchestrator.ts src/core/api/ace-context-orchestrator.test.ts
  git commit -m "feat: add structural deduplication pass for read_file and run_command"
  ```

---

### Task 2: Weighted Priority RAM Allocation

**Files:**
- Modify: `src/core/api/ace-context-orchestrator.ts`
- Test: `src/core/api/ace-context-orchestrator.test.ts`

- [ ] **Step 1: Write a failing test for priority-based descarte**
  Add the following test case inside `Orchestration and Pinning` describe block in [ace-context-orchestrator.test.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.test.ts):
  ```typescript
  it('should allocate context budget slots using weighted priority score and drop remaining abstracts', async () => {
      const rawHistory: ChatMessage[] = [
          { role: 'system', content: 'System' }, // 0: Pinned
          { role: 'user', content: 'Task' }, // 1: Pinned
          { role: 'user', content: 'Intermediate 2' }, // 2: Oldest intermediate
          { role: 'user', content: 'Intermediate 3' }, // 3: Middle intermediate
          { role: 'user', content: 'Intermediate 4' }, // 4: Newest intermediate
          { role: 'user', content: 'last action' }, // 5: Pinned (T-1)
          { role: 'user', content: 'current prompt' } // 6: Pinned (T)
      ];

      // Relevance scores:
      // idx 2 (original index 2): 2.0 (normalized to 1.0)
      // idx 3 (original index 3): 1.5 (normalized to 0.75)
      // idx 4 (original index 4): 0.5 (normalized to 0.25)
      mockScoreDocumentsBM25.mockReturnValue([2.0, 1.5, 0.5]);

      // Set extremely low token limit (e.g. 10) to force descarte of intermediate turns that do not fit in remaining RAM
      const result = await orchestrateContext(rawHistory, 'current prompt', 10);

      // Verify that the slot budget allocation correctly dropped those that exceeded remainingBudget
      // For instance, check if result does not contain some of the intermediate turns if limit was exceeded
      expect(result.length).toBeLessThan(7);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts -t "should allocate context budget"`
  Expected: FAIL

- [ ] **Step 3: Implement Priority Score and Dynamic Slot Allocation**
  Update the `orchestrateContext` function in [ace-context-orchestrator.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.ts) to calculate `priorityScore` and dynamically allocate budget:
  ```typescript
  // 3. Candidate State Classification (Before Budgeting)
  const N = intermediateTurns.length;
  const classifiedCandidates = intermediateTurns.map((turnObj, idx) => {
      const nScore = normalizedScores[idx];
      const recencyScore = N > 1 ? idx / (N - 1) : 1.0;
      const priorityScore = (0.7 * nScore) + (0.3 * recencyScore);
      return {
          turn: turnObj.msg,
          originalIndex: turnObj.originalIndex,
          idx,
          nScore,
          priorityScore,
          isRawCandidate: nScore > 0.50,
          isAbstractCandidate: nScore >= 0.20 && nScore <= 0.50,
          tokenEstimate: countTokens(turnObj.msg.content),
          abstractEstimate: countTokens(generateAbstract(turnObj.msg))
      };
  });

  // 4. Physical Token Budget Enforcement (RAM Slot Allocation)
  let remainingBudget = budgetCeiling;

  // Deduct Pinned Messages first (Slot 1)
  for (const idx of pinnedIndices) {
      remainingBudget -= countTokens(rawHistory[idx].content);
  }

  // Sort candidates by priorityScore descending
  const sortedCandidates = [...classifiedCandidates].sort((a, b) => b.priorityScore - a.priorityScore);

  const rawIndices = new Set<number>();
  const abstractIndices = new Set<number>();

  for (const cand of sortedCandidates) {
      if (cand.isRawCandidate) {
          // Slot 2: Try to fit as RAW
          if (cand.tokenEstimate <= remainingBudget) {
              rawIndices.add(cand.originalIndex);
              remainingBudget -= cand.tokenEstimate;
          } 
          // Slot 3: Downgrade and try to fit as Abstract
          else if (cand.abstractEstimate <= remainingBudget) {
              abstractIndices.add(cand.originalIndex);
              remainingBudget -= cand.abstractEstimate;
          }
          // Else: Drop
      } 
      else if (cand.isAbstractCandidate) {
          // Slot 4: Try to fit as Abstract
          if (cand.abstractEstimate <= remainingBudget) {
              abstractIndices.add(cand.originalIndex);
              remainingBudget -= cand.abstractEstimate;
          }
          // Else: Drop
      }
  }
  ```
  Then, build the final orchestrated array:
  ```typescript
  // 5. Construct Final Orchestrated History
  const orchestrated: ChatMessage[] = [];
  for (let i = 0; i < rawHistory.length; i++) {
      if (pinnedIndices.has(i) || rawIndices.has(i)) {
          orchestrated.push(rawHistory[i]);
      } else if (abstractIndices.has(i)) {
          orchestrated.push({
              role: rawHistory[i].role,
              content: generateAbstract(rawHistory[i])
          });
      }
  }

  return orchestrated;
  ```

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run src/core/api/ace-context-orchestrator.test.ts -t "should allocate context budget"`
  Expected: PASS

- [ ] **Step 5: Run all test cases in project to verify no regressions**
  Run: `npx vitest run`
  Expected: All 248+ tests PASS.

- [ ] **Step 6: Commit**
  ```bash
  git add src/core/api/ace-context-orchestrator.ts src/core/api/ace-context-orchestrator.test.ts
  git commit -m "feat: implement priority score ranking and dynamic RAM-style slot allocation"
  ```
