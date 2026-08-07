# Search Tools `.gitignore` & `.shark` Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Shark AI search tools (`search_file`, `search_code`, `list_files`) respect `.gitignore` rules across workspace subdirectories and unconditionally exclude the `.shark/` working folder.

**Architecture:** Create an `IgnoreFilterManager` module using the `ignore` npm package to parse root and nested `.gitignore` files alongside default ignore patterns (`.shark`, `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`). Integrate this filter into `src/core/agents/agent-tools.ts`.

**Tech Stack:** TypeScript, Node.js (`node:fs`, `node:path`), `ignore` (^5.3.1), `fast-glob`, `vitest`.

## Global Constraints

- Never mutate `.shark` or user `.gitignore` files during search.
- Fast-glob queries must filter unreadable or ignored paths prior to reading file contents.
- Preserve backward compatibility for explicit `read_file` calls.

---

### Task 1: Add `ignore` Dependency & Implement `IgnoreFilterManager`

**Files:**
- Modify: `package.json`
- Create: `src/core/utils/ignore-filter.ts`
- Test: `src/core/utils/ignore-filter.test.ts`

**Interfaces:**
- Produces: `IgnoreFilterManager` class with `isIgnored(relativePath: string): boolean`.

- [ ] **Step 1: Write the failing unit test for `IgnoreFilterManager`**

Create `src/core/utils/ignore-filter.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { IgnoreFilterManager } from './ignore-filter.js';

describe('IgnoreFilterManager', () => {
    const testDir = path.resolve(process.cwd(), '.vitest_ignore_test');

    beforeEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should ignore default paths like .shark and node_modules even without .gitignore', () => {
        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('.shark/membox/graph.json')).toBe(true);
        expect(filter.isIgnored('node_modules/express/index.js')).toBe(true);
        expect(filter.isIgnored('.git/config')).toBe(true);
        expect(filter.isIgnored('src/index.ts')).toBe(false);
    });

    it('should respect root .gitignore rules', () => {
        fs.writeFileSync(path.join(testDir, '.gitignore'), '*.log\ntmp/\n');
        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('debug.log')).toBe(true);
        expect(filter.isIgnored('tmp/cache.json')).toBe(true);
        expect(filter.isIgnored('src/main.ts')).toBe(false);
    });

    it('should respect nested .gitignore rules', () => {
        fs.mkdirSync(path.join(testDir, 'packages', 'app'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'packages', 'app', '.gitignore'), 'build/\n*.tmp\n');

        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('packages/app/build/output.js')).toBe(true);
        expect(filter.isIgnored('packages/app/cache.tmp')).toBe(true);
        expect(filter.isIgnored('packages/other/cache.tmp')).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/utils/ignore-filter.test.ts`
Expected: FAIL due to missing module `./ignore-filter.js`.

- [ ] **Step 3: Add `ignore` dependency to `package.json` and implement `IgnoreFilterManager`**

Run: `npm install ignore`

Create `src/core/utils/ignore-filter.ts`:
```typescript
import ignore, { type Ignore } from 'ignore';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export class IgnoreFilterManager {
    private ig: Ignore;

    constructor(workspaceRoot: string = process.cwd()) {
        this.ig = ignore();
        this.initialize(workspaceRoot);
    }

    private initialize(workspaceRoot: string): void {
        const defaultIgnores = [
            '.shark',
            '.shark/**',
            '**/.shark/**',
            '.git',
            '**/.git/**',
            'node_modules',
            '**/node_modules/**',
            'dist',
            '**/dist/**',
            'build',
            '**/build/**',
            '.next',
            '**/.next/**',
            'coverage',
            '**/coverage/**'
        ];
        this.ig.add(defaultIgnores);

        try {
            const gitignoreFiles = fg.sync('**/.gitignore', {
                cwd: workspaceRoot,
                dot: true,
                ignore: ['**/node_modules/**', '**/.git/**', '**/.shark/**']
            });

            for (const file of gitignoreFiles) {
                const fullPath = path.join(workspaceRoot, file);
                const dir = path.dirname(file).replace(/\\/g, '/');
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split(/\r?\n/);

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;

                    if (dir === '.' || dir === '') {
                        this.ig.add(trimmed);
                    } else {
                        const scopedRule = trimmed.startsWith('!')
                            ? `!${dir}/${trimmed.slice(1)}`
                            : `${dir}/${trimmed}`;
                        this.ig.add(scopedRule);
                    }
                }
            }
        } catch {
            // Fallback silently if discovery fails
        }
    }

    public isIgnored(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
        return this.ig.ignores(normalized);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/utils/ignore-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add package.json package-lock.json src/core/utils/ignore-filter.ts src/core/utils/ignore-filter.test.ts
git commit -m "feat: implement IgnoreFilterManager to parse gitignore and default ignores"
```

