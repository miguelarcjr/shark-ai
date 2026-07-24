# VS Code-Style search_code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform `search_code` into a VS Code-style global search tool that defaults to searching the entire workspace with auto-exclusion of build/dependency folders and intelligent path/directory auto-expansion.

**Architecture:** Update `handleSearchCode` in `src/core/agents/agent-tools.ts` to perform path normalization, directory auto-expansion, and glob auto-exclusion (`node_modules`, `.git`, etc.). Update system prompts and JSON schemas in `src/core/api/prompts.ts` and `src/core/agents/developer-agent.ts` to document `is_regex` and optional `path` parameter.

**Tech Stack:** TypeScript, `fast-glob`, Node.js `fs`/`path`, Vitest.

## Global Constraints

- Must normalize backslashes `\` to forward slashes `/`.
- Must ignore `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`.
- `query` parameter is required; empty query must return an error message.
- Full backward compatibility with existing glob searches (e.g. `src/**/*.ts`).

---

### Task 1: Smart Path Normalization & Exclusion in `handleSearchCode`

**Files:**
- Modify: `src/core/agents/agent-tools.ts:186-240`
- Create: `src/core/agents/agent-tools-search.test.ts`

**Interfaces:**
- Consumes: `fg.sync` from `fast-glob`, `fs.existsSync`, `fs.statSync`, `path.resolve`
- Produces: `handleSearchCode(globPattern: string, query: string, isRegex?: boolean): string`

- [ ] **Step 1: Write failing unit tests for handleSearchCode**

Create `src/core/agents/agent-tools-search.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSearchCode } from './agent-tools.js';
import fs from 'fs';
import path from 'path';

