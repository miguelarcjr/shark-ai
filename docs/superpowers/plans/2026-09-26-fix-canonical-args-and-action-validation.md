# Fix Canonical Arguments Preservation & Action Validation Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the critical argument-stripping bug in canonical assistant serialization and add strict path validation guardrails to prevent infinite loops and false-positive redundant read blocks.

**Architecture:** Update `toCanonicalAssistantMessage` in `src/core/agents/canonical-response.ts` to strictly preserve legitimate tool arguments (especially `path`) across nested and flat action formats while removing only engine metadata. In `src/core/engine/agent-action-executor.ts`, enforce path validation prior to file operations or read counter increments.

**Tech Stack:** TypeScript, Node.js (>=22), Vitest

## Global Constraints

- Never delete legitimate tool arguments (`path`, `query`, `command`, `content`, `arguments`, etc.).
- Strip only runtime metadata (`type`, `isSynthetic`, and empty synthetic `path: ''` on `talk_with_user`).
- Never increment `recentReadCounts` when path validation fails on `read_file`.
- All tests must pass using `npx vitest run`.

---

### Task 1: Preserve Tool Parameters in Canonical Serialization

**Files:**
- Modify: `src/core/agents/canonical-response.ts:28-52`
- Test: `src/core/agents/canonical-response.test.ts:4-74`

**Interfaces:**
- Consumes: `rawOrParsed` input (object or JSON string) in `toCanonicalAssistantMessage(rawOrParsed: any): string`.
- Produces: JSON string matching `CanonicalAssistantResponse` `{ thought: string, action: { type: string, args: Record<string, any> }, summary: string }` with all tool arguments preserved in `args`.

- [ ] **Step 1: Write failing tests in `src/core/agents/canonical-response.test.ts`**

Add tests to `src/core/agents/canonical-response.test.ts` covering:
1. `read_file`, `list_files`, `modify_file` preserving `args.path`.
2. Preserving arbitrary args for other tools (e.g. `query` in `search_code`, `command` in `run_command`).
3. Hoisting top-level `path` into `args.path` when the model outputs flat format (`{ type: "read_file", path: "src/main.ts" }`).
4. Stripping synthetic empty `path: ''` when `type === 'talk_with_user'`.

```typescript
    it('preserves path in action.args for file tools (read_file, list_files, modify_file)', () => {
        const input = {
            thought: 'Reading file',
            action: {
                type: 'read_file',
                args: { path: 'src/routes/index.tsx' }
            },
            summary: 'Reading index'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({ path: 'src/routes/index.tsx' });
    });

    it('hoists top-level action.path into args.path when args is missing', () => {
        const input = {
            thought: 'Listing directory',
            action: {
                type: 'list_files',
                path: 'src/components'
            },
            summary: 'Listing components'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({ path: 'src/components' });
    });

    it('preserves arbitrary tool arguments for commands, search, and MCP tools', () => {
        const input = {
            thought: 'Searching code',
            action: {
                type: 'search_code',
                args: { query: 'export function', path: 'src/**/*', is_regex: false }
            },
            summary: 'Searching'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({
            query: 'export function',
            path: 'src/**/*',
            is_regex: false
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/canonical-response.test.ts`
Expected: FAIL on `preserves path in action.args` due to `delete (rawArgs as any).path;`.

- [ ] **Step 3: Implement minimal fix in `src/core/agents/canonical-response.ts`**

Update `toCanonicalAssistantMessage`:
```typescript
    const type = obj.action?.type || (Array.isArray(obj.actions) && obj.actions[0]?.type) || 'talk_with_user';
    
    const rawArgs = obj.action?.args && typeof obj.action.args === 'object'
        ? { ...obj.action.args }
        : (obj.action && typeof obj.action === 'object' ? { ...obj.action } : {});

    delete (rawArgs as any).type;
    delete (rawArgs as any).isSynthetic;

    // Hoist top-level path into rawArgs if not already present
    if (obj.action?.path !== undefined && rawArgs.path === undefined) {
        rawArgs.path = obj.action.path;
    }

    // Clean synthetic empty path from talk_with_user
    if (type === 'talk_with_user' && rawArgs.path === '') {
        delete (rawArgs as any).path;
    }

    if (obj.action?.content !== undefined && rawArgs.content === undefined) {
        rawArgs.content = obj.action.content;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/canonical-response.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/canonical-response.ts src/core/agents/canonical-response.test.ts
git commit -m "fix(agents): preserve tool arguments and path in canonical assistant responses"
```

---

### Task 2: Strict Path Validation Guardrails in Action Executor

**Files:**
- Modify: `src/core/engine/agent-action-executor.ts:110-188`
- Test: `src/core/engine/agent-action-executor.test.ts`

