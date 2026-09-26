# Design Spec: Hermes-Style Context Compression with Smart Pinning & Main LLM Summarizer

- **Date:** 2026-09-26
- **Author:** Shark AI Team
- **Status:** Approved

---

## 1. Problem Statement

During long execution sessions in Shark AI (e.g. session `8af80a9d-f91d-4932-9f97-ed7d8067842f` running on WhatsApp / CLI), context compression triggered catastrophic amnesia:
1. **Rigid Pinned Head (`pinnedEnd = 2`):**
   `ContextCompressor` pinned exclusively Turn 0 (system prompt) and Turn 1 (which was merely an opening greeting `"boa noite"` formatted as `👉 **CURRENT TASK**: "boa noite"`).
2. **Discarded Human Orders:**
   The user's actual 20-item task list sent in Turn 7 was relegated to the `middle` slice and compressed away.
3. **Missing LLM Summarizer:**
   `options.summarizer` was never wired to a real LLM provider in `TurnLoopRunner`, `OpenAICompatibleProvider`, or `StackSpotProvider`. Compaction always fell back to `generateDeterministicFallback`, which only scanned `role === 'assistant'` messages for file paths, completely ignoring `role === 'user'` content.
4. **Catastrophic Amnesia:**
   When subsequent tool operations failed (e.g., Playwright tool unavailable), the agent fell back on the only human instruction remaining in context: `CURRENT TASK: "boa noite"`, concluding that the user only sent a greeting and replying with a casual `"Boa noite! 👋 O que você gostaria de fazer agora?"`.

---

## 2. Goals & Non-Goals

### Goals
- **Adopt the 4-Phase Hermes Agent Compression Pipeline using the Active Main LLM:**
  - **Phase 1 (Deterministic Pruning):** Truncate older tool outputs (`[Action ... Success]:`) > 200 chars in the middle to `[Old tool output cleared to save context space]`.
  - **Phase 2 (Smart Pinning & Boundary Alignment):** Pin the system prompt (Turn 0) AND the **latest human user task** (`latestHumanUserMsg`), ensuring active goals survive compression. Align the tail boundary backward so tool calls and results are never split.
  - **Phase 3 (Out-of-band Main LLM Summarization):** Call the active provider out-of-band using the Hermes Markdown template (Goal, Constraints, Progress [Done/In Progress/Blocked], Key Decisions, Relevant Files, Next Steps, Critical Context) with previous summary chaining and a 5-minute (300,000 ms) timeout.
  - **Phase 4 (Reconstruction, Anti-Thrashing, Sanitization):** Inject the summary with `role: 'user'` under `[CONTEXT COMPACTION — REFERENCE ONLY]...[END OF COMPACTION]`. Reject compaction if the summary would exceed the middle's token size (anti-thrashing). Persist in-place to `HistoryManager` and SQLite `StateDB`.
  - **Enriched Fallback:** If the LLM call times out or fails, generate a fallback that incorporates both user requirements and assistant actions from the middle.

### Non-Goals
- Introducing separate auxiliary models (e.g., dedicated secondary mini-models). The active main provider (`OpenAICompatibleProvider` or `StackSpotProvider`) is used directly.
- Altering the tool execution loop or CLI interface.

---

## 3. Architecture & Technical Design

### 3.1 Provider Interface Extension (`src/core/api/provider.interface.ts`)

Add optional `completePrompt` to `AIProvider` for out-of-band text generation:
```typescript
export interface CompletePromptOptions {
    systemPrompt?: string;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface AIProvider {
    streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse>;
    completePrompt?(prompt: string, options?: CompletePromptOptions): Promise<string>;
}
```

Implement `completePrompt` on:
1. `OpenAICompatibleProvider`: POST to `${baseURL}/chat/completions` with `{ model, messages, temperature: 0.2, stream: false }` with a 5-minute timeout.
2. `StackSpotProvider`: Call StackSpot API in non-streaming mode with the provided prompt.

### 3.2 Hermes Compression Prompt Template (`src/core/workflow/compression-prompt.ts`)

```text
You are an expert context summarizer. Your task is to compress the conversation history into a clear, structured technical summary while preserving all critical context, requirements, decisions, and current progress.

Format your output EXACTLY as follows:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
[User preferences, coding style, constraints, important decisions]

## Progress
### Done
[Completed work — specific file paths, commands run, results]
### In Progress
[Work currently underway]
### Blocked
[Any blockers or issues encountered]

## Key Decisions
[Important technical decisions and why]

## Relevant Files
[Files read, modified, or created — with brief note on each]

## Next Steps
[What needs to happen next]

## Critical Context
[Specific values, error messages, configuration details]
```

When a previous summary exists, prepend:
```text
PREVIOUS SUMMARY:
{{previousSummary}}

Update the previous summary with the new middle turns. Move items from In Progress to Done as appropriate.
```

### 3.3 Four-Phase Pipeline in `ContextCompressor` (`src/core/workflow/context-compressor.ts`)

#### Phase 1: Deterministic Pruning
```typescript
static pruneOldToolResults(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(msg => {
        if (msg.role === 'user' && msg.content.startsWith('[Action ') && msg.content.length > 200) {
            const firstLine = msg.content.split('\n')[0];
            return {
                ...msg,
                content: `${firstLine}\n[Old tool output cleared to save context space]`
            };
        }
        return msg;
    });
}
```

#### Phase 2: Smart Pinning & Boundary Alignment
- `pinnedHead`: System prompt (Index 0).
- `activeUserTask`: Search backward from `history.length - 1` for the most recent human message (`role === 'user'` without `[Action ` or `[MEMÓRIA`). Include this message in the pinned set so the active instruction is NEVER lost.
- `tail`: Preserve last `tailSize` messages (default 15).
- `_align_boundary_backward`: If `tailStart` splits a tool call from its result, decrement `tailStart` to include the parent assistant message.

#### Phase 3: Out-of-band LLM Call
- Send pruned middle messages formatted as dialogue to `completePrompt(prompt, { timeoutMs: 300000 })`.
- If LLM fails or times out after 5 minutes: use `generateDeterministicFallback(middleMessages)` which extracts both user messages and assistant tool modifications.

#### Phase 4: In-Place Reconstruction & Sanitization
- Check anti-thrashing: verify `summary.length < middleTotalLength`.
- Format summary message:
  ```typescript
  const summaryMessage: ChatMessage = {
      role: 'user',
      content: `[CONTEXT COMPACTION — REFERENCE ONLY]\n${summaryText}\n\n[END OF COMPACTION]`
  };
  ```
- Resulting history: `[systemPrompt, activeUserTask, summaryMessage, ...tail]`.

---

## 4. Verification & Testing

1. **Unit tests in `src/core/workflow/context-compressor.test.ts`:**
   - Verify Smart Pinning preserves the latest human user message even when intermediate turns exceed threshold.
   - Verify tool output pruning for messages > 200 chars.
   - Verify boundary alignment prevents orphaned tool results.
   - Verify anti-thrashing rejects larger summaries.
   - Verify LLM summarizer invocation and 5-minute timeout fallback.
2. **Provider tests in `openai-compatible-provider.test.ts` and `stackspot-provider.test.ts`:**
   - Verify `completePrompt` execution and error handling.
3. **Full regression check:**
   - `npm test` and `npm run build`.