describe('handleSearchCode - VS Code Style', () => {
    const testDir = path.resolve(process.cwd(), 'temp_test_search');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        fs.writeFileSync(path.join(testDir, 'sample1.ts'), 'const RedirectAreaConfig = 123;');
        fs.mkdirSync(path.join(testDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'sub', 'sample2.ts'), 'function getRedirectAreaConfig() {}');
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should search recursively when path is "."', () => {
        const result = handleSearchCode('.', 'RedirectAreaConfig');
        expect(result).toContain('Found 2 match(es)');
        expect(result).toContain('sample1.ts');
        expect(result).toContain('sample2.ts');
    });

    it('should search recursively when path is a directory without wildcard', () => {
        const result = handleSearchCode('temp_test_search/sub', 'RedirectAreaConfig');
        expect(result).toContain('Found 1 match(es)');
        expect(result).toContain('sample2.ts');
    });

    it('should return error when query is empty', () => {
        const result = handleSearchCode('temp_test_search', '');
        expect(result).toBe("Error: 'query' parameter is required for search_code");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/agent-tools-search.test.ts`
Expected: FAIL (because `.` currently fails to recurse into subdirectories).

- [ ] **Step 3: Update handleSearchCode implementation**

Modify `src/core/agents/agent-tools.ts` around line 186:

```typescript
export function handleSearchCode(
    globPattern: string,
    query: string,
    isRegex: boolean = false
): string {
    const MAX_MATCHES = 50;
    const MAX_FILE_SIZE_BYTES = 500 * 1024; // skip files > 500KB

    if (!query || query.trim() === '') {
        return "Error: 'query' parameter is required for search_code";
    }

    try {
        // 1. Normalize slashes
        let pattern = (globPattern || '**/*').replace(/\\/g, '/').trim();

        // 2. Default to **/* if empty or "."
        if (pattern === '' || pattern === '.' || pattern === './') {
            pattern = '**/*';
        } else {
            // Check if pattern is a directory or lacks wildcards
            const fullPath = path.resolve(process.cwd(), pattern);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                pattern = pattern.endsWith('/') ? `${pattern}**/*` : `${pattern}/**/*`;
            } else if (!pattern.includes('*') && !pattern.includes('?') && !fs.existsSync(fullPath)) {
                pattern = `${pattern}/**/*`;
            }
        }

        const defaultIgnores = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**'
        ];

        const files = fg.sync(pattern, { dot: true, absolute: false, ignore: defaultIgnores });
        if (files.length === 0) return `No files found matching pattern: "${pattern}"`;

        let searchRegex: RegExp;
        try {
            searchRegex = isRegex
                ? new RegExp(query, 'gi')
                : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        } catch {
            return `Error: Invalid regex pattern: "${query}"`;
        }

        const results: string[] = [];
        let totalMatches = 0;

        for (const filePath of files) {
            if (totalMatches >= MAX_MATCHES) break;

            try {
                const fullPath = path.resolve(process.cwd(), filePath);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() || stats.size > MAX_FILE_SIZE_BYTES) continue;

                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    if (totalMatches >= MAX_MATCHES) break;
                    searchRegex.lastIndex = 0;
                    if (searchRegex.test(lines[i])) {
                        results.push(`${filePath}:${i + 1}: ${lines[i].trim()}`);
                        totalMatches++;
                    }
                }
            } catch {
                // skip unreadable files silently
            }
        }

        if (results.length === 0) {
            return `No matches found for "${query}" in files matching "${pattern}"`;
        }

        const limited = totalMatches >= MAX_MATCHES ? ` (limited to ${MAX_MATCHES})` : '';
        return `Found ${totalMatches} match(es) for "${query}" in "${pattern}"${limited}:\n${results.join('\n')}`;
    } catch (e: any) {
        return `Error executing search_code: ${e.message}`;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/agent-tools-search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/agent-tools.ts src/core/agents/agent-tools-search.test.ts
git commit -m "feat(agent-tools): auto-expand directory paths and add default exclusions for search_code"
```

---

### Task 2: System Prompt & Response JSON Schema Updates

**Files:**
- Modify: `src/core/api/prompts.ts:44-59`, `src/core/api/prompts.ts:80-92`, `src/core/api/prompts.ts:130-185`
- Modify: `src/core/agents/developer-agent.ts:804-815`
- Modify: `src/core/agents/developer-agent.test.ts:360-370`

**Interfaces:**
- Consumes: `COORDINATOR_SYSTEM_PROMPT`, `SUBAGENT_SYSTEM_PROMPT`, `COORDINATOR_RESPONSE_JSON_SCHEMA`, `SUBAGENT_RESPONSE_JSON_SCHEMA`
- Produces: Updated prompt descriptions and schemas supporting `is_regex` and default `**/*` fallback.

- [ ] **Step 1: Update developer-agent.ts handler fallback**

In `src/core/agents/developer-agent.ts` line 805:
```typescript
else if (action.type === 'search_code') {
    const glob = action.path || '**/*';
    const query = action.query || '';
    const isRegex = action.is_regex === true;
    log.info(`🔎 Search code: ${colors.dim(`"${query}" in ${glob}`)}`);
    try {
        const result = handleSearchCode(glob, query, isRegex);
        resultMsg = `[Action search_code("${query}" in "${glob}") Success]:\n${result}`;
    } catch (e: any) {
        resultMsg = `[Action search_code("${query}" in "${glob}") Failed]: ${e.message}`;
    }
}
```

- [ ] **Step 2: Update prompts.ts documentation and JSON schema**

In `src/core/api/prompts.ts`:
Update prompt descriptions for `search_code`:
```typescript
"query": "termo ou regex de busca (search_code obrigatorio)",
"path": "opcional - filtro de arquivo/pasta ou glob (ex: 'src/core', '*.ts'). Se omitido, busca no projeto inteiro.",
"is_regex": "boolean opcional - trata query como RegExp se true"
```
And add `"is_regex": { "type": ["boolean", "null"] }` to `COORDINATOR_RESPONSE_JSON_SCHEMA` and `SUBAGENT_RESPONSE_JSON_SCHEMA` under `action.properties`.

- [ ] **Step 3: Run full developer agent test suite**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/api/prompts.ts src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(prompts): document is_regex and global workspace search fallback for search_code"
```
