# Nested `.gitignore` Scoping, Source Map Exclusions, and Line Truncation in `search_code` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent LLM context window overflows during code search by properly parsing nested `.gitignore` files (such as `app/.gitignore` with `/dist`), ignoring source maps / minified files, and truncating search result lines exceeding 500 characters.

**Architecture:** 
1. Enhance `IgnoreFilterManager` to normalize leading slashes and properly scope wildcard and rooted rules from nested `.gitignore` files, while expanding default ignores to include `**/*.map`, `**/*.min.js`, and `**/*.bundle.js`.
2. Update `handleSearchCode` in `agent-tools.ts` with synchronized default ignores and per-line truncation (`MAX_LINE_LENGTH = 500`).
3. Validate with unit tests covering nested `.gitignore` configurations, line truncation, and regression test suite.

**Tech Stack:** TypeScript, Node.js (`fast-glob`, `ignore`), Vitest

## Global Constraints

- Never break existing `.gitignore` handling at the root level.
- Keep `MAX_LINE_LENGTH` at 500 characters with `... [truncated remaining X chars]` indicator.
- Do not affect `read_file` when files are directly targeted by path.

---

### Task 1: Fix Nested `.gitignore` Scoping and Add Source Map Ignores in `IgnoreFilterManager`

**Files:**
- Modify: `src/core/utils/ignore-filter.ts:15-64`
- Test: `src/core/utils/ignore-filter.test.ts`

**Interfaces:**
- Consumes: `ignore`, `fast-glob`, `path`, `fs`
- Produces: `IgnoreFilterManager.isIgnored(relativePath: string): boolean`

- [x] **Step 1: Write the failing tests in `ignore-filter.test.ts`**

Add tests for nested `.gitignore` containing leading slashes (e.g., `/dist`, `/build`), wildcard rules, and default `.map` / `.min.js` ignore:

```typescript
    it('should correctly scope nested .gitignore with leading slashes', () => {
        fs.mkdirSync(path.join(testDir, 'app'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'app', '.gitignore'), '/dist\n/build/\n');

        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('app/dist/bundle.js')).toBe(true);
        expect(filter.isIgnored('app/dist')).toBe(true);
        expect(filter.isIgnored('app/build/app.min.js')).toBe(true);
        expect(filter.isIgnored('app/src/index.ts')).toBe(false);
    });

    it('should ignore .map and .min.js files by default', () => {
        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('src/components/Card.js.map')).toBe(true);
        expect(filter.isIgnored('public/vendor.min.js')).toBe(true);
        expect(filter.isIgnored('src/components/Card.tsx')).toBe(false);
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/utils/ignore-filter.test.ts`
Expected: FAIL (because `app/dist/bundle.js` was matched against `app//dist` and `.map` was not in defaultIgnores)

- [x] **Step 3: Update `src/core/utils/ignore-filter.ts`**

Implement normalized rule scoping and add `.map` / `.min.js` to `defaultIgnores`:

```typescript
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
            '**/coverage/**',
            '**/*.map',
            '**/*.min.js',
            '**/*.bundle.js'
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
                        const isNegative = trimmed.startsWith('!');
                        const cleanRule = isNegative ? trimmed.slice(1) : trimmed;
                        const normalizedRule = cleanRule.replace(/^\/+/, '');
                        const prefix = isNegative ? '!' : '';

                        if (cleanRule.startsWith('/')) {
                            this.ig.add(`${prefix}${dir}/${normalizedRule}`);
                        } else {
                            this.ig.add(`${prefix}${dir}/**/${normalizedRule}`);
                            this.ig.add(`${prefix}${dir}/${normalizedRule}`);
                        }
                    }
                }
            }
        } catch {
            // Fallback silently if discovery fails
        }
    }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/utils/ignore-filter.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/utils/ignore-filter.ts src/core/utils/ignore-filter.test.ts
git commit -m "fix: normalize nested gitignore paths and ignore source maps by default"
```

---

### Task 2: Implement Line Truncation and Synced Default Ignores in `handleSearchCode`

**Files:**
- Modify: `src/core/agents/agent-tools.ts:217-267`
- Test: `src/core/agents/agent-tools-search.test.ts`

**Interfaces:**
- Consumes: `IgnoreFilterManager`, `fast-glob`, `fs`, `path`
- Produces: `handleSearchCode(globPattern: string, query: string, isRegex?: boolean): string`

- [x] **Step 1: Write the failing test in `agent-tools-search.test.ts`**

Add test checking that lines longer than 500 characters are truncated:

```typescript
    it('should truncate lines longer than MAX_LINE_LENGTH (500 chars)', () => {
        const longLine = 'const CardInvestimentsComponent = "' + 'A'.repeat(600) + '";';
        fs.writeFileSync(path.join(testDir, 'long_line.ts'), longLine);

        const result = handleSearchCode('temp_test_search', 'CardInvestimentsComponent');
        expect(result).toContain('long_line.ts:1:');
        expect(result).toContain('[truncated remaining');
        expect(result.length).toBeLessThan(700);
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/agent-tools-search.test.ts`
Expected: FAIL (line is not truncated)

- [x] **Step 3: Update `handleSearchCode` in `src/core/agents/agent-tools.ts`**

Add `MAX_LINE_LENGTH = 500`, update `defaultIgnores`, and apply truncation to matched lines:

```typescript
        const MAX_MATCHES = 50;
        const MAX_LINE_LENGTH = 500;
        const MAX_FILE_SIZE_BYTES = 500 * 1024; // skip files > 500KB
...
        const defaultIgnores = [
            '**/node_modules/**',
            '**/.git/**',
            '**/.shark/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**',
            '**/*.map',
            '**/*.min.js',
            '**/*.bundle.js'
        ];
...
                for (let i = 0; i < lines.length; i++) {
                    if (totalMatches >= MAX_MATCHES) break;
                    searchRegex.lastIndex = 0; // reset for 'g' flag
                    if (searchRegex.test(lines[i])) {
                        let lineContent = lines[i].trim();
                        if (lineContent.length > MAX_LINE_LENGTH) {
                            lineContent = lineContent.slice(0, MAX_LINE_LENGTH) + `... [truncated remaining ${lineContent.length - MAX_LINE_LENGTH} chars]`;
                        }
                        results.push(`${filePath}:${i + 1}: ${lineContent}`);
                        totalMatches++;
                    }
                }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/agent-tools-search.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/agents/agent-tools.ts src/core/agents/agent-tools-search.test.ts
git commit -m "feat: truncate long lines and exclude source maps in handleSearchCode"
```

---

### Task 3: Full Vitest Regression Verification

**Files:**
- Test: All test suites (`src/**/*.test.ts`)

- [x] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All tests pass.

- [x] **Step 2: Final commit / push if required**
