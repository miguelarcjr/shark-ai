# Search Code VS Code-Style Enhancement Design

## Context & Motivation
Currently, the `search_code` tool in Shark Dev requires a specific `path` or glob pattern. When models pass a directory path such as `path: "."` or `path: "src/core"`, `fast-glob` attempts an exact match on that literal path without performing a recursive search. Furthermore, if `path` is omitted, the tool defaults to `src/**/*`, ignoring root files and directories outside `src/`.

To provide a seamless search experience similar to VS Code's global search, `search_code` should require only a `query` by default, searching the entire workspace recursively while auto-excluding common heavy or non-source folders (`node_modules`, `.git`, `dist`, `build`, etc.). Specific path or glob filtering should be entirely optional.

## Proposed Changes

### 1. Tool Interface & Behavior (`search_code`)

#### Inputs
- `query` *(string, required)*: The string or regular expression pattern to search for across files.
- `path` *(string, optional)*: Optional file path, directory path, or glob pattern to restrict the search.
  - If omitted, `null`, empty string `""`, or `"."` $\rightarrow$ searches the entire workspace (`**/*`).
  - If pointing to an existing file $\rightarrow$ searches strictly within that file.
  - If pointing to a directory (or lacking glob wildcard characters `*`, `?`) $\rightarrow$ auto-expands to a recursive glob (`<path>/**/*`).
- `is_regex` *(boolean, optional)*: Treats `query` as a regular expression pattern if `true` (default: `false`).

#### Automatic Exclusions
`fast-glob` will be configured with a default `ignore` array:
`['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/coverage/**']`

#### Query Validation
If `query` is missing or empty, `handleSearchCode` will return a helpful error message instead of performing a blank regex match across all lines:
`[Action search_code Failed]: 'query' parameter is required.`

### 2. Code Changes

#### `src/core/agents/agent-tools.ts`
Modify `handleSearchCode(globPattern: string, query: string, isRegex: boolean)`:
1. Normalize path separators (`\` $\rightarrow$ `/`).
2. Implement smart glob resolution:
   - If `!globPattern` or `globPattern === '.'` or `globPattern === './'`: set pattern to `**/*`.
   - If `fs.existsSync(globPattern)` and `fs.statSync(globPattern).isDirectory()` (or pattern does not contain `*`/`?` and isn't a file): append `/**/*`.
3. Pass default `ignore` patterns to `fg.sync(...)`.
4. Validate non-empty `query`.

#### `src/core/agents/developer-agent.ts`
Update the `search_code` action handler:
- Default `action.path` to `**/*` (or pass raw `action.path` to `handleSearchCode` for smart resolution).
- Pass `action.is_regex` to `handleSearchCode`.

#### `src/core/api/prompts.ts`
- Update `COORDINATOR_SYSTEM_PROMPT` and `SUBAGENT_SYSTEM_PROMPT`:
  - Clearly document that `search_code` searches the entire project by default given only `query`.
  - Document optional `path` and `is_regex` parameters.
- Update `COORDINATOR_RESPONSE_JSON_SCHEMA` and `SUBAGENT_RESPONSE_JSON_SCHEMA`:
  - Add `is_regex` boolean property under `action.properties`.

#### `src/core/agents/agent-tools.test.ts`
Add unit tests for `handleSearchCode`:
- Test searching entire workspace when `path` is omitted or `"."`.
- Test directory auto-expansion (`path: "src/core"` $\rightarrow$ `src/core/**/*`).
- Test searching single file.
- Test regex search mode (`is_regex: true`).
- Test empty query error handling.

## Verification Plan
1. Run unit test suite: `npx vitest run src/core/agents/agent-tools.test.ts`
2. Run full developer agent tests: `npx vitest run src/core/agents/developer-agent.test.ts`
