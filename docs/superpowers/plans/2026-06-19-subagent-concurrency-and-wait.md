# Subagent Concurrency and Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `wait` action, dynamic subagent monitoring, real-time log peeking, and clean termination with the new `cancelled` state inside the Shark AI orchestrator.

**Architecture:** Add `wait` and `read_logs` actions to the JSON schema and system prompts. Extend `waitForInputOrNotification` to accept a timeout and interruptible promises. Inject dynamic subagent lists into the turn prompt and use process signals to cleanly terminate subagent subprocesses.

**Tech Stack:** TypeScript, Node.js (`child_process`), Commander.js, Vitest.

## Global Constraints

- Preserve all existing comments and docstrings.
- Return exit code 0 on normal CLI execution and exit code 1 on errors.
- Do not add any external third-party library dependencies.

---

### Task 1: Add new action type 'wait' and custom type 'cancelled' state

**Files:**
- Modify: `src/core/api/prompts.ts`
- Modify: `src/core/workflow/subagent-manager.ts`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: JSON schemas in `prompts.ts` and `SubagentState` in `subagent-manager.ts`.
- Produces: Updated `AGENT_RESPONSE_JSON_SCHEMA` and `SubagentState` with the `'cancelled'` status.

- [ ] **Step 1: Write a failing test for the 'cancelled' status**

Add this test inside `src/core/workflow/subagent-manager.test.ts`:
```typescript
    it('supports cancelled status for terminated subagents', () => {
        const id = 'cancelled-test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester');
        expect(subagentManager.isSubagentActive(id)).toBe(true);
        subagentManager.terminateSubagent(id, false, true); // new parameter or logic
        const state = subagentManager.getSubagentState(id);
        expect(state?.status).toBe('cancelled');
        expect(subagentManager.isSubagentActive(id)).toBe(false);
    });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: FAIL (argument mismatch or status type error)

- [ ] **Step 3: Update SubagentState interface and register/terminate methods**

Modify `src/core/workflow/subagent-manager.ts` lines 9-18:
```typescript
interface SubagentState {
    id: string;
    type: string;
    role: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    summary?: string;
    promise?: Promise<any>;
    parentId?: string;
    childProcess?: any;
}
```

Modify the `terminateSubagent` method in `src/core/workflow/subagent-manager.ts` lines 37-42:
```typescript
    terminateSubagent(id: string, success: boolean = true, isCancelled: boolean = false) {
        const state = this.subagents.get(id);
        if (state) {
            if (isCancelled) {
                state.status = 'cancelled';
            } else {
                state.status = success ? 'completed' : 'failed';
            }
        }
    }
```

- [ ] **Step 4: Update JSON Schema and Prompt descriptions**

Modify `src/core/api/prompts.ts` lines 27-58 and 60-120 to include the `"wait"` option in the actions list and add the `duration_seconds` property.

In `UNIFIED_SYSTEM_PROMPT` action list:
```typescript
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool" | "activate_skill" | "define_subagent" | "invoke_subagent" | "send_message" | "manage_subagents" | "wait",
    "duration_seconds": "tempo máximo em segundos para aguardar atualizações (opcional, wait apenas)",
```

In `AGENT_RESPONSE_JSON_SCHEMA`:
Add `"wait"` to `properties.action.properties.type.enum`.
Add `"duration_seconds"` to `properties.action.properties`:
```json
        "duration_seconds": {
          "type": ["integer", "null"],
          "description": "Tempo maximo em segundos para aguardar atualizacoes."
        },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

Run:
```bash
git add src/core/api/prompts.ts src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: add wait action to prompts schema and cancelled status to subagent state"
```

---

### Task 2: Implement the `wait` handler in `interactiveDeveloperAgent`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `action.type === 'wait'` and `action.duration_seconds`.
- Produces: Blocking loop in `interactiveDeveloperAgent` that resolves on timeout or new mailbox/queue messages.

- [ ] **Step 1: Write a test for the wait functionality with timeout**

