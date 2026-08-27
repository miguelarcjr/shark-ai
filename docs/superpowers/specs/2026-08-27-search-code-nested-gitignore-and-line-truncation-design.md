# Design Specification: Nested `.gitignore` Scoping, Source Map Exclusions, and Line Truncation in `search_code`

**Date:** 2026-08-27  
**Status:** Approved  
**Author:** Shark AI Team  

---

## 1. Context & Problem Statement

During code search operations (`search_code`), agents encounter critical failures (crashes, context window overflows, or token limit errors) when searching for symbols that happen to appear in compiled bundles or source maps (e.g. searching for `CardInvestimentsComponent` returning source map VLQ mappings).

### Root Causes
1. **Nested `.gitignore` leading-slash malformation**:
   - In subfolders with `.gitignore` (e.g. `app/.gitignore` containing `/dist` or `/build`), [ignore-filter.ts](file:///d:/projetos/bmadspot/src/core/utils/ignore-filter.ts) concatenated `${dir}/${trimmed}`, producing `app//dist`. The `ignore` library fails to match paths against double slashes (`//`).
2. **Missing Source Maps & Bundles in Default Ignores**:
   - Neither `defaultIgnores` in `IgnoreFilterManager` nor `handleSearchCode` in `agent-tools.ts` excluded `.map` files or minified bundles (`**/*.map`, `**/*.min.js`, `**/*.bundle.js`).
3. **Absence of Character Limit per Line in `search_code`**:
   - While `handleSearchCode` limits matches to 50 lines (`MAX_MATCHES = 50`), it had no character limit per line. A single 400KB source map or minified bundle line containing `"mappings": "..."` is returned entirely, overflowing the LLM prompt context.

---

## 2. Goals & Non-Goals

### Goals
- Properly normalize nested `.gitignore` rules (handling `/dist`, `dist/`, `dist`, and negative rules `!/dist`).
- Add default exclusions for source map files (`**/*.map`), minified scripts (`**/*.min.js`), and bundle outputs.
- Enforce a maximum line length truncation (`MAX_LINE_LENGTH = 500`) in `handleSearchCode` so that long single-line matches never overflow LLM context.
- Ensure automated tests cover nested `.gitignore` with leading slashes, source map filtering, and line truncation.

### Non-Goals
- Altering the behavior of `read_file` when the user explicitly requests to read a specific file.
- Changing regex or glob search semantics beyond safe filtering.

---

## 3. Detailed Technical Solution

### 3.1 Nested `.gitignore` Scoping in `IgnoreFilterManager` (`src/core/utils/ignore-filter.ts`)
Normalize `trimmed` rules to remove leading slashes before prefixing with the subfolder directory:
```typescript
const isNegative = trimmed.startsWith('!');
const cleanRule = isNegative ? trimmed.slice(1) : trimmed;
const normalizedRule = cleanRule.replace(/^\/+/, '');

if (dir === '.' || dir === '') {
    this.ig.add(trimmed);
} else {
    // If the rule had no slashes in cleanRule (e.g., "dist" or "*.log"),
    // gitignore semantics means anywhere inside dir ("app/**/dist", "app/**/*.log")
    // If it started with a slash ("/dist"), it's rooted at "app/dist"
    const prefix = isNegative ? '!' : '';
    if (cleanRule.startsWith('/')) {
        this.ig.add(`${prefix}${dir}/${normalizedRule}`);
    } else {
        this.ig.add(`${prefix}${dir}/**/${normalizedRule}`);
        this.ig.add(`${prefix}${dir}/${normalizedRule}`);
    }
}
```

Add default safety rules for maps and minified assets:
```typescript
const defaultIgnores = [
    '.shark', '**/.shark/**',
    '.git', '**/.git/**',
    'node_modules', '**/node_modules/**',
    'dist', '**/dist/**',
    'build', '**/build/**',
    '.next', '**/.next/**',
    'coverage', '**/coverage/**',
    '**/*.map',
    '**/*.min.js',
    '**/*.bundle.js'
];
```

### 3.2 Safe Line Truncation & Fast-Glob Ignores in `handleSearchCode` (`src/core/agents/agent-tools.ts`)
1. Sync `defaultIgnores` in `handleSearchCode` to include `**/*.map`, `**/*.min.js`, `**/*.bundle.js`.
2. Truncate matching lines exceeding `MAX_LINE_LENGTH = 500`:
```typescript
const MAX_LINE_LENGTH = 500;

for (let i = 0; i < lines.length; i++) {
    if (totalMatches >= MAX_MATCHES) break;
    searchRegex.lastIndex = 0;
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

---

## 4. Verification Plan

### Automated Tests
1. **Unit Tests in `src/core/utils/ignore-filter.test.ts`**:
   - Nested `.gitignore` with `/dist` and `/build`.
   - Nested `.gitignore` with relative rules and wildcards.
   - Exclusion of `*.map` and `*.min.js` files by default.
2. **Unit Tests in `src/core/agents/agent-tools-search.test.ts`**:
   - `handleSearchCode` truncating long lines (> 500 chars).
   - `handleSearchCode` skipping `.map` and ignored nested paths.
3. **Vitest Test Suite Run**:
   - `npm test` / `npx vitest run` to ensure all existing tests pass without regressions.
