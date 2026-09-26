# Terminal & Background Process Control Design Specification

## Overview
Currently, Shark AI executes terminal commands via a single synchronous `run_command` helper in `src/core/agents/agent-tools.ts`, which prewarms a shell and awaits its execution indefinitely. When the agent triggers continuous long-running processes (e.g., `ng serve`, `npm run dev`, `docker compose up`, or test watchers), the process never exits, causing the agent turn to hang permanently.

This specification introduces a dual-tool architecture inspired by the Hermes Agent design:
1. **`run_command`**: Enhanced with foreground timeout (default: 30s), automatic promotion to background on timeout or watch pattern match, and direct background dispatch (`background: true`).
2. **`process`**: A dedicated process lifecycle tool providing `list`, `poll`, `log`, `write` (stdin), and `kill` operations.
3. **`ProcessManager`**: A centralized singleton / lifecycle manager that tracks active child processes, handles non-blocking streams directly to persistent log files on disk, monitors `watch_patterns`, coordinates reactive notifications via `MessageQueue`, and guarantees reliable tree-kill process cleanup on shutdown.

---

## Architecture & Data Flow

```
                             LLM Agent
                                │
               ┌────────────────┴────────────────┐
               │                                 │
     action: run_command                  action: process
               │                                 │
               ▼                                 ▼
      AgentActionExecutor ──────────────> AgentActionExecutor
               │                                 │
               ├───────────────────┬─────────────┘
               ▼                   ▼
       Synchronous Exec      ProcessManager
         (< 30s exit)              │
               │                   ├──> Spawn child process (execa)
               │                   ├──> Stream stdout/stderr to disk (.shark/processes/<session>/<id>.log)
               │                   ├──> Watcher regex detector (watch_patterns)
               │                   └──> Notify completion/alert via MessageQueue
               ▼
      Return Output to Agent
```

---

## Detailed Tool Specifications

### 1. `run_command`

Executes a shell command in the workspace directory.

#### Arguments Schema
```typescript
interface RunCommandArgs {
  command: string;                  // Required shell command string
  background?: boolean;             // If true, dispatches immediately to background (default: false)
  timeout_seconds?: number;         // Max foreground wait time before auto-promotion (default: 30)
  notify_on_complete?: boolean;     // If true, sends reactive notification via MessageQueue when process exits (default: true for background)
  watch_patterns?: string[];        // Array of string/regex patterns to detect in output stream
}
```

#### Execution Logic
1. **Explicit Background (`background: true`)**:
   - Calls `ProcessManager.spawn(command, { watchPatterns, notifyOnComplete: true })`.
   - Waits a brief startup window (e.g., 1000ms) or until a `watch_pattern` triggers.
   - If the process exits within that window with an error code (e.g. invalid command or port collision), returns failure immediately.
   - Otherwise, returns process metadata:
     ```text
     [Process 'proc_1' started in background (PID: 12345)]
     Command: ng serve
     Log file: .shark/processes/default/proc_1.log
     Initial output (lines 1-12 of 12):
     --------------------------------------------------
     ✔ Browser application bundle generation complete.
     Local: http://localhost:4200/
     --------------------------------------------------
     Use 'process' tool to inspect logs or terminate.
     ```

2. **Foreground Execution (`background: false`)**:
   - Runs the command with a timer set to `timeout_seconds * 1000` ms.
   - If the process completes within the timeout:
     - Returns stdout/stderr directly as normal.
   - If a `watch_pattern` triggers during startup indicating the service is ready (or failing):
     - Immediately promotes to background without waiting for the full timeout to elapse.
   - If the timeout expires while the process is still running:
     - Promotes the running process to background under `ProcessManager`.
     - Returns a clear notice with `process_id`, total lines generated so far, and the tail output.

---

### 2. `process`

Manages the lifecycle and I/O of background processes.