Add this test inside `src/core/agents/developer-agent.test.ts`:
```typescript
    it('handles wait action and resolves on timeout', async () => {
        const queue = new MessageQueue();
        const start = Date.now();
        const result = await waitForInputOrNotification(queue, 'Your answer:', '', 100); // 100ms timeout
        const duration = Date.now() - start;
        expect(result.type).toBe('timeout');
        expect(duration).toBeGreaterThanOrEqual(95);
    });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: FAIL (`waitForInputOrNotification` does not handle timeout arguments or return `'timeout'`)

- [ ] **Step 3: Update `waitForInputOrNotification` to handle timeouts**

Modify `src/core/workflow/message-queue.ts` line 1-10 to add `'timeout'` to `QueueMessage.type`:
```typescript
export interface QueueMessage {
    type: 'user' | 'subagent_notification' | 'timeout';
    content: string;
    timestamp: number;
    metadata?: {
        subagentId?: string;
        role?: string;
        status?: 'completed' | 'failed' | 'cancelled';
    };
}
```

Modify `waitForInputOrNotification` in `src/core/agents/developer-agent.ts` lines 44-81:
```typescript
export async function waitForInputOrNotification(
    queue: MessageQueue,
    promptMessage: string = 'Your answer:',
    subagentPrefix: string = '',
    timeoutMs?: number
): Promise<QueueMessage> {
    let cancelled = false;
    let resolvePromptPromise: ((value: QueueMessage) => void) | null = null;
    let timerId: any = null;

    const promptPromise = new Promise<QueueMessage>((resolve) => {
        resolvePromptPromise = resolve;
    });

    const runPrompt = async () => {
        try {
            const userReply = await promptUser(promptMessage, undefined, undefined, subagentPrefix);
            if (!cancelled && resolvePromptPromise) {
                resolvePromptPromise({
                    type: 'user',
                    content: userReply,
                    timestamp: Date.now()
                });
            }
        } catch (e) {}
    };
    runPrompt();

    const queuePromise = queue.next();

    let timeoutPromise = new Promise<QueueMessage>((resolve) => {
        if (timeoutMs !== undefined && timeoutMs !== null) {
            timerId = setTimeout(() => {
                resolve({
                    type: 'timeout',
                    content: 'Wait timeout expired.',
                    timestamp: Date.now()
                });
            }, timeoutMs);
        }
    });

    const winner = await Promise.race([promptPromise, queuePromise, timeoutPromise]);

    if (timerId) {
        clearTimeout(timerId);
    }

    if (winner.type === 'subagent_notification' || winner.type === 'timeout') {
        cancelled = true;
        process.stdin.emit('data', '\r');
        await new Promise(r => setTimeout(r, 50));
        process.stdout.write('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');
    }

    return winner;
}
```

- [ ] **Step 4: Implement the `wait` action handler in the main loop**

Modify `src/core/agents/developer-agent.ts` in the loop action routing (around lines 580-620) to add:
```typescript
            else if (action.type === 'wait') {
                const durationSeconds = action.duration_seconds || 0;
                const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);
                
                let nextMsg: QueueMessage;
                if (!messageQueue.isEmpty()) {
                    nextMsg = await messageQueue.next();
                } else {
                    nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs);
                }

                if (nextMsg.type === 'timeout') {
                    resultMsg = `[System]: Wait duration of ${durationSeconds} seconds expired. No notifications received.`;
                } else if (nextMsg.type === 'user') {
                    if (tui.isCancel(nextMsg.content)) {
                        keepGoing = false;
                        break;
                    }
                    resultMsg = `User Reply: ${nextMsg.content}`;
                } else {
                    resultMsg = nextMsg.content;
                }
            }
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `npx vitest run src/core/agents/developer-agent.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

Run:
```bash
git add src/core/workflow/message-queue.ts src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat: implement wait action handler with interruptible timeout"
```

---

### Task 3: Dynamic Active Subagents Prompt Injection & Logs Reading

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/workflow/subagent-manager.test.ts`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: List of subagents in `subagentManager`.
- Produces:
  - Injection of subagent states into the chat prompt.
  - Sub-action `"read_logs"` inside `manage_subagents`.

