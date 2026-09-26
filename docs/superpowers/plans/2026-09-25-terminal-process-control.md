# Terminal & Background Process Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide Shark AI with robust terminal process control, supporting background execution for long-running services (e.g. `ng serve`), automatic timeout promotion, disk-based log streaming, pattern watching (`watch_patterns`), reactive notifications via `MessageQueue`, and reliable tree-kill process termination.

**Architecture:** A centralized `ProcessManager` handles spawning and tracking child processes (`execa`), streams stdout/stderr to dedicated log files on disk (`.shark/processes/<sessionId>/<id>.log`), matches `watch_patterns`, and pushes exit notifications to `MessageQueue`. `AgentActionExecutor` exposes both an enhanced `run_command` (foreground with auto-promotion or explicit background) and a dedicated `process` tool (`list`, `poll`, `log`, `write`, `kill`).

**Tech Stack:** TypeScript, Node.js (`node:child_process`, `node:fs`, `node:path`), `execa`, Vitest.

## Global Constraints
- Node >= 22.0.0, ESM (`"type": "module"`).
- Platform-agnostic (Windows & POSIX): reliable tree-kill for child processes.
- 100% log preservation: stream stdout and stderr directly to disk log files without recycling or truncation in memory.
- All tasks must adhere to TDD (failing test -> implementation -> pass -> commit).

---

### Task 1: Create ProcessManager Core and Log File Streaming

**Files:**
- Create: `src/core/process/process-manager.ts`
- Create: `src/core/process/process-manager.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ManagedProcessInfo {
    id: string;
    pid: number;
    command: string;
    status: 'running' | 'completed' | 'failed' | 'killed';
    startTime: number;
    endTime?: number;
    exitCode?: number | null;
    logPath: string;
    totalLines: number;
  }

  export interface SpawnProcessOptions {
    sessionId?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    watchPatterns?: string[];
    notifyOnComplete?: boolean;
    onWatchPatternMatched?: (pattern: string, line: string) => void;
    onExit?: (info: ManagedProcessInfo) => void;
  }

  export class ProcessManager {
    static getInstance(): ProcessManager;
    spawn(command: string, options?: SpawnProcessOptions): Promise<ManagedProcessInfo>;
    list(sessionId?: string): ManagedProcessInfo[];
    get(id: string): ManagedProcessInfo | undefined;
    poll(id: string): Promise<{ process: ManagedProcessInfo; newLines: string[]; offset: number }>;
    getLogs(id: string, options?: { offset?: number; lines?: number }): Promise<{ process: ManagedProcessInfo; lines: string[]; totalLines: number; offset: number }>;
    write(id: string, data: string): Promise<void>;
    kill(id: string): Promise<boolean>;
    killAll(): Promise<void>;
  }
  ```

- [x] **Step 1: Write failing tests for ProcessManager**
Create `src/core/process/process-manager.test.ts` testing:
- Spawning a short-lived command (e.g. `node -e "console.log('hello'); console.log('world');"`) writes logs to disk and tracks `totalLines: 2`.
- `list()` returns the process.
- `poll()` returns new unread lines and subsequent `poll()` returns empty array.
- `getLogs()` supports `offset` and `lines`.
- `kill()` terminates a running process.

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/process/process-manager.test.ts`
Expected: FAIL (module not found).

- [x] **Step 3: Implement ProcessManager**
Create `src/core/process/process-manager.ts`:
- Use `node:fs` write streams to write stdout/stderr chunks into `.shark/processes/<sessionId>/<id>.log`.
- Count lines as chunks arrive, splitting by newline.
- Implement tree-kill: on Windows, execute `taskkill /pid ${pid} /T /F`; on POSIX, use `tree-kill` or `process.kill(-pid, 'SIGKILL')` fallback to `child.kill('SIGKILL')`.
- Hook into process exit handlers to clean up child processes.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/process/process-manager.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add src/core/process/process-manager.ts src/core/process/process-manager.test.ts
git commit -m "feat(process): add ProcessManager with disk streaming and tree-kill"
```

---

### Task 2: Implement Watch Patterns and MessageQueue Notifications

**Files:**
- Modify: `src/core/process/process-manager.ts`
- Modify: `src/core/workflow/message-queue.ts`
- Test: `src/core/process/process-manager.test.ts`

