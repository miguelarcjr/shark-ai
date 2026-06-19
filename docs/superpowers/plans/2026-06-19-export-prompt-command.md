# Export Prompt Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new CLI command `export-prompt` to output the unified system prompt.

**Architecture:** Create `export-prompt.ts` command using commander, test it using vitest, and register it in `shark.ts`.

**Tech Stack:** TypeScript, Node.js, commander, vitest.

## Global Constraints

- All code changes must be written in TypeScript and conform to the project's existing ESLint/Prettier configuration.
- Follow test-driven development (TDD): write the failing test first, verify failure, implement minimum code, verify pass, and commit.
- Preserve all existing comments and docstrings.
- Return exit code 0 on normal CLI execution and exit code 1 on errors.
- Do not add any external third-party library dependencies.

---

### Task 1: Implement export-prompt Command and Tests

**Files:**
- Create: `src/commands/export-prompt.ts`
- Create: `src/commands/export-prompt.test.ts`
- Modify: `src/bin/shark.ts`

**Interfaces:**
- Consumes: `UNIFIED_SYSTEM_PROMPT` from `src/core/api/prompts.ts`
- Produces: `exportPromptCommand` registered as a command in the main CLI.

- [ ] **Step 1: Write the failing test**

Create the file `src/commands/export-prompt.test.ts` with the following content:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { exportPromptCommand } from './export-prompt.js';
import { UNIFIED_SYSTEM_PROMPT } from '../core/api/prompts.js';

describe('Export Prompt Command', () => {
    it('should output the unified system prompt to stdout', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        // Run command action
        exportPromptCommand.parse(['node', 'shark', 'export-prompt']);

        expect(logSpy).toHaveBeenCalledWith(UNIFIED_SYSTEM_PROMPT);

        logSpy.mockRestore();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/commands/export-prompt.test.ts
```
Expected: FAIL because `export-prompt.ts` does not exist yet (import error).

- [ ] **Step 3: Write minimal implementation**

1. Create `src/commands/export-prompt.ts` with the following content:
```typescript
import { Command } from 'commander';
import { UNIFIED_SYSTEM_PROMPT } from '../core/api/prompts.js';

export const exportPromptCommand = new Command('export-prompt')
    .description('Outputs the unified agent system prompt')
    .action(() => {
        console.log(UNIFIED_SYSTEM_PROMPT);
    });
```

2. Register the command in `src/bin/shark.ts` around line 14:
```typescript
import { exportPromptCommand } from '../commands/export-prompt.js';
```
And around line 28:
```typescript
program.addCommand(exportPromptCommand);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/commands/export-prompt.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/commands/export-prompt.ts src/commands/export-prompt.test.ts src/bin/shark.ts
git commit -m "feat(cli): add export-prompt command to output system prompt"
```