- [ ] **Step 1: Write a test for the log reading action**

Add this test inside `src/core/workflow/subagent-manager.test.ts`:
```typescript
    it('reads console logs of a subagent from the filesystem', () => {
        const id = 'log-test-id';
        const projectRoot = process.cwd();
        const historyDir = path.resolve(projectRoot, '_sharkrc', 'history');
        fs.mkdirSync(historyDir, { recursive: true });
        const logFile = path.join(historyDir, `subagent-${id}-console.log`);
        fs.writeFileSync(logFile, "Line 1\nLine 2\nLine 3\n", 'utf-8');

        // Test reading
        const logs = subagentManager.getSubagentLogs(id, 2);
        expect(logs).toContain("Line 2\nLine 3");
        fs.unlinkSync(logFile);
    });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: FAIL (`getSubagentLogs` is not a function)

- [ ] **Step 3: Implement `getSubagentLogs` method**

Add this method to `SubagentManager` in `src/core/workflow/subagent-manager.ts` (around line 140):
```typescript
    getSubagentLogs(id: string, maxLines: number = 50): string {
        const projectRoot = process.cwd();
        const logFile = path.resolve(projectRoot, '_sharkrc', 'history', `subagent-${id}-console.log`);
        if (!fs.existsSync(logFile)) {
            return "No console logs found for this subagent.";
        }
        try {
            const content = fs.readFileSync(logFile, 'utf-8');
            const lines = content.split('\n');
            const tail = lines.slice(-maxLines);
            return tail.join('\n');
        } catch (e: any) {
            return `Failed to read subagent logs: ${e.message}`;
        }
    }
```

- [ ] **Step 4: Update the `manage_subagents` tool handler in developer-agent**

Modify `src/core/agents/developer-agent.ts` (around lines 599-618) inside `action.type === 'manage_subagents'`:
```typescript
                if (subAction === 'read_logs') {
                    const id = ids[0];
                    if (!id) {
                        resultMsg = `[Action manage_subagents Failed]: No subagent ID provided in ConversationIds.`;
                    } else {
                        const logs = subagentManager.getSubagentLogs(id);
                        resultMsg = `[Action manage_subagents Success]: Last log lines for subagent ${id}:\n\`\`\`\n${logs}\n\`\`\``;
                    }
                }
