# Canonical Assistant History Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate token bloat by ensuring assistant responses saved in conversation history and dispatched in LLM API payloads contain strictly the canonical fields (`thought`, `action` with clean `args`, and `summary`), stripping all runtime aliases (`actions`, `message`, `conversation_id`, and redundant `content` properties).

**Architecture:** Create a `toCanonicalAssistantMessage` utility that normalizes any parsed or raw assistant response into a clean JSON string matching the canonical response schema. Integrate this utility in `OpenAICompatibleProvider` and `StackSpotProvider` for both saving to history and sanitizing existing history before dispatching to the LLM API.

**Tech Stack:** Node.js, TypeScript, Vitest.

## Global Constraints

- Preserve all existing comments and docstrings.
- Do not modify the runtime `AgentResponse` interface used by the agent action executors.
- Strictly adhere to TDD: write failing tests first, verify failure, implement minimal code, verify pass, commit.
- Run complete test suites (`src/core/agents`, `src/core/api`, `src/core/engine`) to ensure zero regressions.

---

### Task 1: Create `toCanonicalAssistantMessage` with Comprehensive Unit Tests

**Files:**
- Create: `src/core/agents/canonical-response.ts`
- Test: `src/core/agents/canonical-response.test.ts`

**Interfaces:**
- Produces: `toCanonicalAssistantMessage(rawOrParsed: any): string`
  - Input: Raw JSON string, non-JSON string, or parsed object (with potential runtime aliases like `actions`, `message`, `conversation_id`, `isSynthetic`, etc.).
  - Output: Compact JSON string strictly matching `{ thought, action: { type, args }, summary }`.

- [ ] **Step 1: Write the failing tests in `src/core/agents/canonical-response.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { toCanonicalAssistantMessage } from './canonical-response.js';

describe('toCanonicalAssistantMessage', () => {
    it('strips redundant aliases and produces canonical { thought, action, summary }', () => {
        const bloated = {
            thought: 'Explicação detalhada',
            action: {
                type: 'talk_with_user',
                args: { content: 'Olá usuário!' },
                content: 'Olá usuário!',
                isSynthetic: true,
                path: ''
            },
            actions: [
                {
                    type: 'talk_with_user',
                    args: { content: 'Olá usuário!' },
                    content: 'Olá usuário!'
                }
            ],
            summary: 'Respondi ao usuário',
            message: 'Respondi ao usuário',
            conversation_id: 'conv-12345'
        };

        const result = toCanonicalAssistantMessage(bloated);
        const parsed = JSON.parse(result);

        expect(parsed).toEqual({
            thought: 'Explicação detalhada',
            action: {
                type: 'talk_with_user',
                args: { content: 'Olá usuário!' }
            },
            summary: 'Respondi ao usuário'
        });

        expect(parsed.actions).toBeUndefined();
        expect(parsed.message).toBeUndefined();
        expect(parsed.conversation_id).toBeUndefined();
        expect(parsed.action.content).toBeUndefined();
        expect(parsed.action.isSynthetic).toBeUndefined();
        expect(parsed.action.path).toBeUndefined();
    });

    it('handles JSON string inputs and consolidates action.content into args.content', () => {
        const jsonStr = JSON.stringify({
            thought: 'Test thought',
            action: {
                type: 'talk_with_user',
                content: 'Direct content'
            },
            summary: 'Summary text'
        });

        const result = toCanonicalAssistantMessage(jsonStr);
        const parsed = JSON.parse(result);

        expect(parsed).toEqual({
            thought: 'Test thought',
            action: {
                type: 'talk_with_user',
                args: { content: 'Direct content' }
            },
            summary: 'Summary text'
        });
    });

    it('returns raw text unchanged if input is plain text and not valid JSON', () => {
        const plain = 'Simple plain text response from agent';
        expect(toCanonicalAssistantMessage(plain)).toBe(plain);
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/agents/canonical-response.test.ts`
Expected: FAIL because `src/core/agents/canonical-response.ts` does not exist yet.

