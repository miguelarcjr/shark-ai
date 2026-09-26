# Design Spec: Fix Canonical Arguments Preservation & Action Validation Guardrails

- **Date:** 2026-09-26
- **Author:** Shark AI Team
- **Status:** Approved

---

## 1. Problem Statement

During autonomous agent runs, Shark AI experienced fatal looping behavior (e.g. Session `58c40375-61dc-4809-a723-a6a608a78668` in `proximodesafio-lovable`):
1. **Argument stripping in `toCanonicalAssistantMessage`:**
   In `src/core/agents/canonical-response.ts`, a stray `delete (rawArgs as any).path;` was executed on every assistant response before saving to history or building API request payloads. This stripped the `path` argument from all tools (`list_files`, `read_file`, `create_file`, `modify_file`, `delete_file`, `search_file`).
   - `list_files` always defaulted to `.`, making it impossible for the agent to inspect subdirectories.
   - The LLM observed in its own conversation history that `read_file` was called with empty arguments (`args: {}`), causing it to imitate this pattern and emit `read_file` without a path.
2. **Missing path parameter validation in `agent-action-executor.ts`:**
   When `read_file` was called with an empty path, it attempted to read the root directory, throwing `EISDIR: illegal operation on a directory, read`. Furthermore, it incremented `recentReadCounts.get("")`, triggering a false-positive redundant read block: `[Action read_file() Blocked]: Leitura redundante bloqueada...`. This blinded the agent and prevented any subsequent file reads.

---

## 2. Goals & Non-Goals

### Goals
- **Preserve all tool-specific arguments in canonical assistant serialization (`canonical-response.ts`):**
  - Completely remove `delete (rawArgs as any).path;`.
  - Retain all legitimate tool parameters (`path`, `query`, `command`, `content`, `arguments`, `server_name`, etc.).
  - Support both nested `action.args` and flat `action.path` formats produced by diverse LLMs.
  - Strip only internal runtime metadata (`type`, `isSynthetic`, and empty synthetic `path: ''` on `talk_with_user`).
- **Add strict path validation guardrails in `agent-action-executor.ts`:**
  - In `read_file`: Return an immediate error `[Action read_file Failed]: O parâmetro 'path' é obrigatório.` if `path` is empty or missing, *without* incrementing `recentReadCounts`.
  - In `create_file`, `modify_file`, and `delete_file`: Return immediate validation failure if `path` is empty or missing.
  - In `list_files`: Explicitly default empty or whitespace `dirPath` to `'.'`.

### Non-Goals
- Adding circuit breaker / consecutive action loop breaker in `TurnLoopRunner` (deferred to a future release per user decision).
- Modifying tool schemas or altering response JSON schemas.

---

## 3. Technical Design

### 3.1 Canonical Response Serialization (`src/core/agents/canonical-response.ts`)

Update `toCanonicalAssistantMessage` to safely construct `rawArgs`:
```typescript
    const type = obj.action?.type || (Array.isArray(obj.actions) && obj.actions[0]?.type) || 'talk_with_user';
    
    // Resolve clean args from action.args or top-level action properties
    const rawArgs = obj.action?.args && typeof obj.action.args === 'object'
        ? { ...obj.action.args }
        : (obj.action && typeof obj.action === 'object' ? { ...obj.action } : {});

    // Remove runtime engine metadata
    delete (rawArgs as any).type;
    delete (rawArgs as any).isSynthetic;

    // If path was hoisted or set at top-level action but missing in args, preserve it
    if (obj.action?.path !== undefined && rawArgs.path === undefined) {
        rawArgs.path = obj.action.path;
    }

    // Clean synthetic empty path from talk_with_user
    if (type === 'talk_with_user' && rawArgs.path === '') {
        delete (rawArgs as any).path;
    }

    // Consolidate single content field into args.content if missing
    if (obj.action?.content !== undefined && rawArgs.content === undefined) {
        rawArgs.content = obj.action.content;
    }
```

### 3.2 Action Executor Guardrails (`src/core/engine/agent-action-executor.ts`)

#### `read_file`
```typescript
const filePath = (action.args?.path || action.path || '').trim();
if (!filePath) {
    output = `[Action read_file Failed]: O parâmetro 'path' é obrigatório. Informe o caminho do arquivo a ser lido.`;
    break;
}

const readCount = (this.recentReadCounts.get(filePath) || 0) + 1;
this.recentReadCounts.set(filePath, readCount);
// Proceed with reading and redundant read checking
```

#### `create_file`, `modify_file`, `delete_file`
```typescript
const filePath = (action.args?.path || action.path || '').trim();
if (!filePath) {
    output = `[Action ${toolName} Failed]: O parâmetro 'path' é obrigatório.`;
    break;
}
```

#### `list_files`
```typescript
const dirPath = (action.args?.path || action.path || '.').trim() || '.';
```

---

## 4. Verification & Testing

1. **Unit tests in `src/core/agents/canonical-response.test.ts`:**
   - Verify `toCanonicalAssistantMessage` preserves `path` in `read_file`, `list_files`, `modify_file`, etc.
   - Verify `toCanonicalAssistantMessage` preserves all arguments for `run_command`, `search_code`, etc.
   - Verify synthetic empty `path: ''` is stripped for `talk_with_user`.
   - Verify top-level `action.path` is hoisted into `args.path` when `action.args` is absent.
2. **Unit tests in `src/core/engine/agent-action-executor.test.ts`:**
   - Verify `read_file` with empty path returns validation error and does NOT increment `recentReadCounts`.
   - Verify `create_file`, `modify_file`, `delete_file` with empty path return validation errors.
3. **Regression testing:**
   - Run `npm test` (`npx vitest run`) to verify all existing tests pass without regressions.
