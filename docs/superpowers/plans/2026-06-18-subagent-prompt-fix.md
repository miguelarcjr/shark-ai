# Subagent Prompt Block Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent subagents from opening interactive keyboard prompts (readline/TUI) when they attempt to use `talk_with_user` or complete tasks, avoiding terminal hijacking and premature exits.

**Architecture:**
1. Modify `interactiveDeveloperAgent`'s `talk_with_user` action handler:
   - If `options.taskId` is defined (subagent mode), do NOT call `promptUser`.
   - Instead, set `finalSummary` to `action.content`, update the subagent summary in the manager, set `keepGoing = false`, and break the loop. This gracefully resolves the subagent execution with the output.
2. In `talk_with_user` action handler, if `action.content` contains `TASK_COMPLETED:`, extract the summary, log it, update the subagent summary (if subagent), and exit or prompt user (if in interactive parent mode) accordingly.

**Tech Stack:** TypeScript, Node.js, Vitest.

## Global Constraints
- Do not import external packages.
- Maintain ES Modules imports.

---

### Task 1: Prevent Subagent Prompts & Handle TASK_COMPLETED in talk_with_user

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `options.taskId`
- Produces: Prevents subagent readline hijack and correctly parses `TASK_COMPLETED:` in action contents.

- [ ] **Step 1: Write the failing test**

In `src/core/agents/developer-agent.test.ts`, add a test to verify that if a subagent receives a `talk_with_user` action, it completes the task and returns its summary without prompting the user.

```typescript
    it('should complete and return summary without prompting if subagent receives talk_with_user', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: {
                type: 'talk_with_user',
                content: 'TASK_COMPLETED: Final subagent result',
            },
            actions: [],
            message: 'Talk to user',
            conversation_id: 'conv-sub-talk-1',
        });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-talk-task',
            auto: true,
        });

        // Verify promptUser/tui.text was never called
        expect(tui.text).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, summary: 'Final subagent result' });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: Test hangs or fails because the subagent calls `tui.text` (mocked) or tries to prompt.

- [ ] **Step 3: Write minimal implementation**

In `src/core/agents/developer-agent.ts` inside the `action.type === 'talk_with_user'` handler:

```typescript
            else if (action.type === 'talk_with_user') {
                const isSystemError = action.content?.startsWith('[SYSTEM ERROR]');
                if (isSystemError) {
                    log.error(`⚠️ Detectado erro na resposta do Agente (truncado ou inválido).`);
                    log.info(colors.dim(action.content || ''));
                    let approved = isAuto;
                    if (!approved) {
                        approved = await tui.confirm({ message: `Enviar notificação de erro para o agente tentar se recuperar automaticamente?` });
                    }
                    if (approved) {
                        resultMsg = action.content || '';
                    } else {
                        const userReply = await promptUser('Seu prompt alternativo para o agente:', undefined, undefined, subagentPrefix);
                        if (tui.isCancel(userReply)) {
                            keepGoing = false;
                            break;
                        }
                        resultMsg = userReply;
                    }
                } else {
                    const contentStr = action.content || '';
                    const hasCompleted = contentStr.includes('TASK_COMPLETED:');
                    
                    if (options.taskId) {
                        // Subagents cannot prompt the user. Treat talk_with_user as completion
                        const summary = hasCompleted ? contentStr.split('TASK_COMPLETED:')[1].trim() : contentStr;
                        subagentManager.updateSubagentSummary(options.taskId, summary);
                        finalSummary = summary;
                        keepGoing = false;
                        break;
                    }

                    if (hasCompleted) {
                        finalSummary = contentStr.split('TASK_COMPLETED:')[1].trim();
                        log.success(`✔ Task Completed: ${finalSummary}`);
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

                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(contentStr);
                    const userReply = await promptUser('Your answer:', undefined, undefined, subagentPrefix);
                    if (tui.isCancel(userReply)) {
                        keepGoing = false;
                        break;
                    }
                    resultMsg = `User Reply: ${userReply}`;
                }
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "fix: prevent subagent prompt blocking and support TASK_COMPLETED in talk_with_user"
```
