# Subagent Briefing Error Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch briefing parsing/invocation errors in `invoke_subagent` and return error feedback to the agent model instead of terminating the Shark Dev process.

**Architecture:** Wrap the `invoke_subagent` action handling logic in `developer-agent.ts` with a local `try/catch` block that sets `resultMsg = [Action invoke_subagent Failed]: ${e.message}`, allowing the agent to receive the error feedback and self-correct.

**Tech Stack:** TypeScript, Node.js, Vitest

## Global Constraints

- Preserve all existing interfaces and behavior of `SubagentManager`.
- Follow the existing action error handling pattern used in `list_files`, `search_code`, and `edit_file`.

---

### Task 1: Add Unit Test for `invoke_subagent` Error Recovery

**Files:**
- Modify: `src/core/agents/developer-agent.test.ts:507`

**Interfaces:**
- Consumes: `interactiveDeveloperAgent` from `./developer-agent.js`, `subagentManager.parseTaskBrief`
- Produces: Test assertion verifying `invoke_subagent` error recovery

- [ ] **Step 1: Write the failing test**

Add the following test case to `src/core/agents/developer-agent.test.ts` around line 507:

```typescript
    it('should catch subagent briefing parse errors and feed error message back to agent without crashing', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'invoke_subagent',
                    task_file: '.shark/sdd/invalid-brief.md'
                },
                actions: [],
                message: 'Invoking subagent with bad brief',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'complete_task',
                    content: 'Recovered from invalid brief',
                    summary: 'Handled briefing error successfully',
                },
                actions: [],
                message: 'Task completed',
                conversation_id: 'conv-123',
            });

        vi.spyOn(subagentManager, 'parseTaskBrief').mockImplementation(() => {
            throw new Error('Briefing YAML frontmatter must define both "type" and "role" properties');
        });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-error-task',
            taskInstruction: 'Test subagent error recovery',
            auto: true,
        });

        const secondCallStreamArgs = vi.mocked(mockProvider.streamChat).mock.calls[1][0];
        const lastMessage = secondCallStreamArgs.messages[secondCallStreamArgs.messages.length - 1];
        expect(lastMessage.content).toContain('[Action invoke_subagent Failed]: Briefing YAML frontmatter must define both "type" and "role" properties');
        expect(result).toEqual({ success: true, summary: 'Handled briefing error successfully' });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: FAIL (the unhandled error thrown by `parseTaskBrief` causes `interactiveDeveloperAgent` to crash/fail instead of returning success).

- [ ] **Step 3: Implement local try/catch in `developer-agent.ts`**

Modify `src/core/agents/developer-agent.ts` lines 947-962 to wrap the `invoke_subagent` block in a `try/catch`:

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix(agent): recover gracefully from invoke_subagent briefing errors"
```
