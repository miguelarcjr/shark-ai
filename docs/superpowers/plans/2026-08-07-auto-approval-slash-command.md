# Interactive Tool Auto-Approval Slash Command (`/auto`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime slash command `/auto` to toggle tool auto-approval during interactive `shark dev` sessions while preserving continuous prompt interactivity.

**Architecture:** We will update `interactiveDeveloperAgent` in `src/core/agents/developer-agent.ts` to maintain a mutable `autoApproveTools` session variable. The `promptUser` handler will intercept `/auto` input, toggle the variable, log the status via `tui.log.info`, and re-prompt for user instruction. Tool confirmation checks (`modify_file`, `create_file`, `delete_file`, `run_command`) will use `autoApproveTools` while process termination checks remain bound to the initial `options.auto` batch flag.

**Tech Stack:** TypeScript, Node.js, Commander, TUI utilities (`src/ui/tui.ts`), Vitest.

## Global Constraints

- Preserve all existing functionality of `shark dev` and `options.auto` (batch mode).
- Ensure slash command `/auto` works cleanly inside interactive `promptUser` without ending the prompt loop.
- Use TDD and run existing test suite (`npm test`).

---

### Task 1: Add `/auto` Slash Command Interceptor and Tool Auto-Approval Toggle

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts` (or add tests for `/auto` slash command handling)

**Interfaces:**
- Consumes: `tui.log.info`, `tui.confirm` from `src/ui/tui.ts`
- Produces: `autoApproveTools` mutable state inside `interactiveDeveloperAgent` session

- [ ] **Step 1: Write the failing test for `/auto` slash command toggle**

Inspect `src/core/agents/developer-agent.test.ts` to see existing tests, then add a test case verifying `/auto` command handling.

```typescript
// Test case structure to add in developer-agent.test.ts:
it('should toggle autoApproveTools state when /auto is typed in promptUser', async () => {
    // Verify /auto command toggles auto-approval status and logs message
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: FAIL (or missing slash command handling for `/auto`)

- [ ] **Step 3: Implement `/auto` slash command in `developer-agent.ts`**

Update `developer-agent.ts`:

1. Define `isBatchMode` and `autoApproveTools`:
```typescript
const isBatchMode = options.auto || false;
let autoApproveTools = isBatchMode;
```

2. Update `promptUser` in `developer-agent.ts`:
```typescript
while (userReply && userReply.startsWith('/')) {
    let handled = false;
    
    const trimmedReply = userReply.trim();
    if (trimmedReply === '/auto') {
        autoApproveTools = !autoApproveTools;
        if (autoApproveTools) {
            tui.log.info('⚡ Auto-aprovação de ferramentas ATIVADA.');
        } else {
            tui.log.info('🔒 Auto-aprovação de ferramentas DESATIVADA (solicitando confirmações manuais).');
        }
        handled = true;
    }
    
    if (activeOnCommandHandler && !handled) {
        handled = await activeOnCommandHandler(userReply);
    }
    if (!handled && userReply === '/skills') {
        // existing skills logic
        handled = true;
    }
    
    userReply = await tui.text({ 
        message: `${prefix}${message}`, 
        initialValue, 
        placeholder: 'digite a instrução da tarefa...' 
    });
}
```

3. Update tool action approvals in `developer-agent.ts`:
Replace `let approved = isAuto;` with `let approved = autoApproveTools;` for `modify_file`, `create_file`, `delete_file`, and any other action confirmation prompts.

4. Keep loop completion condition using `isBatchMode` (`options.auto`):
Ensure `if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0)` controls process exit so `/auto` toggle never terminates the interactive prompt session.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts docs/superpowers/specs/2026-08-07-auto-approval-slash-command-design.md docs/superpowers/plans/2026-08-07-auto-approval-slash-command.md
git commit -m "feat: add /auto slash command for interactive tool auto-approval"
```
