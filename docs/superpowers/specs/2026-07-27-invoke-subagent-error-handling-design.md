# Design Spec: Subagent Briefing Error Recovery in Developer Agent

## Problem Description

When the `developer-agent` executes an `invoke_subagent` action pointing to an invalid briefing file (e.g., missing file, invalid YAML syntax, or missing mandatory YAML fields `type` and `role`), `subagentManager.parseTaskBrief` throws an unhandled exception.

Because `invoke_subagent` action handling lacked a local `try/catch` block, this error bubbled up to the agent's main execution loop `catch (e)` in `developer-agent.ts`, terminating the agent process immediately. Other action types (such as `list_files`, `edit_file`, `search_code`, etc.) wrap their execution in local `try/catch` blocks and return failure feedback formatted as `[Action <type> Failed]: <message>`, which enables the LLM agent to inspect the error message and self-correct on its next iteration.

## Proposed Architecture & Design

### 1. Local Error Handling in `developer-agent.ts`

In `src/core/agents/developer-agent.ts`, wrap the `task_file` parameter validation, `subagentManager.parseTaskBrief`, and `subagentManager.invokeSubagents` calls inside a local `try/catch` block within the `action.type === 'invoke_subagent'` handler:

```typescript
else if (action.type === 'invoke_subagent') {
    try {
        const taskFile = action.task_file;
        if (!taskFile) {
            throw new Error('Action invoke_subagent requires "task_file" parameter');
        }
        const resolvedPath = path.resolve(process.cwd(), taskFile);
        log.info(`🚀 Invoking subagent from brief: ${resolvedPath}`);
        const parsed = subagentManager.parseTaskBrief(resolvedPath);
        const parentId = options.taskId || 'parent';
        const invoked = await subagentManager.invokeSubagents(
            [{ TypeName: parsed.type, Role: parsed.role, Prompt: parsed.prompt }],
            parentId,
            messageQueue
        );
        resultMsg = `[Action invoke_subagent Success]: Invoked subagent:\n${invoked.map(s => `- ID: ${s.id}, Type: ${s.TypeName}, Role: ${s.Role}`).join('\n')}`;
    } catch (e: any) {
        resultMsg = `[Action invoke_subagent Failed]: ${e.message}`;
    }
}
```

### 2. Self-Correction Flow

1. **Invocation Failure**: Model calls `invoke_subagent` with missing/invalid briefing.
2. **Error Interception**: `catch` captures the error message (e.g., `Briefing YAML frontmatter must define both "type" and "role" properties`).
3. **Feedback to Model**: The system populates `nextPrompt` with `[Action invoke_subagent Failed]: <error_message>`.
4. **Agent Self-Correction**: Model reads the error, modifies or creates the brief markdown file using file tools, and retries `invoke_subagent`.

## Testing & Verification Plan

### Unit Tests
- Add a test case in `src/core/agents/developer-agent.test.ts` where `invoke_subagent` is executed with an invalid briefing file.
- Verify that `runDeveloperAgent` does not crash, and returns `[Action invoke_subagent Failed]: ...` as feedback.

### Verification Commands
- `npx vitest run src/core/agents/developer-agent.test.ts`
