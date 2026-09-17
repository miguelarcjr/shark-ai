# Hermes-Inspired Fork Review Agent Design Specification

**Status:** Approved  
**Date:** 2026-09-16  
**Scope:** Runtime Self-Improvement Loop (Memory & Procedural Skills)  
**Authors:** Shark Dev Pair Programming Team  

---

## 1. Executive Summary

This specification defines the architecture, components, trigger mechanisms, and execution lifecycle of the **Fork Review Agent** (`ForkReviewAgent`) in Shark Dev, implementing the Closed Learning Loop inspired by Hermes Agent.

The system continuously reflects on user conversations and tool usage to extract durable factual memory into `MEMORY.md` and `USER.md`, and abstracted procedural skills into `SKILL.md` packages via `SkillManager`.

The Review Agent runs as an autonomous, asynchronous, non-blocking **multi-turn tool loop (Agent Loop)** in the background without freezing the TUI, preserving Prompt Caching parity with the active session model, operating within a strict toolset whitelist and token budget, and executing zero server-side state contamination.

---

## 2. Architecture & Component Structure

```text
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           1. INTERACTIVE CHAT SESSION                             │
│                                                                                   │
│  User ──► [DeveloperAgent Loop] ──► Responses, TUI, Code Execution               │
│                   │                                                               │
│                   │ onUserTurn() -> _turns_since_memory++                         │
│                   │ onToolIteration() -> _iters_since_skill++                     │
│                   ▼                                                               │
│          [Trigger Evaluator] ──► (turns >= 10 OR iters >= 10 OR /refine)          │
└───────────────────┬───────────────────────────────────────────────────────────────┘
                    │
                    │ maybeSpawnBackgroundReview() (Non-blocking, Fire-and-Forget)
                    ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      2. FORK REVIEW AGENT (BACKGROUND THREAD)                     │
│                                                                                   │
│  isReviewing Lock Check (Single-Flight Concurrency)                               │
│  Snapshot: Local Deep Copy of Recent Chat History (No Session DB Mutation)        │
│  System Prompt: buildReviewSystemPrompt(options)                                  │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                            AGENT TOOL LOOP                                  │  │
│  │                                                                             │  │
│  │   LLM Request (Active Model Provider, Prompt Cache Parity)                  │  │
│  │        │                                                                    │  │
│  │        ▼                                                                    │  │
│  │   Has Actions / Tool Calls?                                                 │  │
│  │     ├── YES: Execute Whitelisted Tool ─────────────────────────────┐        │  │
│  │     │         (memory, skill_manage, skill_view, read_file)        │        │  │
│  │     │         Accumulate Input Token Count                         │        │  │
│  │     │         Loop Back to LLM ◄───────────────────────────────────┘        │  │
│  │     │                                                                       │  │
│  │     └── NO: (Natural Plain Text / Empty Actions Completion)                 │  │
│  │          OR Token Budget Exceeded (_review_input_token_budget)              │  │
│  │              │                                                              │  │
│  │              ▼                                                              │  │
│  │          Loop Concludes                                                     │  │
│  └──────────────┬──────────────────────────────────────────────────────────────┘  │
│                 │                                                                 │
│                 ▼                                                                 │
│  3. ATOMIC PERSISTENCE & NOTIFICATION                                             │
│     - Write to MEMORY.md / USER.md / SKILL.md (Respects write_approval)           │
│     - Stamp created_by: 'agent' on .usage.json                                    │
│     - Reset Counters: turnsSinceMemory = 0, itersSinceSkill = 0                   │
│     - Release Lock (isReviewing = false)                                          │
│     - Async Subtle TUI Notice: 💾 [Learning Loop: ...]                            │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Triggers & Counter Tracking

The agent runtime tracks two primary usage counters:
- `turnsSinceMemory: number`: Incremented every time the user submits a message in the active session.
- `itersSinceSkill: number`: Incremented every time the agent executes a tool call in the active session.

### Trigger Matrix

| Trigger | Condition | Review Scope | Selected Prompt |
| :--- | :--- | :--- | :--- |
| **Memory Nudge** | `turnsSinceMemory >= 10` | `reviewMemory: true`, `reviewSkills: false` | `MEMORY_REVIEW_PROMPT` |
| **Skill Nudge** | `itersSinceSkill >= 10` | `reviewMemory: false`, `reviewSkills: true` | `SKILL_REVIEW_PROMPT` |
| **Combined Nudge** | `turnsSinceMemory >= 10 && itersSinceSkill >= 10` | `reviewMemory: true`, `reviewSkills: true` | `COMBINED_REVIEW_PROMPT` |
| **Manual `/refine`** | User command `/refine` | `reviewMemory: true`, `reviewSkills: true` | `COMBINED_REVIEW_PROMPT` |
| **Manual `/refine <focus>`** | User command with text | `reviewMemory: true`, `reviewSkills: true` | `COMBINED_REVIEW_PROMPT` + `## User Refinement Focus` |

---

## 4. Prompt Architecture & Dynamic Selection

Review prompts are stored in `src/core/api/review-prompts.ts`:

### 4.1. `MEMORY_REVIEW_PROMPT`
Focuses strictly on declarative factual knowledge:
- `USER.md` (target: `'user'`, max 1,375 chars): Developer preferences, style, tooling choices.
- `MEMORY.md` (target: `'memory'`, max 2,200 chars): Repository conventions, ports, architecture quirks.
- Anti-noise constraints: Prohibits recording transient failures or single-file task narratives.

