# Design Specification: Interactive Tool Auto-Approval Slash Command (`/auto`)

**Date:** 2026-08-07  
**Status:** Approved by User  
**Target Component:** `src/core/agents/developer-agent.ts`

---

## 1. Overview

In Shark Dev, when running an interactive session via `shark dev`, the agent currently prompts the user for manual confirmation (`tui.confirm`) before executing mutating actions such as `modify_file`, `create_file`, `delete_file`, or executing system shell commands.

While the `--auto` CLI flag exists, running `shark dev --auto` executes in a batch/non-interactive mode that automatically terminates the CLI session upon task completion, preventing ongoing dialogue.

This feature introduces a runtime slash command `/auto` within interactive `shark dev` sessions. Toggling `/auto` allows users to seamlessly switch tool auto-approval on and off without ending the session or disrupting continuous conversation interactivity.

---

## 2. Key Requirements

1. **Interactive State Toggle:**
   - Typing `/auto` during an interactive prompt toggles tool auto-approval (`autoApproveTools = !autoApproveTools`).
   - The CLI logs a clear notification message on toggle state changes:
     - Enabled: `⚡ Auto-aprovação de ferramentas ATIVADA.`
     - Disabled: `🔒 Auto-aprovação de ferramentas DESATIVADA (solicitando confirmações manuais).`
2. **Preservation of Interactive Session:**
   - The interactive prompt loop (`waitForInputOrNotification`) is preserved continuously regardless of whether `/auto` is active.
   - Upon completion of a turn or task, Shark Dev presents its output and waits for subsequent user input, unlike `--auto` CLI batch mode.
3. **Tool Permission Bypass:**
   - When `autoApproveTools` is `true`, individual confirmation prompts (`tui.confirm`) for file edits (`modify_file`, `create_file`, `delete_file`) and command executions are automatically approved without user prompts.
4. **Scope & Subagents:**
   - The `/auto` command applies strictly to the current interactive developer agent session.
   - Background subagents continue using their standard background execution mode.

---

## 3. Detailed Technical Architecture

### 3.1 Session State Initialization & Scope

Inside `interactiveDeveloperAgent` (`src/core/agents/developer-agent.ts`):

```typescript
// Distinguish between process batch mode (--auto flag) and runtime tool auto-approval (/auto command)
const isBatchMode = options.auto || false;
let autoApproveTools = isBatchMode;
```

### 3.2 Slash Command Interception in `promptUser`

Update the `promptUser` helper function in `developer-agent.ts`:

```typescript
while (userReply && userReply.startsWith('/')) {
    let handled = false;
    
    if (userReply.trim() === '/auto') {
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
        // existing /skills handling...
        handled = true;
    }
    
    // Re-prompt for actual user instruction after handling slash command
    userReply = await tui.text({ 
        message: `${prefix}${message}`, 
        initialValue, 
        placeholder: 'digite a instrução da tarefa...' 
    });
}
```

### 3.3 Tool Execution Confirmation Logic

Update action handlers in `developer-agent.ts` to use `autoApproveTools` instead of the rigid `isAuto` batch flag:

```typescript
// Example for modify_file
let approved = autoApproveTools;
if (!approved) {
    approved = await tui.confirm({ message: `Approve modify_file changes to ${filePath}?` });
}

// Same pattern applies for create_file, delete_file, and command execution prompts
```

### 3.4 Interactive Loop Continuity

The main loop continuation logic checks `isBatchMode` (`options.auto`) rather than `autoApproveTools`, ensuring the session does not exit when `/auto` is enabled interactively:

```typescript
if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
    // Continue waiting for next user message in prompt loop
} else {
    // Batch mode exit
    keepGoing = false;
    break;
}
```

---

## 4. Error Handling & Edge Cases

- **Invalid Slash Commands:** Typing `/auto` with extra spaces or arguments (e.g. `/auto   `) is trimmed and handled cleanly.
- **Cancellation:** Pressing Ctrl+C or cancelling prompt input resets or exits gracefully as in standard mode.
- **CLI Flag Precedence:** If `shark dev --auto` is passed initially, `autoApproveTools` starts `true`. The user can still toggle `/auto` in session if needed.

---

## 5. Verification Plan

1. **Unit & Manual Test:**
   - Launch `shark dev` interactively.
   - Perform a file edit task -> Verify `tui.confirm` prompt appears.
   - Type `/auto` -> Verify log `⚡ Auto-aprovação de ferramentas ATIVADA.` appears.
   - Perform another task involving file modification -> Verify edit is applied automatically without prompting.
   - Verify agent waits for next prompt (interactivity preserved).
   - Type `/auto` again -> Verify log `🔒 Auto-aprovação...` appears and manual prompts resume.
