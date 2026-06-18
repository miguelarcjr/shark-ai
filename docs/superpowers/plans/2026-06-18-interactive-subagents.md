# Continuous Interactive Chat & Subagent Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a continuous interactive chat loop in `shark dev` (when run without `-t` or `--task`) and ensure subagents programmatically notify the parent agent upon completion, preventing premature CLI exit.

**Architecture:** 
1. Modify `subagentManager.invokeSubagents` to append a completion message to the parent's mailbox when the subagent's promise resolves.
2. Modify `interactiveDeveloperAgent`'s mailbox checking logic to pull messages for the parent agent (`options.taskId || 'parent'`).
3. Modify `interactiveDeveloperAgent`'s exit conditions: when `TASK_COMPLETED` or `TASK_FAILED` is returned, if the agent is in continuous interactive mode (run without taskInstruction or taskId), log the status, prompt the user for the next input using `promptUser`, and continue the loop.

**Tech Stack:** TypeScript, Node.js, Vitest, Commander.

## Global Constraints
- Do not import external packages unless listed in package.json.
- Maintain existing codebase patterns, using standard ES Modules imports.
- Keep terminal UI prompts consistent with Clack (`@clack/prompts`) interfaces.

---

### Task 1: Subagent Notification to Parent Mailbox

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `SubagentManager.sendMessage`
- Produces: Auto-notification to the parent's mailbox when a subagent task ends.

- [ ] **Step 1: Write the failing test**

Modify `src/core/workflow/subagent-manager.test.ts` to add a test asserting that calling `invokeSubagents` sends a completion message to the parent mailbox.

```typescript
    it('sends notification to parent mailbox on subagent completion', async () => {
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';
        
        // Mock interactiveDeveloperAgent to return a resolved value instantly
        vi.mock('../agents/developer-agent.js', () => ({
            interactiveDeveloperAgent: vi.fn().mockResolvedValue({ success: true, summary: 'Passed test checks' })
        }));

        await subagentManager.invokeSubagents(subagents, parentId);
        
        // Wait briefly for the background promise to resolve
        await new Promise(resolve => setTimeout(resolve, 10));

        const parentMsgs = subagentManager.retrieveMessages(parentId);
        expect(parentMsgs.length).toBe(1);
        expect(parentMsgs[0]).toContain('[Subagent Notification]');
        expect(parentMsgs[0]).toContain('Tester');
        expect(parentMsgs[0]).toContain('Passed test checks');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: Test fails because `sendMessage` is not called with the subagent result inside the invoke promise callback.

- [ ] **Step 3: Write minimal implementation**

In `src/core/workflow/subagent-manager.ts`, update `invokeSubagents` near line 133:

```typescript
                    this.updateSubagentSummary(id, result.summary || 'Completed');
                    this.terminateSubagent(id, result.success);

                    // Notify the parent agent of completion/failure
                    const status = result.success ? 'COMPLETED' : 'FAILED';
                    this.sendMessage(
                        parentId,
                        `[Subagent Notification] Subagent ${sub.Role} (${id}) has finished with status: ${status}. Summary: ${result.summary || 'No summary provided.'}`
                    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: All tests in subagent-manager pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: notify parent mailbox when subagent completes execution"
```

---

### Task 2: Continuous Interactive Loop & Mailbox Retrieval

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `subagentManager.retrieveMessages`, `options.taskInstruction`, `options.taskId`
- Produces: Keeps the agent's interactive terminal loop open when no task is passed upfront.

- [ ] **Step 1: Write the failing test**

In `src/core/agents/developer-agent.test.ts`, add a test to verify that when `taskInstruction` and `taskId` are undefined (interactive mode), receiving a `TASK_COMPLETED:` or `TASK_FAILED:` response prompts the user again and continues the loop rather than exiting.

```typescript
    it('should stay open and prompt the user again on task completion in interactive mode', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: First part done',
                conversation_id: 'conv-interactive-1',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Second part done',
                conversation_id: 'conv-interactive-1',
            });

        // First prompt user reply is "continue conversation", second is cancel to break the loop
        vi.mocked(tui.text)
            .mockResolvedValueOnce('continue conversation')
            .mockResolvedValueOnce('cancel');
        vi.mocked(tui.isCancel)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        const result = await interactiveDeveloperAgent({}); // run in interactive mode

        // Verify the user was prompted multiple times
        expect(tui.text).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ success: true, summary: 'First part done' });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: Test fails or hangs because `interactiveDeveloperAgent` breaks and exits on the first `TASK_COMPLETED:` instead of prompting the user to continue.

- [ ] **Step 3: Write minimal implementation**

In `src/core/agents/developer-agent.ts`:
1. Update mailbox messages check to use `options.taskId || 'parent'`:
```typescript
        // Retrieve incoming mailbox messages for this subagent or parent
        const recipientId = options.taskId || 'parent';
        const mailboxMessages = subagentManager.retrieveMessages(recipientId);
        if (mailboxMessages.length > 0) {
            const mailboxContent = `\n\n✉️ NEW MAILBOX MESSAGES:\n${mailboxMessages.map(m => `- ${m}`).join('\n')}\n`;
            nextPrompt += mailboxContent;
        }
```
2. Update the `TASK_COMPLETED:` and `TASK_FAILED:` handlers to check for interactive mode:
```typescript
            // Handle completion/failure messages
            if (response.message && response.message.includes('TASK_COMPLETED:')) {
                finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                log.success(`✔ Task Completed: ${finalSummary}`);
                
                if (options.taskId) {
                    subagentManager.updateSubagentSummary(options.taskId, finalSummary);
                    keepGoing = false;
                    break;
                }

                if (!options.taskInstruction) {
                    const userReply = await promptUser('Your answer:', undefined, undefined, subagentPrefix);
                    if (tui.isCancel(userReply)) {
                        keepGoing = false;
                        break;
                    }
                    nextPrompt = userReply;
                    continue;
                } else {
                    keepGoing = false;
                    break;
                }
            }

            if (response.message && response.message.includes('TASK_FAILED:')) {
                const failureReason = response.message.split('TASK_FAILED:')[1].trim();
                log.error(`❌ Agent reported task failure: ${failureReason}`);
                
                if (options.taskId) {
                    keepGoing = false;
                    break;
                }

                if (!options.taskInstruction) {
                    const userReply = await promptUser('Your answer:', undefined, undefined, subagentPrefix);
                    if (tui.isCancel(userReply)) {
                        return { success: false, summary: failureReason };
                    }
                    nextPrompt = userReply;
                    continue;
                } else {
                    return { success: false, summary: failureReason };
                }
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat: implement continuous interactive mode loop in developer agent"
```