#### Arguments Schema
```typescript
interface ProcessArgs {
  action: 'list' | 'poll' | 'log' | 'write' | 'kill';
  process_id?: string;             // Required for poll, log, write, kill
  data?: string;                   // Text to send to stdin (required for 'write')
  lines?: number;                  // Number of lines to retrieve for 'log' (default: 50, max: 500)
  offset?: number;                 // Starting line index (0-based) for reading logs
}
```

#### Action Behaviors
- **`list`**:
  - Lists all processes in the current session.
  - Returns ID, PID, Command, Status (`running` | `completed` | `failed` | `killed`), Start time, Runtime duration, Exit code (if completed), and Total lines logged.
- **`poll`**:
  - Returns only new unread lines since the last `poll` or `log` read by the agent.
  - Updates `unreadOffset` for the process.
  - Includes metadata: `total_lines`, `new_lines_count`.
- **`log`**:
  - Reads line range `[offset, offset + lines]` from the log file on disk.
  - If `offset` is omitted, defaults to the tail: `[max(0, total_lines - lines), total_lines]`.
  - Always informs total lines: `[Process proc_1 - Showing lines 120-170 of 240 total lines]`.
- **`write`**:
  - Writes data directly to the process's `stdin` (appends newline if missing).
  - Returns confirmation of bytes written.
- **`kill`**:
  - Terminates the process and all child processes using tree-kill (`taskkill /pid <PID> /T /F` on Windows, process group kill on Unix).
  - Updates status to `killed`.

---

## Log Persistence & Disk Streaming

To prevent memory leaks while preserving 100% of debug logs for long sessions:
1. Every process streams `stdout` and `stderr` directly to:
   `.shark/processes/<sessionId>/<process_id>.log`.
2. A lightweight line indexer in `ProcessManager` maintains line byte offsets or total line counts without keeping full log contents in Node.js heap memory.
3. Disk logs persist after session shutdown, enabling post-mortem debugging.

---

## Tree-Kill & Process Cleanup

1. **Tree-Kill Implementation**:
   - Uses child-process tree killing (`tree-kill` or native platform commands):
     - Windows: `taskkill /pid ${pid} /T /F`
     - Unix: `process.kill(-pid, 'SIGKILL')` or `pkill -P ${pid}`
2. **Lifecycle Hooks**:
   - `ProcessManager.killAll()` is bound to:
     - `process.on('exit')`
     - `process.on('SIGINT')`
     - `process.on('SIGTERM')`
     - Shark CLI `/exit` and graceful termination commands.
   - Ensures no orphan Node/Angular/Vite servers keep local development ports busy.

---

## Reactive Notifications & `MessageQueue` Integration

When `notify_on_complete: true`:
- Upon process exit (code 0 or error), `ProcessManager` pushes a message to `MessageQueue`:
  ```typescript
  messageQueue.push({
    type: 'process_notification',
    content: `[Process '${id}' ('${command}') exited with code ${exitCode} after ${duration}s. Total lines logged: ${totalLines}]`,
    timestamp: Date.now(),
    metadata: {
      processId: id,
      exitCode,
      status: exitCode === 0 ? 'completed' : 'failed'
    }
  });
  ```
- Also, if any regex in `watch_patterns` matches during background execution (e.g. fatal errors), an alert notification is dispatched to `MessageQueue`.

---

## System Prompt & Schemas (`prompts.ts`)

1. **Action Types**: Add `'process'` to the allowed action union.
2. **Tool Args Properties**:
   - `background`: boolean flag for background execution.
   - `timeout_seconds`: execution timeout in seconds.
   - `watch_patterns`: list of string/regex patterns.
   - `process_id`: identifier string for process management.
   - `data`: string data for stdin.
   - `lines`, `offset`: pagination controls for process logs.
3. **Guidelines Block**:
   - Instruct the model to run servers/watchers (`ng serve`, `npm run dev`) with `background: true`.
   - Never use `&` or `nohup` in shell commands.
   - Use `process` (`poll`/`log`) to inspect server readiness and `kill` to terminate after testing.