```

- [ ] **Step 5: Inject dynamic active subagent state panel in loop**

Modify `src/core/agents/developer-agent.ts` (around lines 193-200) inside the `while (keepGoing)` loop to construct the active subagents prompt snippet:
```typescript
        // Retrieve incoming mailbox messages for this subagent or parent
        const recipientId = options.taskId || 'parent';
        const mailboxMessages = subagentManager.retrieveMessages(recipientId);
        let currentTurnPrompt = nextPrompt;
        if (mailboxMessages.length > 0) {
            currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${mailboxMessages.map(m => `- ${m}`).join('\n')}\n`;
        }

        // Inject active subagent status panel
        const myId = options.taskId || 'parent';
        const allSubagents = subagentManager.getActiveSubagentsForParent(myId);
        if (allSubagents.length > 0) {
            let panel = `\n\n--- CURRENT ACTIVE SUBAGENTS ---\n`;
            panel += `You have ${allSubagents.length} active subagent(s) running in the background:\n`;
            for (const sub of allSubagents) {
                panel += `- ID: ${sub.id} | Role: ${sub.role} | Status: ${sub.status}\n`;
            }
            panel += `Use the 'wait' action if you have no other work and are waiting for these subagents to complete.\n`;
            panel += `--------------------------------\n`;
            currentTurnPrompt += panel;
        }
```

- [ ] **Step 6: Run tests and verify they pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 7: Commit changes**

Run:
```bash
git add src/core/agents/developer-agent.ts src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: inject dynamic active subagent panel and implement console logs peeking"
```

---

### Task 4: Termination Process Cleanup (SIGTERM and 'cancelled' status)

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/workflow/subagent-manager.test.ts`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `childProcess.kill` signals and parent termination hooks.
- Produces: Clean process SIGTERM exit, status update to `'cancelled'`, and cleanup of child subagents on exit.

- [ ] **Step 1: Write a test verifying that `killSubagent` sets status to cancelled and writes to mailbox**

Add this test inside `src/core/workflow/subagent-manager.test.ts`:
```typescript
    it('sets status to cancelled and notifies mailbox when killSubagent is called', () => {
        const id = 'kill-notify-id';
        const parentId = 'parent-notify';
        subagentManager.registerSubagent(id, 'self', 'Tester', parentId);

        // Mock childProcess with kill
        const mockChild = { kill: vi.fn() };
        const state = subagentManager.getSubagentState(id);
        if (state) {
            state.childProcess = mockChild;
        }

        subagentManager.killSubagent(id);
        expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
        expect(subagentManager.getSubagentState(id)?.status).toBe('cancelled');

        const msgs = subagentManager.retrieveMessages(parentId);
        expect(msgs[0]).toContain('status: CANCELLED');
    });
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: FAIL (does not update status to `cancelled` or notify mailbox on kill)

- [ ] **Step 3: Modify `killSubagent` to send SIGTERM, write to mailbox, and update status**

Modify `killSubagent` in `src/core/workflow/subagent-manager.ts` lines 148-160:
```typescript
    killSubagent(id: string) {
        const state = this.subagents.get(id);
        if (state) {
            if (state.childProcess) {
                try {
                    state.childProcess.kill('SIGTERM');
                } catch (e) {
                    // Ignore
                }
            }
            this.terminateSubagent(id, false, true); // true sets status to 'cancelled'
            
            // Send cancellation notification to parent mailbox
            if (state.parentId) {
                const cancelMsg = `[Subagent Notification] Subagent ${state.role} (${id}) has finished with status: CANCELLED. Summary: Terminated by parent agent.`;
                this.sendMessage(state.parentId, cancelMsg);
            }
        }
    }
```

- [ ] **Step 4: Auto-kill subagents on parent process exit**

Modify `interactiveDeveloperAgent` in `src/core/agents/developer-agent.ts` (around lines 630-664) to wrap execution with a `finally` block or clean up active subagents at the end:
```typescript
    const finalResult = { success: true, summary: finalSummary || "Task completed without summary." };
    if (options.taskId && process.env.SHARK_PARENT_ID) {
        const parentId = process.env.SHARK_PARENT_ID;
        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
        subagentManager.sendMessage(
            parentId,
            `[Subagent Notification] Subagent ${role} (${options.taskId}) has finished with status: COMPLETED. Summary: ${finalResult.summary}`
        );
    }
    
    // Auto terminate active subagents created by this parent to prevent leaks on exit
    const currentId = options.taskId || 'parent';
    const myActiveSubagents = subagentManager.getActiveSubagentsForParent(currentId);
    if (myActiveSubagents.length > 0) {
        log.info(`🧹 Terminating ${myActiveSubagents.length} active child subagent(s) before exit...`);
        for (const sub of myActiveSubagents) {
            subagentManager.killSubagent(sub.id);
        }
    }

    log.success('✅ Task Scope Completed');
    return finalResult;
```

Also, set up a global process listener in `developer-agent.ts` (or command handler) to call `killAllSubagents` if SIGINT is received. Add this inside `interactiveDeveloperAgent`:
```typescript
    const handleSigInt = () => {
        const currentId = options.taskId || 'parent';
        const active = subagentManager.getActiveSubagentsForParent(currentId);
        if (active.length > 0) {
            for (const sub of active) {
                subagentManager.killSubagent(sub.id);
            }
        }
        process.exit(0);
    };
    process.on('SIGINT', handleSigInt);
```
Ensure we remove the listener on success exit so we don't leak process event listeners:
```typescript
    process.off('SIGINT', handleSigInt);
```

- [ ] **Step 5: Run all tests and verify they pass**

Run: `npx vitest run src/core/workflow/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit changes**

Run:
```bash
git add src/core/workflow/subagent-manager.ts src/core/agents/developer-agent.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: implement clean subprocess termination, status cancelled, and parent cleanup on exit"
```