**Interfaces:**
- Consumes: `MessageQueue` from `src/core/workflow/message-queue.ts`
- Modifies `QueueMessage.type`: support `'process_notification'` alongside `'user' | 'subagent_notification' | 'timeout'`.
- Produces: `ProcessManager.setMessageQueue(queue: MessageQueue): void`.

- [x] **Step 1: Write failing tests for watch_patterns and MessageQueue alerts**
Add tests in `src/core/process/process-manager.test.ts`:
- Spawning a command that outputs `"SERVER READY on 3000"` with `watchPatterns: ["SERVER READY"]` invokes `onWatchPatternMatched`.
- Setting a `MessageQueue` causes process exit to push a `'process_notification'` message with process metadata.

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/process/process-manager.test.ts`
Expected: FAIL (unsupported options or missing notifications).

- [x] **Step 3: Implement pattern watching and queue notifications**
- Update `src/core/workflow/message-queue.ts`:
  Expand `QueueMessage.type` to `'user' | 'subagent_notification' | 'timeout' | 'process_notification'`.
- Update `src/core/process/process-manager.ts`:
  - As lines are emitted, test them against `watchPatterns`. If matched, call callback.
  - On process exit, if `notifyOnComplete !== false` and `messageQueue` is present, push notification to queue.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/process/process-manager.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add src/core/workflow/message-queue.ts src/core/process/process-manager.ts src/core/process/process-manager.test.ts
git commit -m "feat(process): add watch_patterns and MessageQueue notification support"
```

---

### Task 3: Enhance run_command with Background Dispatch and Auto-Promotion

**Files:**
- Modify: `src/core/agents/agent-tools.ts`
- Create: `src/core/agents/agent-tools-process.test.ts`

**Interfaces:**
- Consumes: `ProcessManager`
- Modifies:
  ```typescript
  export interface RunCommandOptions {
    background?: boolean;
    timeoutSeconds?: number;
    notifyOnComplete?: boolean;
    watchPatterns?: string[];
    sessionId?: string;
  }
  export async function handleRunCommand(
    command: string,
    options?: RunCommandOptions
  ): Promise<string>;
  ```

- [x] **Step 1: Write failing test for enhanced handleRunCommand**
Create `src/core/agents/agent-tools-process.test.ts`:
- Test 1: Síncrono rápido (< 2s) retorna stdout normalmente.
- Test 2: Com `background: true`, retorna imediatamente `[Process '<id>' started in background (PID: ...)]` e inicializa o processo no `ProcessManager`.
- Test 3: Com `timeoutSeconds: 2`, um script que dorme 5 segundos é automaticamente promovido para background com mensagem informativa e ID.
- Test 4: Com `watchPatterns: ["READY"]`, assim que a linha aparece, desatacha imediatamente sem esperar o timeout.

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/agents/agent-tools-process.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement enhanced handleRunCommand**
In `src/core/agents/agent-tools.ts`:
- If `background === true`:
  - Call `ProcessManager.getInstance().spawn(command, ...)`.
  - Wait a 500ms initial burst or watch pattern match.
  - Return formatted string containing `process_id`, status, log path, and initial output.
- If `background !== true`:
  - Spawn process with timeout timer (`timeoutSeconds || 30`).
  - Listen for exit or watch pattern or timeout.
  - If it finishes within timeout, return output as before.
  - If timeout fires or pattern matches, promote to background and return formatted promotion notice.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/agents/agent-tools-process.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add src/core/agents/agent-tools.ts src/core/agents/agent-tools-process.test.ts
