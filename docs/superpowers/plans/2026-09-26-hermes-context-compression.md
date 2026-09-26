# Hermes-Style Context Compression with Smart Pinning & Main LLM Summarizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Hermes 4-phase context compression pipeline in Shark AI using the active main LLM provider and Smart Pinning to prevent catastrophic amnesia and lost task instructions during long sessions.

**Architecture:** Extend `AIProvider` with `completePrompt` for out-of-band auxiliary calls without history pollution. In `ContextCompressor`, implement deterministic tool output pruning, Smart Pinning of the latest human task, boundary alignment for tool call pairs, structured Hermes LLM summarization with 5-minute timeout, anti-thrashing, and an enriched fallback that extracts human instructions.

**Tech Stack:** TypeScript, Node.js (>=22), Vitest, gpt-tokenizer

## Global Constraints

- Never discard the active user task instruction (`latestHumanUserMsg`) during compression.
- Out-of-band LLM summarizer calls must use the active main provider without saving to conversation history.
- The summarizer timeout is 5 minutes (300,000 ms).
- If the LLM summarizer fails or times out, the deterministic fallback must preserve user instructions and file edits.
- All vitest test suites must pass.

---

### Task 1: Add `completePrompt` to `AIProvider` and Providers

**Files:**
- Modify: `src/core/api/provider.interface.ts:1-17`
- Modify: `src/core/api/openai-compatible-provider.ts:119-450`
- Modify: `src/core/api/stackspot-provider.ts:60-240`
- Test: `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: `completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string>`.
- Produces: Out-of-band non-streaming completion string without saving to `HistoryManager` or `StateDB`.

- [ ] **Step 1: Write failing test in `src/core/api/openai-compatible-provider.test.ts`**

Add a test verifying `completePrompt` sends a non-streaming completion request with system prompt and returns content:
```typescript
    it('executes out-of-band completePrompt without mutating history', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify({
                choices: [{ message: { content: 'Summary text from LLM' } }]
            })
        });
        vi.stubGlobal('fetch', mockFetch);

        const provider = new OpenAICompatibleProvider({
            baseURL: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            model: 'gpt-4o',
            useStructuredOutputs: false
        });

        const result = await provider.completePrompt('Summarize this conversation', {
            systemPrompt: 'You are a summarizer',
            timeoutMs: 5000
        });

        expect(result).toBe('Summary text from LLM');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        const reqBody = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(reqBody.stream).toBe(false);
        expect(reqBody.messages).toEqual([
            { role: 'system', content: 'You are a summarizer' },
            { role: 'user', content: 'Summarize this conversation' }
        ]);

        vi.unstubAllGlobals();
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`
Expected: FAIL (`completePrompt is not a function`).

- [ ] **Step 3: Implement `completePrompt` in `provider.interface.ts`, `openai-compatible-provider.ts`, and `stackspot-provider.ts`**

1. In `src/core/api/provider.interface.ts`:
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

2. In `src/core/api/openai-compatible-provider.ts`:
```typescript
    async completePrompt(prompt: string, options?: CompletePromptOptions): Promise<string> {
        const timeoutMs = options?.timeoutMs ?? 300000;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const messages: ChatMessage[] = [];
        if (options?.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        messages.push({ role: 'user', content: prompt });

        const requestPayload = {
            model: this.options.model,
            messages,
            stream: false,
            temperature: options?.temperature ?? 0.2
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.options.apiKey) {
            headers['Authorization'] = `Bearer ${this.options.apiKey}`;
        }

        try {
            const res = await fetch(`${this.options.baseURL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestPayload),
                signal: controller.signal
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(`OpenAI completePrompt failed: ${res.status} ${res.statusText} - ${errBody}`);
            }

            const text = await res.text();
            const parsed = JSON.parse(text.trim());
            return parsed.choices?.[0]?.message?.content || '';
        } finally {
            clearTimeout(timeoutId);
        }
    }
```

3. In `src/core/api/stackspot-provider.ts`:
Implement `completePrompt` sending the single-turn prompt to the StackSpot agent endpoint and returning text content.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`
Expected: All tests in `openai-compatible-provider.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/api/provider.interface.ts src/core/api/openai-compatible-provider.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.test.ts
git commit -m "feat(api): add completePrompt to AIProvider for out-of-band completions"
```

---

### Task 2: Hermes Compression Prompt Template & Enriched Fallback

**Files:**
- Create: `src/core/workflow/compression-prompt.ts`
- Modify: `src/core/workflow/context-compressor.ts:165-198`
- Test: `src/core/workflow/context-compressor.test.ts`

**Interfaces:**
- Produces: `HERMES_COMPRESSION_SYSTEM_PROMPT` and `buildCompressionUserPrompt(messages: ChatMessage[], previousSummary?: string): string`.
- Produces: `ContextCompressor.pruneOldToolResults(messages: ChatMessage[]): ChatMessage[]`.
- Produces: Enriched `ContextCompressor.generateDeterministicFallback(middleMessages: ChatMessage[]): string` that extracts user instructions.

- [ ] **Step 1: Create `src/core/workflow/compression-prompt.ts`**

```typescript
import { ChatMessage } from './history-manager.js';

export const HERMES_COMPRESSION_SYSTEM_PROMPT = `You are an expert context summarizer. Your task is to compress the conversation history into a clear, structured technical summary while preserving all critical context, requirements, decisions, and current progress.

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
[Specific values, error messages, configuration details]`;

export function buildCompressionUserPrompt(middleMessages: ChatMessage[], previousSummary?: string): string {
    let prompt = '';
    if (previousSummary) {
        prompt += `PREVIOUS SUMMARY:\n${previousSummary}\n\nUpdate the previous summary with the new middle turns. Move items from In Progress to Done as appropriate.\n\n`;
    }

    prompt += `CONVERSATION TURNS TO SUMMARIZE:\n`;
    for (const msg of middleMessages) {
        prompt += `\n[${msg.role.toUpperCase()}]:\n${msg.content}\n`;
    }

    return prompt;
}
```

- [ ] **Step 2: Write failing tests in `src/core/workflow/context-compressor.test.ts`**

Add tests for:
1. `pruneOldToolResults`: Tool outputs > 200 chars are replaced with first line + `\n[Old tool output cleared to save context space]`. Short tool outputs and non-tool outputs are unchanged.
2. `generateDeterministicFallback`: Captures user requests from `role === 'user'` in the middle messages under `- Tarefas Solicitadas pelo Usuário:`.

```typescript
    it('prunes tool outputs over 200 chars in middle messages', () => {
        const longOutput = '[Action run_command(npm test) Success]:\n' + 'A'.repeat(500);
        const shortOutput = '[Action modify_file(src/a.ts) Success]';
        const userMsg = 'User instruction';

        const pruned = ContextCompressor.pruneOldToolResults([
            { role: 'user', content: longOutput },
            { role: 'user', content: shortOutput },
            { role: 'user', content: userMsg }
        ]);

        expect(pruned[0].content).toContain('[Old tool output cleared to save context space]');
        expect(pruned[0].content.length).toBeLessThan(100);
        expect(pruned[1].content).toBe(shortOutput);
        expect(pruned[2].content).toBe(userMsg);
    });

    it('extracts user instructions in deterministic fallback', () => {
        const fallback = ContextCompressor.generateDeterministicFallback([
            { role: 'user', content: 'Alterar depoimentos e arrumar links do footer' },
            { role: 'assistant', content: '{"thought":"modificando","summary":"editado footer","action":{"path":"src/footer.tsx"}}' }
        ]);

        expect(fallback).toContain('Alterar depoimentos');
        expect(fallback).toContain('src/footer.tsx');
    });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/context-compressor.test.ts`
Expected: FAIL (`pruneOldToolResults` not defined).

- [ ] **Step 4: Implement `pruneOldToolResults` and enriched fallback in `context-compressor.ts`**

Implement `pruneOldToolResults` and update `generateDeterministicFallback` to collect user texts:
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

  static generateDeterministicFallback(middleMessages: ChatMessage[]): string {
    const userGoals: string[] = [];
    const modifiedFiles = new Set<string>();
    const actionsTaken: string[] = [];

    for (const msg of middleMessages) {
      if (msg.role === 'user') {
        if (!msg.content.startsWith('[Action ') && !msg.content.startsWith('[System]') && !msg.content.startsWith('[MEMÓRIA')) {
          userGoals.push(msg.content.trim().slice(0, 300));
        }
      } else if (msg.role === 'assistant') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.action?.path) {
            modifiedFiles.add(parsed.action.path);
          }
          if (parsed.summary) {
            actionsTaken.push(parsed.summary);
          }
        } catch {
          const fileMatch = msg.content.match(/(?:create_file|modify_file|path)["':\s]+([^"'\s,}]+)/);
          if (fileMatch) modifiedFiles.add(fileMatch[1]);
        }
      }
    }

    const goalsStr = userGoals.length > 0 ? userGoals.join('\n- ') : 'Continuidade da execução da tarefa solicitada pelo usuário';
    const filesStr = modifiedFiles.size > 0 ? Array.from(modifiedFiles).join(', ') : 'Arquivos do workspace';
    const recentActions = actionsTaken.slice(-3).join('; ') || 'Progresso acumulado de execução da tarefa';

    return [
      `[Summary of earlier turns]`,
      `- Objetivos do Usuário:\n- ${goalsStr}`,
      `- Decisões Técnicas: ${recentActions}`,
      `- Arquivos Modificados: ${filesStr}`,
      `- Próximo Passo: Prosseguir com os turnos imediatos da conversa`
    ].join('\n');
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/context-compressor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow/compression-prompt.ts src/core/workflow/context-compressor.ts src/core/workflow/context-compressor.test.ts
git commit -m "feat(workflow): add hermes compression prompt and enriched deterministic fallback"
```

---

### Task 3: Smart Pinning, Anti-Thrashing, and LLM Summarizer Pipeline in `ContextCompressor`

**Files:**
- Modify: `src/core/workflow/context-compressor.ts:1-164`
- Test: `src/core/workflow/context-compressor.test.ts`

**Interfaces:**
- Consumes: `options: CompressOptions` containing `tokenLimit`, `provider?: AIProvider`, `previousSummary?: string`.
- Produces: Compacted `history: ChatMessage[]` with Smart Pinning (system + latest human user message preserved), out-of-band Hermes summary with 5-minute timeout, and anti-thrashing.

- [ ] **Step 1: Write failing tests in `src/core/workflow/context-compressor.test.ts`**

Add tests for:
1. **Smart Pinning:** An active conversation where Turn 1 is a greeting and Turn 5 is a detailed task list: after compression, Turn 5 (the latest human user instruction) is pinned and preserved, never dropped into the middle.
2. **Out-of-band LLM call:** When `provider.completePrompt` is supplied, it invokes the provider with `HERMES_COMPRESSION_SYSTEM_PROMPT` and timeout 300,000 ms.
3. **Anti-thrashing:** When summary is larger than middle text, compaction is aborted (`wasCompressed: false`).

```typescript
    it('pins the latest human user message so active tasks are never lost in middle compression', async () => {
        const history: ChatMessage[] = [
            { role: 'system', content: 'You are Shark Dev' }, // 0
            { role: 'user', content: 'boa noite' }, // 1
            { role: 'assistant', content: '{"thought":"greeting","summary":"hello"}' }, // 2
            { role: 'user', content: 'voce e legal' }, // 3
            { role: 'assistant', content: '{"thought":"thanks","summary":"ty"}' }, // 4
            { role: 'user', content: 'TASK: Implement auth and fix buttons on navbar' }, // 5: Latest active human task!
            ...Array.from({ length: 25 }, (_, i) => ({
                role: 'user' as const,
                content: `[Action run_command(test_${i}) Success]: Output ${i}`
            }))
        ];

        const { history: compressed, wasCompressed } = await ContextCompressor.compress(history, {
            tokenLimit: 500,
            thresholdRatio: 0.1,
            tailSize: 10
        });

        expect(wasCompressed).toBe(true);
        // The active human task MUST be in the pinned block
        const hasTask = compressed.some(m => m.role === 'user' && m.content.includes('TASK: Implement auth'));
        expect(hasTask).toBe(true);

        // Turn 1 (boa noite) and Turn 3 should have been compacted away into summary
        const hasCasual = compressed.some(m => m.content === 'voce e legal');
        expect(hasCasual).toBe(false);
    });

    it('invokes provider.completePrompt out-of-band with 5-minute timeout', async () => {
        const mockCompletePrompt = vi.fn().mockResolvedValue('## Goal\nImplement auth\n## Progress\n### Done\nNavbar');
        const mockProvider = {
            streamChat: vi.fn(),
            completePrompt: mockCompletePrompt
        } as any;

        const history: ChatMessage[] = [
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Initial task' },
            ...Array.from({ length: 30 }, (_, i) => ({
                role: 'user' as const,
                content: `[Action read_file(file_${i}.ts) Success]: content ${'A'.repeat(50)}`
            }))
        ];

        const { history: compressed } = await ContextCompressor.compress(history, {
            tokenLimit: 500,
            thresholdRatio: 0.1,
            tailSize: 10,
            provider: mockProvider
        });

        expect(mockCompletePrompt).toHaveBeenCalledTimes(1);
        expect(mockCompletePrompt.mock.calls[0][1].timeoutMs).toBe(300000);
        expect(compressed.some(m => m.content.includes('## Goal\nImplement auth'))).toBe(true);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/context-compressor.test.ts`
Expected: FAIL on Smart Pinning and provider invocation.

- [ ] **Step 3: Implement Smart Pinning and LLM pipeline in `context-compressor.ts`**

Update `ContextCompressor`:
1. Find `latestHumanUserMsg`:
```typescript
    let latestHumanUserMsgIdx = -1;
    for (let i = deduplicatedHistory.length - 1; i >= 0; i--) {
      const msg = deduplicatedHistory[i];
      if (msg.role === 'user' && !msg.content.startsWith('[Action ') && !msg.content.startsWith('[System]') && !msg.content.startsWith('[MEMÓRIA')) {
        latestHumanUserMsgIdx = i;
        break;
      }
    }
```
2. In `pinned`:
   - Keep system prompt (index 0).
   - If `latestHumanUserMsgIdx !== -1`:
     - Keep `deduplicatedHistory[latestHumanUserMsgIdx]` pinned!
     - Exclude `latestHumanUserMsgIdx` from `middle`.
3. In `Phase 1`: run `pruneOldToolResults(middle)`.
4. In `Phase 3`: if `options.provider?.completePrompt`:
   - Call with `buildCompressionUserPrompt(prunedMiddle, options.previousSummary)`.
   - Timeout 300,000 ms.
   - On error or timeout: fall back to `generateDeterministicFallback`.
5. In `Phase 4`: check anti-thrashing: if `summaryText.length >= middleRawLength`, abort. Wrap in `[CONTEXT COMPACTION — REFERENCE ONLY]\n${summaryText}\n\n[END OF COMPACTION]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/context-compressor.test.ts`
Expected: All tests in `context-compressor.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/context-compressor.ts src/core/workflow/context-compressor.test.ts
git commit -m "feat(workflow): implement smart pinning, anti-thrashing and hermes llm summarization in ContextCompressor"
```

---

### Task 4: Integrate Provider & End-to-End Validation

**Files:**
- Modify: `src/core/engine/turn-loop-runner.ts:98-111`
- Modify: `src/core/api/openai-compatible-provider.ts:147-151`
- Modify: `src/core/api/stackspot-provider.ts:112-116`
- Modify: `src/core/engine/agent-slash-commands.ts:90-95`

**Interfaces:**
- Pass `provider: this` (or `context.activeProvider`) into `ContextCompressor.compress()`.

- [ ] **Step 1: Wire active provider into compression calls**

1. In `src/core/engine/turn-loop-runner.ts`:
```typescript
                const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                    tokenLimit: compactionTokenLimit,
                    thresholdRatio: 0.8,
                    tailSize: 15,
                    provider: context.activeProvider
                });
```
2. In `src/core/api/openai-compatible-provider.ts`:
```typescript
        const { history: orchestratedHistory } = await ContextCompressor.compress(rawHistory, {
            tokenLimit: compactionTokenLimit,
            provider: this
        });
```
3. In `src/core/api/stackspot-provider.ts`:
```typescript
            const { history: orchestratedHistory } = await ContextCompressor.compress(rawHistory, {
                tokenLimit: compactionTokenLimit,
                provider: this
            });
```
4. In `src/core/engine/agent-slash-commands.ts`:
Pass `provider: activeProvider` into `/compact`.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All test suites PASS without regressions.

- [ ] **Step 3: Run build to ensure bundle builds cleanly**

Run: `npm run build`
Expected: Build code 0.

- [ ] **Step 4: Commit**

```bash
git add src/core/engine/turn-loop-runner.ts src/core/api/openai-compatible-provider.ts src/core/api/stackspot-provider.ts src/core/engine/agent-slash-commands.ts
git commit -m "feat(engine): wire active LLM provider into context compression across engine and providers"
```
