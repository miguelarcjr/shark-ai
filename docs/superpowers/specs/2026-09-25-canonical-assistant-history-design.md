# Design Spec: Canonical Assistant History Serialization & Token Bloat Elimination

- **Date:** 2026-09-25
- **Author:** Shark AI Team
- **Status:** Approved

---

## 1. Problem Statement

Across all Shark AI execution modes (CLI `shark dev`, WhatsApp adapter, and other channel runners), LLM assistant responses are parsed by `parseAgentResponse()` into an internal JavaScript runtime representation.

For backward compatibility, this internal object introduces multiple duplicate fields and aliases:
- An array `actions: [action]` mirroring `action`.
- A string `message` mirroring `summary`.
- Internal tracking identifiers like `conversation_id`.
- Duplicate properties inside `action` (e.g., `action.content` duplicating `action.args.content`, `isSynthetic: true`, `path: ''`).

Both `OpenAICompatibleProvider` and `StackSpotProvider` serialize this internal runtime object directly into conversation history (`rawHistory`) using `JSON.stringify(cleanedResponse)`.
When this history is fed into the LLM on subsequent turns, the LLM observes this mirrored structure and begins generating duplicate keys itself in its own outputs.
This bloats both input prompt tokens and output completion tokens, wasting resources and degrading prompt efficiency.

---

## 2. Goals & Non-Goals

### Goals
- Ensure that assistant messages saved to conversation history contain strictly and exclusively the canonical fields defined in the response schema: `thought`, `action` (`type` and `args`), and `summary`.
- Retroactively sanitize any existing conversation history when sending messages to the LLM API, ensuring existing sessions immediately benefit without needing manual database or file deletions.
- Eliminate duplicate aliases (`actions`, `message`, `conversation_id`, redundant `content` keys) from LLM context.
- Maintain full backward compatibility for the internal parser and runtime execution loop (`TurnLoopRunner`, `AgentActionExecutor`).

### Non-Goals
- Changing the internal `AgentResponse` TypeScript interface used by runtime execution loops.
- Altering tool execution logic or tool result formats.

---

## 3. Architecture & Technical Design

### 3.1 Canonical Serialization Function

A dedicated utility function `toCanonicalAssistantMessage(rawOrParsed: any): string` is introduced in `src/core/agents/canonical-response.ts`:

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

    // Resolve action type
    const type = obj.action?.type || (Array.isArray(obj.actions) && obj.actions[0]?.type) || 'talk_with_user';
    
    // Resolve clean args
    const rawArgs = obj.action?.args && typeof obj.action.args === 'object'
        ? { ...obj.action.args }
        : (obj.action && typeof obj.action === 'object' ? { ...obj.action } : {});

    // Remove internal aliases and parser flags from args
    delete (rawArgs as any).type;
    delete (rawArgs as any).isSynthetic;
    delete (rawArgs as any).path;

    // Consolidate single content field into args.content if missing
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

### 3.2 Provider Integration

In both `src/core/api/openai-compatible-provider.ts` and `src/core/api/stackspot-provider.ts`:

1. **When Saving Assistant Responses to History:**
   Use `toCanonicalAssistantMessage(parsedResponse)` to construct the string stored in `rawHistory`.

2. **When Building `requestMessages` (Retroactive Cleanup):**
   When iterating over conversation history:
   ```typescript
   if (msg.role === 'assistant') {
       cleanContent = toCanonicalAssistantMessage(msg.content);
   }
   ```
   This ensures that any preexisting assistant turns in the conversation file are cleaned prior to being dispatched in the API payload.

---

## 4. Verification & Testing

### 4.1 Unit Tests
- Create `src/core/agents/canonical-response.test.ts` testing:
  1. Input with bloated fields (`actions`, `message`, `conversation_id`, `isSynthetic`) -> output strictly has only `thought`, `action: { type, args }`, and `summary`.
  2. Input as raw string vs object.
  3. Non-JSON text fallback.
- Verify `openai-compatible-provider.test.ts` to ensure assistant messages in the request payload and saved history are canonicalized.

### 4.2 Regression Tests
- Run `npx vitest run src/core/api src/core/agents src/core/engine` to guarantee zero regressions across the codebase.