### 4.2. `SKILL_REVIEW_PROMPT`
Focuses strictly on procedural knowledge with an **Active Stance**:
- **Proactive abstraction**: Treating workflow omissions as missed learning opportunities.
- **Skill Hierarchy**:
  1. Update currently-loaded skill if active.
  2. Update existing umbrella skill.
  3. Add or update auxiliary files in `references/`.
  4. Create a new umbrella skill only if no match exists.
- **First-Class Signals**: Developer feedback about style, format, or behavior (e.g. "stop doing X", "don't do Y") triggers immediate skill updates.
- **Read-Before-Write Handshake**: Mandatory invocation of `skill_view(name)` before calling `skill_manage` with `patch`, `edit`, `write_file`, or `remove_file`.

### 4.3. `COMBINED_REVIEW_PROMPT`
Unifies both prompts into distinct `## Memory Guidance` and `## Skills Guidance` sections for full-cycle reviews.

### 4.4. `/refine <focus>` Injection
Appends a high-priority block to the prompt:
```markdown
## User Refinement Focus (Highest Priority)
The user explicitly requested the following focus for this review cycle:
"<focus string>"
Prioritize capturing facts or skills related to this instruction.
```

---

## 5. Background Agent Loop & Stop Conditions

The review execution is an autonomous **Multi-Turn Agent Loop**:
1. **Isolated Snapshot**: Deep copy of recent conversation history slice (last 10-15 turns).
2. **Provider Dispatch**: Dispatches to the active AI provider (`StackSpotProvider` or `OpenAICompatibleProvider`) using a dedicated ephemeral session ID (`review_${randomUUID()}`) with `useServerConversation: false` or local history isolation.
3. **Multi-Action Chaining**:
   - The LLM can execute multiple actions sequentially (e.g., `read_file` -> `skill_view` -> `skill_manage` -> `memory`).
   - Results are fed back into the review agent's in-memory history.
4. **Natural Stop Condition**:
   - The loop continues as long as the LLM returns executable actions (`actions` or `tool_calls`).
   - When the LLM outputs plain text without any actions, the loop detects completion and terminates naturally.
5. **Safeguard (Token Budget)**:
   - There is **no artificial cap on the number of actions**.
   - A strict cumulative token budget (`_review_input_token_budget`, default 40,000 tokens) protects against runaway API consumption. If exceeded, the loop halts immediately.
6. **Persistence Isolation (`_persist_disabled`)**:
   - Review thoughts, tool calls, and intermediate iterations are **never recorded** in the main `StateDB` or `HistoryManager` conversation history.

---

## 6. Security, Governance & Toolset Whitelist

### 6.1. Whitelisted Tools
The review loop only has access to:
- `memory`: `read`, `add`, `replace`.
- `skill_manage`: `create`, `edit`, `patch`, `write_file`, `remove_file`, `delete`.
- `skill_view`: read skill content or references.
- `skills_list`: read skills catalog.
- `read_file` / `search_files`: passive workspace exploration.

All other tools (`run_command`, `invoke_subagent`, `session_search`, MCP tools) are **strictly blocked**.

### 6.2. Delete Gate
- The background agent is **forbidden from deleting memories** via `action: "remove"`.
- Any attempt triggers a rejection instructing the agent that memory removals must be done in supervised interactive sessions.

### 6.3. Staged Approvals (`write_approval`)
- If `skills.write_approval` or `memory.write_approval` is `true` in configuration, changes are staged in `.shark/pending/` for user verification (`/skills pending`, `/memory pending`).
- If `false` (default), changes are applied directly to disk.

### 6.4. Provenance Stamping
- All skills created or patched by the review agent are tagged with `created_by: 'agent'` in their `.usage.json`.

---

## 7. TUI Integration & Slash Command

### 7.1. `/refine [focus]` Command
- Added to the active slash command router.
- Dispatches immediately to `ForkReviewAgent.triggerManualReview(focus)`.
- Rejects gracefully if another review is currently active: `⚠️ [Review em andamento, aguarde...]`.

### 7.2. Subtle Status Notifications
- When a review finishes and makes changes:
  - Memory update: `💾 [Learning Loop: Memória atualizada]`
  - Skill update: `⚡ [Learning Loop: Skill '<nome>' atualizada]`
  - No changes: Silent (no terminal noise).
- Rendered non-blockingly without interfering with user keyboard input or active command execution.

---

## 8. Verification & Testing Strategy

- **Unit Tests (`fork-review-agent.test.ts`)**:
  - Counter tracking (`onUserTurn`, `onToolIteration`) and trigger logic.
  - Dynamic prompt selection (`buildReviewSystemPrompt` for memory, skill, combined, and refine focus).
  - Single-flight lock preventing concurrent review executions.
  - Multi-turn agent loop execution and natural exit on empty actions.
  - Token budget cap enforcement (`_review_input_token_budget`).
  - Whitelist enforcement (rejection of blocked tools like `run_command`).
  - Delete Gate enforcement (rejection of `memory(remove)`).
  - Persistence of `created_by: 'agent'` on `.usage.json`.
- **Integration Tests**:
  - Integration with `developer-agent.ts` turn lifecycle.
  - Execution with mocked `AIProvider` responses.
  - Slash command `/refine` handling in TUI.
