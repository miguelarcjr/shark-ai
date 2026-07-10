# Design Spec: ACE (Adaptive Context Elasticizer) Context Orchestrator with Thought Schema

## Goal Description
Implement an **Adaptive Context Elasticizer (ACE)** context manager inside the Shark agent framework (`bmadspot`). 

Currently, the Shark agent uses a lossy/destructive retroactive compaction method (`compactToolOutputRetroactively`) that permanently truncates command logs and reduces TypeScript/JavaScript files to signatures directly in the active history file. This results in the loss of critical implementation details when the agent performs multi-step operations (e.g., reading a codebase to write a consolidated documentation file).

This design spec proposes:
1. Adding a structured `thought` field to the agent response schema to capture the agent's logical reasoning and meta-intent.
2. Refactoring `HistoryManager` to support lossless RAW history tracking (`.raw.json`).
3. Implementing a dynamic, semantic, and rule-based Context Orchestration Layer (COAL) that calculations relevance scores locally and dynamically folds, abstracts, or drops historical steps to maximize context density in the VRAM window.

---

## Proposed Changes

### 1. Schema Extensions (Adding the `thought` field)

We will modify the agent's JSON schemas and response parser to support a structured `thought` property. This forces the model to perform Chain-of-Thought reasoning *before* executing actions and provides the crucial intent context for semantic matching.

#### [MODIFY] [prompts.ts](file:///d:/projetos/bmadspot/src/core/api/prompts.ts)
* Update `UNIFIED_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT` to include:
  * A `thought` field in the output JSON structure.
  * Instructions explaining that the history is elasticized and can be expanded (reversed) dynamically if they request files again.
* Update `COORDINATOR_RESPONSE_JSON_SCHEMA` and `SUBAGENT_RESPONSE_JSON_SCHEMA` to include:
  * `"thought": { "type": ["string", "null"], "description": "Explicação detalhada do raciocínio lógico e intenção da ação tomada." }` at the root object level.

#### [MODIFY] [agent-response-parser.ts](file:///d:/projetos/bmadspot/src/core/agents/agent-response-parser.ts)
* Update `AgentResponseSchema` to parse the root-level `thought` field:
  ```typescript
  export const AgentResponseSchema = z.object({
      thought: z.string().nullable().optional(),
      action: AgentActionSchema.nullable().optional(),
      actions: z.array(AgentActionSchema).default([]),
      commands: z.array(AgentCommandSchema).optional(),
      summary: z.string().optional(),
      message: z.string().optional(),
      conversation_id: z.string().optional(),
  });
  ```

---

### 2. Lossless History Layer (MML)

We must ensure that the raw output of every action remains completely intact on disk.

#### [MODIFY] [history-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/history-manager.ts)
* Update `getRawHistory` and `saveRawHistory` to read and write to `${conversationId}.raw.json` rather than the standard `.json` file path.

#### [MODIFY] [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts)
* Modify the tool output logging flow: remove or bypass the low safety limit truncation (`truncateToolOutput`) *before* saving to `.raw.json` (or set a high safety limit like 100,000 tokens) so that the stored raw messages remain truly lossless.

---

### 3. Context Orchestration Layer (COAL)

The dynamic orchestrator will construct the prompt payload at each turn using the lossless history.

#### [MODIFY] [openai-compatible-provider.ts](file:///d:/projetos/bmadspot/src/core/api/openai-compatible-provider.ts) and [stackspot-provider.ts](file:///d:/projetos/bmadspot/src/core/api/stackspot-provider.ts)
* Remove the destructive call to `compactToolOutputRetroactively` inside the stream callback.
* In `streamChat`, load the RAW history: `const rawHistory = await HistoryManager.getRawHistory(conversationId)`.
  * Run the **Elasticizer Algorithm** to construct the message context for the API payload:
    * **Golden Rule - Pinned Items (Always RAW):**
      * Turn 0 (System Prompt / Tasks) is always kept `RAW`.
      * Turn $T-1$ (the immediate previous turn, which contains the last action and tool output) is always kept `RAW` to anchor the agent in immediate reality.
    * **Dynamic Query Composition for Search:**
      * Create a query string by concatenating: `[First User Message (if available)] + [Turn T-1 Thoughts] + [Current Turn T Prompt]`.
    * **Semantic Scoring & Max-Normalization:**
      * For all intermediate turns, compute raw BM25 scores against the query string using `EmbeddingService.scoreDocumentsBM25`.
      * Bounded Normalization: Max-Normalize the scores by dividing each score by the maximum score in the batch, yielding bounded values between `0.0` and `1.0`.
    * **Candidate State Classification (Before Budgeting):**
      * **RAW Candidates:** Turns with a normalized score > 0.50.
      * **Abstract:** Bounded score between 0.20 and 0.50:
        * For TS/JS code files: Compact to class/interface signatures only.
        * For Non-Code files (.md, .json, .yaml, .txt): Compact to metadata (file path, line count, file size) + the first 10 lines of the file.
        * For Command executions: Compact to a combination of the agent's parsed `summary` field (from the assistant's schema response) and the programmatic tool summary.
      * **Drop:** Bounded score < 0.20.
    * **Physical Token Budget Enforcement:**
      * Define the context token budget: `0.80 * compactionTokenLimit` (default budget of ~6,400 tokens if limit is 8,000).
      * Deduct the token usage of Turn 0 and Turn $T-1$ (which are always RAW) from the budget.
      * Sort all other RAW candidates by **Semantic Score (descending)** and **Recency (descending)**.
      * Add them as RAW to the payload one by one. For each addition, count/estimate the tokens.
      * If adding a turn exceeds the remaining token budget, immediately downgrade that turn and all remaining candidate turns to `Abstract` (or `Drop` if their score is < 0.20).
    * **Debugger/UI Mirroring:**
      * After constructing the orchestrated history, save it to the standard `.json` file using `HistoryManager.saveHistory` so that legacy log viewers, debugger UIs, and dashboards remain synchronized in real-time.

---

## Verification Plan

### Automated Tests
* Run `npm test` or `vitest run` on `history-manager.test.ts`, `compaction-and-caching.test.ts`, and provider tests to ensure schemas and parsers remain backward compatible.
* Write a new test suite `ace-context-orchestrator.test.ts` to mock the history turns and assert:
  - Turn 0 and Turn $T-1$ are always kept `RAW`.
  - Turns with semantic relevance score > 0.40 are expanded to `RAW`.
  - Turns with semantic relevance score between 0.15 and 0.40 are converted to `Abstract`.
  - Irrelevant turns are `Dropped`.
  - Reversibility: when the query shifts, previously dropped/abstracted turns are correctly expanded to RAW.

### Manual Verification
* Run a mock development session where the agent reads multiple files (e.g. `src/core/api/prompts.ts`, `src/core/workflow/membox-manager.ts`) and subsequently writes a summary file.
* Inspect `_sharkrc/history/*.raw.json` to verify the raw outputs are intact.
* Inspect the terminal debugger logs to confirm the active payload sent to the LLM has successfully folded the file contents of inactive turns while expanding the active ones.
