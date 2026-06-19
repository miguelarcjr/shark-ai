# Non-Blocking Subagent Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a non-blocking message queue to handle human inputs and background subagent notifications concurrently in the interactive agent loop of Shark AI.

**Architecture:** Use a Promise-based asynchronous `MessageQueue` to serialize inputs and events. The background child process `'exit'` handler will push notifications directly into this queue. A `Promise.race` wrapper will allow the main loop to await either user input or subagent completions, cancel/clear any active CLI prompt if a subagent finishes first, and feed the notification directly back to the LLM.

**Tech Stack:** Node.js, TypeScript, Vitest, `@clack/prompts`, Commander.js.

## Global Constraints
- All code must be written in TypeScript and adhere to the project's existing ESLint / Prettier rules.
- Test coverage must be implemented using Vitest.
- Follow test-driven development (TDD): write the failing test first, verify failure, implement minimum code, verify pass, and commit.
- Implementation details (complete code) for each task must be placed in scratch files under `docs/superpowers/scratch/task-N-impl.ts` rather than bloating this plan document.

---

### Task 1: Message Queue Implementation

**Files:**
- Create: `src/core/workflow/message-queue.ts`
- Create: `src/core/workflow/message-queue.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  - `QueueMessage` interface
  - `MessageQueue` class with:
    - `push(message: QueueMessage): void`
    - `next(): Promise<QueueMessage>`
    - `isEmpty(): boolean`

- [ ] **Step 1: Write the failing test**

Create the test file `src/core/workflow/message-queue.test.ts` with the following test suite:
```typescript
import { describe, it, expect } from 'vitest';
import { MessageQueue } from './message-queue.js';