**Interfaces:**
- Consumes: `action` in `executeAction(action: any): Promise<ExecutionResult>`.
- Produces: `output` message with immediate validation failure `[Action <toolName> Failed]: O parâmetro 'path' é obrigatório.` when `path` is empty or missing, preventing `EISDIR` and redundant read count increments.

- [ ] **Step 1: Write failing tests in `src/core/engine/agent-action-executor.test.ts`**

Add tests for:
1. `read_file` with missing or empty path returns failure and does NOT increment `recentReadCounts`.
2. `create_file`, `modify_file`, `delete_file` with empty path return immediate failure.
3. `list_files` with empty path defaults safely to `'.'`.

```typescript
    it('returns failure when read_file has empty path without incrementing recentReadCounts', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const result1 = await executor.executeAction({ type: 'read_file', args: {} });
        expect(result1.success).toBe(true); // executor wraps tool output
        expect(result1.output).toContain('[Action read_file Failed]: O parâmetro \'path\' é obrigatório');

        // Calling multiple times should not trigger redundant read block
        const result2 = await executor.executeAction({ type: 'read_file', args: { path: '   ' } });
        expect(result2.output).toContain('[Action read_file Failed]: O parâmetro \'path\' é obrigatório');
        expect(result2.output).not.toContain('Leitura redundante bloqueada');
    });

    it('returns failure when create_file, modify_file, or delete_file has empty path', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const rCreate = await executor.executeAction({ type: 'create_file', args: { content: 'test' } });
        expect(rCreate.output).toContain('[Action create_file Failed]: O parâmetro \'path\' é obrigatório');

        const rModify = await executor.executeAction({ type: 'modify_file', args: { content: 'test' } });
        expect(rModify.output).toContain('[Action modify_file Failed]: O parâmetro \'path\' é obrigatório');

        const rDelete = await executor.executeAction({ type: 'delete_file', args: {} });
        expect(rDelete.output).toContain('[Action delete_file Failed]: O parâmetro \'path\' é obrigatório');
    });

    it('defaults list_files to current directory when path is empty or whitespace', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const result = await executor.executeAction({ type: 'list_files', args: { path: '  ' } });
        expect(result.output).toContain('[Action list_files(.) Success]');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: FAIL because `read_file` with empty path currently throws `EISDIR` and increments `recentReadCounts`.

- [ ] **Step 3: Implement validation in `src/core/engine/agent-action-executor.ts`**

In `src/core/engine/agent-action-executor.ts`:
1. In `case 'read_file'`:
```typescript
                case 'read_file': {
                    const filePath = (action.args?.path || action.path || '').trim();
                    if (!filePath) {
                        output = `[Action read_file Failed]: O parâmetro 'path' é obrigatório. Informe o caminho do arquivo a ser lido.`;
                        break;
                    }
                    const readCount = (this.recentReadCounts.get(filePath) || 0) + 1;
                    this.recentReadCounts.set(filePath, readCount);
                    // ... existing logic ...
```
2. In `case 'create_file'`:
```typescript
                case 'create_file': {
                    const filePath = (action.args?.path || action.path || '').trim();
                    if (!filePath) {
                        output = `[Action create_file Failed]: O parâmetro 'path' é obrigatório. Informe o caminho do arquivo a ser criado.`;
                        break;
                    }
                    // ... existing logic ...
```
3. In `case 'modify_file'`:
```typescript
                case 'modify_file': {
                    const filePath = (action.args?.path || action.path || '').trim();
                    if (!filePath) {
                        output = `[Action modify_file Failed]: O parâmetro 'path' é obrigatório. Informe o caminho do arquivo a ser modificado.`;
                        break;
                    }
                    // ... existing logic ...
```
4. In `case 'delete_file'`:
```typescript
                case 'delete_file': {
                    const filePath = (action.args?.path || action.path || '').trim();
                    if (!filePath) {
                        output = `[Action delete_file Failed]: O parâmetro 'path' é obrigatório. Informe o caminho do arquivo a ser excluído.`;
                        break;
                    }
                    // ... existing logic ...
```
5. In `case 'list_files'`:
```typescript
                case 'list_files': {
                    const dirPath = (action.args?.path || action.path || '.').trim() || '.';
                    // ... existing logic ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: All tests in `agent-action-executor.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/agent-action-executor.ts src/core/engine/agent-action-executor.test.ts
git commit -m "fix(engine): add strict path validation guardrails in action executor"
```

---

### Task 3: Full Test Suite Verification & Build Validation

**Files:**
- Entire repository

- [ ] **Step 1: Run entire test suite**

Run: `npm test`
Expected: All test suites PASS without regressions.

- [ ] **Step 2: Run build to ensure bundle builds cleanly**

Run: `npm run build`
Expected: Build finishes with code 0 (`dist/` generated cleanly).
