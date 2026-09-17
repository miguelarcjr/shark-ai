# Esc Interrupt Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement instant execution interruption via the `Esc` key in `shark dev`, aborting in-flight LLM streams, running commands, and subagents while preserving conversation history and returning directly to the interactive prompt.

**Architecture:** Create an `InterruptManager` in `src/core/terminal/interrupt-manager.ts` that activates a raw mode `stdin` listener for single-byte `Esc` during execution turns and exposes an `AbortSignal`. Propagate this signal through `provider.interface.ts`, `stackspot-provider.ts`, `sse-client.ts`, `openai-compatible-provider.ts`, and `agent-tools.ts`. Catch aborts in `developer-agent.ts`, log the interruption into conversation history, and transition immediately to `waitForInputOrNotification` without terminating the process.

**Tech Stack:** TypeScript, Node.js (`process.stdin.setRawMode`, `AbortController`, `execa`), Vitest.

## Global Constraints

- Never break non-TTY / CI environments: check `process.stdin.isTTY` before enabling raw mode.
- Single Esc only: do not abort on multi-byte ANSI sequences like arrow keys (`\u001b[A`).
- Preserve `Ctrl+C`: byte `\u0003` must still terminate the process immediately (`process.exit(130)`).
- Preserve active conversation ID and history across interruptions.
- Restore terminal raw mode state before prompting for user input.

---

### Task 1: Create `InterruptManager` with ANSI Filtering and Raw Mode Management

**Files:**
- Create: `src/core/terminal/interrupt-manager.ts`
- Test: `src/core/terminal/interrupt-manager.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export class InterruptManager {
      start(onInterrupt?: () => void): AbortSignal;
      stop(): void;
      isInterrupted(): boolean;
      getSignal(): AbortSignal;
  }
  ```

- [x] **Step 1: Write the failing tests for `InterruptManager`**

```typescript
// src/core/terminal/interrupt-manager.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InterruptManager } from './interrupt-manager.js';
import { EventEmitter } from 'node:events';

describe('InterruptManager', () => {
    let mockStdin: EventEmitter & { isTTY?: boolean; setRawMode?: any; resume?: any; pause?: any };

    beforeEach(() => {
        mockStdin = new EventEmitter() as any;
        mockStdin.isTTY = true;
        mockStdin.setRawMode = vi.fn();
        mockStdin.resume = vi.fn();
        mockStdin.pause = vi.fn();
    });

    it('should trigger interrupt on single Esc key (27)', () => {
        const manager = new InterruptManager(mockStdin as any);
        const onInterrupt = vi.fn();
        const signal = manager.start(onInterrupt);

        expect(signal.aborted).toBe(false);
        expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);

        // Emit single Esc byte
        mockStdin.emit('data', Buffer.from([27]));

        expect(manager.isInterrupted()).toBe(true);
        expect(signal.aborted).toBe(true);
        expect(onInterrupt).toHaveBeenCalledTimes(1);
        expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('should NOT trigger interrupt on multi-byte ANSI escape sequence (e.g. arrow keys)', () => {
        const manager = new InterruptManager(mockStdin as any);
        const onInterrupt = vi.fn();
        const signal = manager.start(onInterrupt);

        // Arrow Up is \x1b[A -> [27, 91, 65]
        mockStdin.emit('data', Buffer.from([27, 91, 65]));

        expect(manager.isInterrupted()).toBe(false);
        expect(signal.aborted).toBe(false);
        expect(onInterrupt).not.toHaveBeenCalled();

        manager.stop();
    });

    it('should be safe in non-TTY environments', () => {
        mockStdin.isTTY = false;
        const manager = new InterruptManager(mockStdin as any);
        const signal = manager.start();

        expect(mockStdin.setRawMode).not.toHaveBeenCalled();
        expect(signal.aborted).toBe(false);
        manager.stop();
    });

    it('should terminate process on Ctrl+C (3)', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const manager = new InterruptManager(mockStdin as any);
        manager.start();

        mockStdin.emit('data', Buffer.from([3]));

        expect(exitSpy).toHaveBeenCalledWith(130);
        exitSpy.mockRestore();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/terminal/interrupt-manager.test.ts`  
Expected: FAIL (module not found)

- [x] **Step 3: Implement `InterruptManager`**