- [ ] **Step 3: Implement minimal code in `src/core/agents/canonical-response.ts`**

```typescript
export interface CanonicalAssistantResponse {
    thought: string;
    action: {
        type: string;
        args: Record<string, any>;
    };
    summary: string;
}

export function toCanonicalAssistantMessage(rawOrParsed: any): string {
    let obj = rawOrParsed;
    if (typeof obj === 'string') {
        const trimmed = obj.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return obj;
        }
        try {
            obj = JSON.parse(trimmed);
        } catch {
            return obj;
        }
    }

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return typeof rawOrParsed === 'string' ? rawOrParsed : JSON.stringify(rawOrParsed);
    }

    const type = obj.action?.type || (Array.isArray(obj.actions) && obj.actions[0]?.type) || 'talk_with_user';
    
    const rawArgs = obj.action?.args && typeof obj.action.args === 'object'
        ? { ...obj.action.args }
        : (obj.action && typeof obj.action === 'object' ? { ...obj.action } : {});

    delete (rawArgs as any).type;
    delete (rawArgs as any).isSynthetic;
    delete (rawArgs as any).path;

    if (obj.action?.content !== undefined && rawArgs.content === undefined) {
        rawArgs.content = obj.action.content;
    }

    const canonical: CanonicalAssistantResponse = {
        thought: obj.thought || '',
        action: {
            type,
            args: rawArgs
        },
        summary: obj.summary || obj.message || ''
    };

    return JSON.stringify(canonical);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/agents/canonical-response.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit changes**

```bash
git add src/core/agents/canonical-response.ts src/core/agents/canonical-response.test.ts
git commit -m "feat(agents): add canonical assistant response serializer"
```

---

### Task 2: Integrate Canonical Response in Providers and History Pipeline

**Files:**
- Modify: `src/core/api/openai-compatible-provider.ts`
- Modify: `src/core/api/stackspot-provider.ts`
- Modify: `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: `toCanonicalAssistantMessage` from `../agents/canonical-response.js`
- Produces: Clean assistant messages in both `rawHistory` saves and `requestMessages` sent to LLM APIs.

- [ ] **Step 1: Write failing tests in `src/core/api/openai-compatible-provider.test.ts`**

Add tests to verify:
1. When saving to `HistoryManager`, `role: 'assistant'` is stored as canonical JSON without `actions`, `message`, or `conversation_id`.
2. When building the request payload, preexisting assistant messages in history containing `actions` or `message` are sanitized to canonical format before being sent in `requestPayload.messages`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`
Expected: FAIL because providers still save uncanonicalized responses and do not clean assistant history.

- [ ] **Step 3: Implement minimal code in `openai-compatible-provider.ts` and `stackspot-provider.ts`**

In `src/core/api/openai-compatible-provider.ts`:
1. Import `toCanonicalAssistantMessage` from `../agents/canonical-response.js`.
2. In `streamChat`, when building `requestMessages`, sanitize existing assistant messages:
   ```typescript
   if (msg.role === 'assistant') {
       requestMessages.push({
           role: 'assistant',
           content: toCanonicalAssistantMessage(msg.content)
       });
   }
   ```
3. When saving LLM response to history:
   ```typescript
   const canonicalContent = toCanonicalAssistantMessage(parsedResponse);
   rawHistory.push({ role: 'assistant', content: canonicalContent });
   ```
4. Do the corresponding update in `src/core/api/stackspot-provider.ts`.

- [ ] **Step 4: Run provider tests to verify they pass**

Run: `npx vitest run src/core/api`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite across the workspace**

Run: `npx vitest run src/core/agents src/core/api src/core/engine`
Expected: All tests PASS.

- [ ] **Step 6: Commit changes**

```bash
git add src/core/api/openai-compatible-provider.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.test.ts
git commit -m "feat(api): canonicalize assistant responses in history and request payloads"
```
