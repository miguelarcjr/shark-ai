# Design Spec: Always-On Structural Read-File Deduplication

## Goal Description
Enhance the **Adaptive Context Elasticizer (ACE)** in `shark-ai` so that structural deduplication of redundant file reads (`read_file`) is applied **unconditionally on every interaction turn**, rather than only when the conversation history exceeds 80% of the token budget. 

Additionally, preserve command execution outputs (`run_command`) during structural deduplication to prevent accidental loss of historical test failures or debugging logs.

---

## Proposed Changes

### Component: ACE Context Orchestrator

#### [MODIFY] [ace-context-orchestrator.ts](file:///d:/projetos/bmadspot/src/core/api/ace-context-orchestrator.ts)

1. Extract structural deduplication logic into a dedicated helper function:
   ```typescript
   export function applyStructuralReadDeduplication(rawHistory: ChatMessage[]): ChatMessage[]
   ```

2. **Deduplication Rules**:
   - Identify pinned indices:
     - Turn 0 (System Message)
     - Turn 1 / Original User Task Instruction
     - Latest Human Prompt
     - Conversation Tail ($T-1$ and $T$)
   - Perform a reverse-chronological scan ($T \rightarrow 0$) over `rawHistory`:
     - Track `seenReadFiles = new Set<string>()`.
     - When encountering a turn starting with `[Action read_file(path) Success]`:
       - Parse `filePath` from `read_file(path)`.
       - If `seenReadFiles.has(filePath)` AND index is not in `pinnedIndices`, mark index for removal.
       - Otherwise, add `filePath` to `seenReadFiles`.
     - `run_command` entries are no longer added to a drop list during structural deduplication.
   - Filter out dropped indices while preserving original message ordering.

3. **Orchestration Execution Order**:
   - Call `applyStructuralReadDeduplication(rawHistory)` **unconditionally** at the start of `orchestrateContext`.
   - Calculate `totalTokens` of the deduplicated history.
   - If `totalTokens <= budgetCeiling`, return the deduplicated history immediately.
   - If `totalTokens > budgetCeiling`, proceed with BM25 scoring and Abstract candidate budgeting on the deduplicated history.

---

## Verification Plan

### Automated Tests
Run vitest suite for ACE orchestrator:
`npx vitest run src/core/api/ace-context-orchestrator.test.ts`

Add test cases in `src/core/api/ace-context-orchestrator.test.ts`:
1. **Always-On Execution**: Assert that duplicate `read_file` calls for the same file path are deduplicated even when total raw tokens are well below the compaction token limit threshold.
2. **Read File Preservation**: Assert that only the most recent `read_file` for a given file path is retained, while older reads of the same file path are dropped.
3. **Run Command Preservation**: Assert that multiple `run_command` entries are NOT dropped by structural deduplication.
4. **Pinned Message Protection**: Assert that Turn 0, original task instructions, and current prompt tail are never dropped.
