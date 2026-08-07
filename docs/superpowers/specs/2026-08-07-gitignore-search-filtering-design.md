# Design Specification: `.gitignore` and `.shark` Exclusion in Search Tools

**Date:** 2026-08-07  
**Status:** Approved  
**Author:** Shark AI Team  

---

## 1. Context & Problem Statement

Currently, Shark AI search tools (`search_file`, `search_code`, and `list_files` in `src/core/agents/agent-tools.ts`) do not respect `.gitignore` rules or exclude the internal `.shark/` working directory.

As a result:
- Searches with patterns like `**/*` or `src/**/*` scan historical run logs, vector embeddings, and temporary files stored inside `.shark/`.
- Searches include files and folders explicitly ignored by project developers in `.gitignore` (e.g., `dist/`, `.env`, temporary logs, node_modules sub-packages).

---

## 2. Goals & Non-Goals

### Goals
- Exclude `.shark/` directory unconditionally from all file search and code search operations.
- Parse and respect root and nested `.gitignore` files across the workspace.
- Provide baseline safety ignores (`.shark`, `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`) even if `.gitignore` is absent.
- Ensure high performance without reading contents of ignored files into memory.

### Non-Goals
- Modifying git commands or shell execution tools (`run_command`).
- Blocking explicit `read_file` calls if the user or agent directly specifies an exact file path that happens to be ignored (e.g., inspecting `.env.example`).

---

## 3. Proposed Architecture

### 3.1 `ignore-filter` Utility (`src/core/utils/ignore-filter.ts`)
A dedicated module that wraps the `ignore` npm package.

```typescript
import ignore, { Ignore } from 'ignore';
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
        // 1. Always enforce critical default ignores
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

        // 2. Discover and parse all .gitignore files (root + nested)
        try {
            const gitignoreFiles = fg.sync('**/.gitignore', {
                cwd: workspaceRoot,
                dot: true,
                ignore: ['**/node_modules/**', '**/.git/**', '**/.shark/**']
            });

            for (const file of gitignoreFiles) {
                const fullPath = path.join(workspaceRoot, file);
                const dir = path.dirname(file);
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split(/\r?\n/);

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;

                    if (dir === '.' || dir === '') {
                        this.ig.add(trimmed);
                    } else {
                        // Scope rules from nested subfolders relative to workspace root
                        const scopedRule = trimmed.startsWith('!')
                            ? `!${dir}/${trimmed.slice(1)}`
                            : `${dir}/${trimmed}`;
                        this.ig.add(scopedRule);
                    }
                }
            }
        } catch {
            // Fallback silently to default ignores if discovery fails
        }
    }

    public isIgnored(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
        return this.ig.ignores(normalized);
    }
}
```

### 3.2 Updating `agent-tools.ts`
Modify search functions in `src/core/agents/agent-tools.ts`:

1. **`handleSearchFile(pattern: string)`**:
   - Query fast-glob: `fg.sync(pattern, { dot: true })`.
   - Filter results through `ignoreManager.isIgnored(entry)`.

2. **`handleSearchCode(globPattern: string, query: string, isRegex: boolean)`**:
   - Query fast-glob for file list.
   - Filter file list through `ignoreManager.isIgnored(filePath)` *before* checking file size or reading file contents into memory.

3. **`handleListFiles(dirPath: string)`**:
   - Filter out items matching `ignoreManager.isIgnored(...)`.

---

## 4. Verification & Testing Plan

1. **Unit Tests**:
   - Create `src/core/utils/ignore-filter.test.ts`:
     - Verify default ignores (`.shark/`, `node_modules/`).
     - Verify root `.gitignore` pattern parsing.
     - Verify nested `.gitignore` pattern scoping.
   - Update `src/core/agents/agent-tools.test.ts`:
     - Test `handleSearchFile` does not return `.shark` files.
     - Test `handleSearchCode` skips `.shark` files and `.gitignore` matches.

2. **Integration Verification**:
   - Execute `handleSearchFile("**/*")` and verify `.shark/` files are completely excluded.
   - Run vitest suite to ensure no regressions across agent execution.

---