---

### Task 2: Integrate `IgnoreFilterManager` in Search Tools

**Files:**
- Modify: `src/core/agents/agent-tools.ts:164-273`
- Modify: `src/core/agents/agent-tools.test.ts`

**Interfaces:**
- Consumes: `IgnoreFilterManager` from `src/core/utils/ignore-filter.ts`
- Produces: Updated `handleSearchFile`, `handleSearchCode`, and `handleListFiles` filtering out ignored paths.

- [ ] **Step 1: Write failing unit test in `agent-tools.test.ts` for search filtering**

In `src/core/agents/agent-tools.test.ts`, add test cases for `handleSearchFile` and `handleSearchCode`:
```typescript
it('handleSearchFile excludes .shark and gitignored files', () => {
    const result = handleSearchFile('**/*');
    expect(result).not.toContain('.shark');
    expect(result).not.toContain('node_modules');
});

it('handleSearchCode does not search inside .shark directory', () => {
    const result = handleSearchCode('**/*', 'membox', false);
    expect(result).not.toContain('.shark');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/agents/agent-tools.test.ts`
Expected: FAIL (currently `.shark` files or results may match).

- [ ] **Step 3: Integrate `IgnoreFilterManager` into `agent-tools.ts`**

Update `src/core/agents/agent-tools.ts`:
```typescript
import { IgnoreFilterManager } from '../utils/ignore-filter.js';

export function handleSearchFile(pattern: string): string {
    try {
        const ignoreManager = new IgnoreFilterManager();
        const entries = fg.sync(pattern, { dot: true });
        const filteredEntries = entries.filter(e => !ignoreManager.isIgnored(e));

        if (filteredEntries.length === 0) return 'No files found matching pattern.';
        return filteredEntries.slice(0, 50).join('\n');
    } catch (e: any) {
        return `Error searching files: ${e.message}`;
    }
}

export function handleSearchCode(
    globPattern: string,
    query: string,
    isRegex: boolean = false
): string {
    const MAX_MATCHES = 50;
    const MAX_FILE_SIZE_BYTES = 500 * 1024;

    if (!query || query.trim() === '') {
        return "Error: 'query' parameter is required for search_code";
    }

    try {
        let pattern = (globPattern || '**/*').replace(/\\/g, '/').trim();

        if (pattern === '' || pattern === '.' || pattern === './') {
            pattern = '**/*';
        } else {
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
            '**/.shark/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**'
        ];

        const ignoreManager = new IgnoreFilterManager();
        const rawFiles = fg.sync(pattern, { dot: true, absolute: false, ignore: defaultIgnores });
        const files = rawFiles.filter(filePath => !ignoreManager.isIgnored(filePath));

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
                // skip unreadable files
            }
        }

        if (results.length === 0) {
            return `No matches found for "${query}" in files matching "${pattern}"`;
        }

        const limited = totalMatches >= MAX_MATCHES ? ` (limited to ${MAX_MATCHES})` : '';
        return `Found ${totalMatches} match(es) for "${query}" in "${pattern}"${limited}:\n${results.join('\n')}`;

    } catch (e: any) {
        return `Error searching code: ${e.message}`;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/agents/agent-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add src/core/agents/agent-tools.ts src/core/agents/agent-tools.test.ts
git commit -m "feat: integrate gitignore and .shark filtering into handleSearchFile and handleSearchCode"
```

---

### Task 3: Full Test Suite Verification

- [ ] **Step 1: Execute full test suite**

Run: `npm test`
Expected: PASS with 100% passing tests.

- [ ] **Step 2: Commit plan completion**

```bash
git add docs/superpowers/plans/2026-08-07-gitignore-search-filtering.md
git commit -m "docs: add implementation plan for gitignore search filtering"
```