describe('MessageQueue', () => {
    it('should handle sequential push and pop', async () => {
        const queue = new MessageQueue();
        queue.push({ type: 'user', content: 'hello', timestamp: 123 });
        const next = await queue.next();
        expect(next.content).toBe('hello');
    });

    it('should block pop until pushed', async () => {
        const queue = new MessageQueue();
        const promise = queue.next();
        queue.push({ type: 'user', content: 'delayed', timestamp: 456 });
        const next = await promise;
        expect(next.content).toBe('delayed');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/workflow/message-queue.test.ts
```
Expected output: FAIL due to missing `./message-queue.js` module.

- [ ] **Step 3: Write minimal implementation**

Consulte o código de implementação de referência em [docs/superpowers/scratch/task-1-impl.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/docs/superpowers/scratch/task-1-impl.ts).
Create `src/core/workflow/message-queue.ts` and write the queue logic.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/workflow/message-queue.test.ts
```
Expected output: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/core/workflow/message-queue.ts src/core/workflow/message-queue.test.ts
git commit -m "feat: implement message queue class with tests"
```

### Task 2: Subagent Manager Event-Driven Integration

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Modify: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes:
  - `MessageQueue` class and `QueueMessage` interface from Task 1.
- Produces:
  - Modified `invokeSubagents` method:
    ```typescript
    async invokeSubagents(
        subagents: Array<{ TypeName: string, Role: string, Prompt: string }>,
        parentId: string,
        parentQueue: MessageQueue
    ): Promise<Array<{ id: string, TypeName: string, Role: string }>>
    ```

- [ ] **Step 1: Write the failing test**

Add the following import and test case to `src/core/workflow/subagent-manager.test.ts`:
```typescript
import { MessageQueue } from './message-queue.js';

// Inside describe('SubagentManager') block:
    it('pushes completion event to parent queue when subagent exits', async () => {
        const queue = new MessageQueue();
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Test prompt' }];
        const parentId = 'parent-1';
        
        await subagentManager.invokeSubagents(subagents, parentId, queue);
        
        const nextMsg = await queue.next();
        expect(nextMsg.type).toBe('subagent_notification');
        expect(nextMsg.metadata?.role).toBe('Tester');
        expect(nextMsg.metadata?.status).toBe('completed');
        expect(nextMsg.content).toContain('Passed test checks');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/workflow/subagent-manager.test.ts
```
Expected output: FAIL due to compilation error (signature of `invokeSubagents` only takes 2 parameters, not 3) or failed assertion if parameters are mocked dynamically.

- [ ] **Step 3: Write minimal implementation**

Consulte o código de implementação de referência em [docs/superpowers/scratch/task-2-impl.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/docs/superpowers/scratch/task-2-impl.ts).
Update `src/core/workflow/subagent-manager.ts` to accept the third argument and push the exit event to `parentQueue`.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/workflow/subagent-manager.test.ts
```
Expected output: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: integrate message queue into subagent manager completion events"
```

### Task 3: Non-Blocking Prompt & Main Loop Integration

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes:
  - `MessageQueue` class and `QueueMessage` interface from Task 1.
  - Updated `invokeSubagents` method from Task 2.
- Produces:
  - Non-blocking loop integration that handles user input and subagent notifications concurrently.

- [ ] **Step 1: Write the failing test**

Add a test case in `src/core/agents/developer-agent.test.ts` that mocks `promptUser` and verifies that when a subagent finishes while the prompt is active, the agent wakes up, clears the prompt, and processes the subagent notification:
```typescript
    it('wakes up from prompt when a subagent completion event is queued', async () => {
        const queue = new MessageQueue();
        
        // Mock promptUser to resolve slowly
        let promptResolved = false;
        const promptPromise = (async () => {
            await new Promise(r => setTimeout(r, 2000));
            promptResolved = true;
            return 'user input';
        })();
        
        // Push subagent completion event in 100ms
        setTimeout(() => {
            queue.push({
                type: 'subagent_notification',
                content: 'Task completed successfully',
                timestamp: Date.now(),
                metadata: { subagentId: 'sub-1', role: 'Tester', status: 'completed' }
            });
        }, 100);

        const result = await waitForInputOrNotification(queue);
        expect(result.type).toBe('subagent_notification');
        expect(result.content).toBe('Task completed successfully');
        expect(promptResolved).toBe(false); // Verified prompt was bypassed/aborted
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/agents/developer-agent.test.ts
```
Expected output: FAIL due to `waitForInputOrNotification` not defined.

- [ ] **Step 3: Write minimal implementation**

Implement the non-blocking prompt racer in `src/core/agents/developer-agent.ts`:
```typescript
import { MessageQueue, QueueMessage } from '../workflow/message-queue.js';

async function waitForInputOrNotification(queue: MessageQueue): Promise<QueueMessage> {
    let cancelled = false;
    let resolvePromptPromise: ((value: QueueMessage) => void) | null = null;

    const promptPromise = new Promise<QueueMessage>((resolve) => {
        resolvePromptPromise = resolve;
    });

    const runPrompt = async () => {
        try {
            const userReply = await promptUser('Your answer:');
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
    const winner = await Promise.race([promptPromise, queuePromise]);

    if (winner.type === 'subagent_notification') {
        cancelled = true;
        process.stdin.emit('data', '\r');
        await new Promise(r => setTimeout(r, 50));
        process.stdout.write('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');
    }

    return winner;
}
```
And update the main loop of `interactiveDeveloperAgent` to initialize `const messageQueue = new MessageQueue();` and pull from it:
```typescript
        let nextMsg: QueueMessage;
        if (!messageQueue.isEmpty()) {
            nextMsg = await messageQueue.next();
        } else {
            nextMsg = await waitForInputOrNotification(messageQueue);
        }
```
Also, pass `messageQueue` to `subagentManager.invokeSubagents`:
```typescript
        const invoked = await subagentManager.invokeSubagents(subagentsToInvoke, parentId, messageQueue);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/agents/developer-agent.test.ts
```
Expected output: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat: integrate non-blocking prompt queue racer into developer agent loop"
```