```typescript
// src/core/terminal/interrupt-manager.ts
export class InterruptManager {
    private stdin: NodeJS.ReadStream;
    private abortController: AbortController | null = null;
    private interrupted: boolean = false;
    private dataHandler: ((data: Buffer) => void) | null = null;
    private wasRaw: boolean = false;

    constructor(stdinStream: NodeJS.ReadStream = process.stdin) {
        this.stdin = stdinStream;
    }

    public start(onInterrupt?: () => void): AbortSignal {
        this.abortController = new AbortController();
        this.interrupted = false;

        if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
            try {
                this.wasRaw = Boolean((this.stdin as any).isRaw);
                this.stdin.setRawMode(true);
                if (typeof this.stdin.resume === 'function') {
                    this.stdin.resume();
                }

                this.dataHandler = (data: Buffer) => {
                    if (data.length === 1 && data[0] === 3) {
                        // Ctrl+C
                        this.stop();
                        process.exit(130);
                    }

                    // Single Esc byte (27 / \x1b)
                    if (data.length === 1 && data[0] === 27) {
                        if (!this.interrupted) {
                            this.interrupted = true;
                            this.stop();
                            if (this.abortController) {
                                this.abortController.abort();
                            }
                            if (onInterrupt) {
                                onInterrupt();
                            }
                        }
                    }
                };

                this.stdin.on('data', this.dataHandler);
            } catch {
                // Ignore raw mode errors in environments that mimic TTY
            }
        }

        return this.abortController.signal;
    }

    public stop(): void {
        if (this.dataHandler) {
            this.stdin.removeListener('data', this.dataHandler);
            this.dataHandler = null;
        }

        if (this.stdin.isTTY && typeof this.stdin.setRawMode === 'function') {
            try {
                this.stdin.setRawMode(false);
            } catch {
                // Ignore errors resetting raw mode
            }
        }
    }

    public isInterrupted(): boolean {
        return this.interrupted;
    }

    public getSignal(): AbortSignal {
        if (!this.abortController) {
            this.abortController = new AbortController();
        }
        return this.abortController.signal;
    }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/terminal/interrupt-manager.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/terminal/interrupt-manager.ts src/core/terminal/interrupt-manager.test.ts
git commit -m "feat(terminal): add InterruptManager for Esc key handling and raw mode control"
```

---

### Task 2: Propagate `AbortSignal` to Providers, SSE Client, and `handleRunCommand`

**Files:**
- Modify: `src/core/api/provider.interface.ts:3-16`
- Modify: `src/core/api/sse-client.ts:18-35`
- Modify: `src/core/api/stackspot-provider.ts:192-205`
- Modify: `src/core/api/openai-compatible-provider.ts:230-245`
- Modify: `src/core/agents/agent-tools.ts:327-377`
- Test: `src/core/api/stackspot-provider.test.ts`

**Interfaces:**
- Consumes: `signal?: AbortSignal` from `ChatOptions`
- Produces: `killActiveCommand(): void` in `agent-tools.ts` and `signal` passed to `fetch` calls.

- [x] **Step 1: Add `signal?: AbortSignal` to `ChatOptions`**

Update `src/core/api/provider.interface.ts`:
```typescript
export interface ChatOptions {
    onChunk?: (chunk: string) => void;
    onComplete?: (response: AgentResponse) => void;
    conversationId?: string;
    agentType: 'developer_agent';
    searchQuery?: string;
    systemPrompt?: string;
    hasMcpServers?: boolean;
    signal?: AbortSignal;
}
```

- [x] **Step 2: Support `signal` in `SSEClient`**

Update `streamAgentResponse` in `src/core/api/sse-client.ts`:
```typescript
    async streamAgentResponse(
        url: string,
        requestPayload: unknown,
        headers: HeadersInit,
        callbacks: SSECallbacks = {},
        signal?: AbortSignal
    ): Promise<void> {
        // ...
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload),
            signal
        });
```

- [x] **Step 3: Pass `options.signal` in `StackSpotProvider` and `OpenAICompatibleProvider`**

In `src/core/api/stackspot-provider.ts`:
```typescript
        await sseClient.streamAgentResponse(
            agentUrl,
            requestPayload,
            headers,
            { ...callbacks },
            options.signal
        );
```

In `src/core/api/openai-compatible-provider.ts`:
```typescript
        const res = await fetch(`${this.options.baseURL}/chat/completions`, {
            method: 'POST',
            headers: { ...headers },
            body: JSON.stringify(payload),
            signal: options.signal
        });
```

- [x] **Step 4: Expose `killActiveCommand` in `agent-tools.ts`**

Update `src/core/agents/agent-tools.ts`:
```typescript
let currentRunningShell: ExecaChildProcess | null = null;

export function killActiveCommand(): void {
    if (currentRunningShell) {
        try {
            currentRunningShell.kill('SIGTERM');
        } catch {}
        currentRunningShell = null;
    }
}

export async function handleRunCommand(command: string): Promise<string> {
    try {
        tui.log.info(`💻 Executing: ${colors.dim(command)}`);

        if (!nextShellProcess) {
            prewarmShell();
        }
        const currentShell = nextShellProcess!;
        currentRunningShell = currentShell;

        // Pre-warm the next process immediately in background
        prewarmShell();

        currentShell.stdin?.write(`${command}\nexit\n`);

        const { stdout, stderr } = await currentShell;
        currentRunningShell = null;
        const output = stdout.trim() || stderr.trim();
        return output || 'Command executed successfully (no output).';
    } catch (e: any) {
        currentRunningShell = null;
        if (e.isCanceled || e.killed) {
            return `Command aborted by user.`;
        }
        return `Error executing command: ${e.message}`;
    }
}
```