git commit -m "feat(agents): support background execution and auto-promotion in handleRunCommand"
```

---

### Task 4: Implement process Tool Handler and AgentActionExecutor Integration

**Files:**
- Modify: `src/core/agents/agent-tools.ts`
- Modify: `src/core/engine/agent-action-executor.ts`
- Modify: `src/core/engine/agent-action-executor.test.ts`

**Interfaces:**
- Produces in `agent-tools.ts`:
  ```typescript
  export interface ProcessActionArgs {
    action: 'list' | 'poll' | 'log' | 'write' | 'kill';
    process_id?: string;
    data?: string;
    lines?: number;
    offset?: number;
    sessionId?: string;
  }
  export async function handleProcessAction(args: ProcessActionArgs): Promise<string>;
  ```
- Exposes action `'process'` in `AgentActionExecutor.executeAction()`.

- [x] **Step 1: Write failing test for process tool in AgentActionExecutor**
In `src/core/engine/agent-action-executor.test.ts` (or dedicated test):
- Execute action `{ type: 'process', args: { action: 'list' } }` -> returns process table.
- Execute action `{ type: 'process', args: { action: 'poll', process_id: 'proc_1' } }` -> returns incremental lines.
- Execute action `{ type: 'process', args: { action: 'log', process_id: 'proc_1', lines: 10 } }` -> returns tail lines with total_lines metadata.
- Execute action `{ type: 'process', args: { action: 'kill', process_id: 'proc_1' } }` -> kills process and returns success.

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement handleProcessAction and wire into AgentActionExecutor**
- Implement `handleProcessAction` in `agent-tools.ts` formatting output with header (status, total lines, offsets).
- In `agent-action-executor.ts`:
  - Add `case 'process':` in `executeAction`.
  - Pass `this.messageQueue` and `this.sessionId` to `ProcessManager`.
  - Add sensitive action check for `'process'` when `action === 'kill'` or `action === 'write'`.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/engine/agent-action-executor.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add src/core/agents/agent-tools.ts src/core/engine/agent-action-executor.ts src/core/engine/agent-action-executor.test.ts
git commit -m "feat(engine): add process tool and integrate with AgentActionExecutor"
```

---

### Task 5: Update System Prompts, Tool Schemas, and Response Parser

**Files:**
- Modify: `src/core/api/prompts.ts`
- Modify: `src/core/agents/agent-response-parser.ts`
- Modify: `src/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Add `'process'` to prompt action union and JSON schema.
- Add arguments `background`, `timeout_seconds`, `watch_patterns`, `process_id`, `data`, `lines`, `offset` to `TOOL_ARGS_PROPERTIES`.
- Document foreground vs background rules, `watch_patterns`, and prohibiting `&` / `nohup`.

- [x] **Step 1: Write failing test in agent-response-parser.test.ts**
Test parsing JSON output with action `type: 'process'` and args `{ action: 'poll', process_id: 'proc_1' }`.

- [x] **Step 2: Run test to verify it fails**
Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: FAIL if `'process'` is rejected as unknown action.

- [x] **Step 3: Update prompts and schemas**
In `src/core/api/prompts.ts`:
- Include `'process'` in action types.
- Add parameters to `TOOL_ARGS_PROPERTIES`.
- Add section explaining terminal execution best practices (short commands vs background servers, `process` management, `watch_patterns`).
In `src/core/agents/agent-response-parser.ts`:
- Ensure `'process'` is recognized as a valid action type.

- [x] **Step 4: Run test to verify it passes**
Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**
```bash
git add src/core/api/prompts.ts src/core/agents/agent-response-parser.ts src/core/agents/agent-response-parser.test.ts
git commit -m "feat(prompts): document process tool and terminal guidelines in system prompt"
```

---

### Task 6: End-to-End Integration Verification and Process Cleanup on CLI Exit

**Files:**
- Modify: `src/index.ts` / `src/commands/dev.ts`
- Create: `test/integration/terminal-process-control.test.ts`

**Interfaces:**
- Ensure `ProcessManager.getInstance().killAll()` is called on CLI shutdown / SIGINT.

- [x] **Step 1: Write integration test**
Create `test/integration/terminal-process-control.test.ts`:
- Test full flow: agent launches a mock server (e.g. `node -e "setInterval(() => console.log('heartbeat'), 500);"`), receives background promo notice, inspects logs via `process(action: 'log')`, writes input if needed, and kills it. Verify no process remains running after `killAll()`.

- [x] **Step 2: Run integration test**
Run: `npx vitest run test/integration/terminal-process-control.test.ts`
Expected: PASS.

- [x] **Step 3: Wire shutdown hook in CLI**
Register `process.on('SIGINT', async () => { await ProcessManager.getInstance().killAll(); process.exit(0); })` and similar in CLI runner.

- [x] **Step 4: Run full test suite**
Run: `npm test`
Expected: All tests pass.

- [x] **Step 5: Commit**
```bash
git add src/index.ts src/commands/dev.ts test/integration/terminal-process-control.test.ts
git commit -m "feat(cli): wire ProcessManager shutdown hooks and add integration tests"
```