- [x] **Step 5: Run existing tests to ensure compatibility**

Run: `npx vitest run src/core/api/`  
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/core/api/provider.interface.ts src/core/api/sse-client.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts src/core/agents/agent-tools.ts
git commit -m "feat(api): propagate AbortSignal to streamChat and expose killActiveCommand"
```

---

### Task 3: Integrate `InterruptManager` into `interactiveDeveloperAgent` Loop

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `InterruptManager`, `killActiveCommand`, `subagentManager.killSubagent`
- Produces: Clean interruption handling with warning message, history persistence, and immediate prompt recovery.

- [x] **Step 1: Write integration test for interruption in `developer-agent.test.ts`**

Add test case to `src/core/agents/developer-agent.test.ts`:
```typescript
it('should handle user Esc abort cleanly, log notice in history and return to prompt', async () => {
    let callCount = 0;
    mockProvider.streamChat = vi.fn().mockImplementation(async (_prompt, opts) => {
        callCount++;
        if (callCount === 1) {
            // Simulate AbortError triggered by Esc
            const err: any = new Error('The user aborted a request.');
            err.name = 'AbortError';
            throw err;
        }
        return {
            message: 'TASK_COMPLETED: Done after correction',
            actions: []
        };
    });

    vi.mocked(tui.text)
        .mockResolvedValueOnce('Initial task')
        .mockResolvedValueOnce('Corrective instruction after abort');

    const result = await interactiveDeveloperAgent({
        taskInstruction: 'Initial task'
    });

    expect(result.success).toBe(true);
    // Verify that HistoryManager saved the abort record
    const history = await HistoryManager.getRawHistory(expect.any(String));
    const abortMessage = history.find(m => m.content.includes('Execução interrompida pelo usuário via Esc'));
    expect(abortMessage).toBeDefined();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "handle user Esc abort cleanly"`  
Expected: FAIL

- [x] **Step 3: Integrate `InterruptManager` into `developer-agent.ts`**

1. Import `InterruptManager` and `killActiveCommand`:
   ```typescript
   import { InterruptManager } from '../terminal/interrupt-manager.js';
   import { killActiveCommand } from './agent-tools.js';
   ```

2. Wrap the execution phase in the `while (keepGoing)` loop with `InterruptManager`:
   ```typescript
   const interruptManager = new InterruptManager();
   const abortSignal = interruptManager.start(() => {
       spinner.stop('🛑 Execução interrompida pelo usuário.');
       tui.log.warning('Interrupção solicitada via Esc. Cancelando operações...');
       killActiveCommand();

       const currentId = options.taskId || 'parent';
       const activeSubagents = subagentManager.getActiveSubagentsForParent(currentId);
       for (const sub of activeSubagents) {
           subagentManager.killSubagent(sub.id);
       }
   });

   try {
       // Pass abortSignal to provider:
       const response = await provider.streamChat(promptToSend, {
           conversationId: activeConversationId,
           agentType: 'developer_agent',
           searchQuery: nextPrompt,
           systemPrompt: dynamicSystemPrompt,
           hasMcpServers: mcpTools.length > 0,
           signal: abortSignal,
           onChunk: () => {}
       });

       interruptManager.stop();
       // ... continue normal action execution ...
   } catch (error: any) {
       interruptManager.stop();

       if (error.name === 'AbortError' || interruptManager.isInterrupted()) {
           spinner.stop();
           tui.log.warning('🛑 Execução interrompida. Retornando ao chat...');

           if (activeConversationId) {
               const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
               rawHistory.push({
                   role: 'user',
                   content: '[Execução interrompida pelo usuário via Esc. A ação anterior foi cancelada antes de sua conclusão.]'
               });
               await HistoryManager.saveRawHistory(activeConversationId, rawHistory);
           }

           const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, false);
           if (nextMsg.type === 'user') {
               if (tui.isCancel(nextMsg.content)) {
                   keepGoing = false;
                   break;
               }
               nextPrompt = nextMsg.content;
           }
           continue;
       }

       // ... handle other errors ...
   } finally {
       interruptManager.stop();
   }
   ```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "handle user Esc abort cleanly"`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(agent): integrate InterruptManager into developer agent execution loop"
```

---

### Task 4: Full Regression and Sandbox Validation

**Files:**
- Test: All tests in `src/`

- [x] **Step 1: Run complete test suite**

Run: `npm test`  
Expected: All test suites PASS with 0 regressions.

- [x] **Step 2: Manual validation in terminal**

Run `node bin/shark.js dev` in test sandbox, trigger an instruction, press `Esc` while Shark Dev is working, and verify:
1. `🛑 Execução interrompida pelo usuário.` is shown.
2. Prompt `Your answer:` is presented immediately.
3. Typing a new instruction works and history is retained without needing `/chat`.

- [x] **Step 3: Commit final plan validation**

```bash
git add .
git commit -m "chore: validate esc interruption feature across full test suite"
```
