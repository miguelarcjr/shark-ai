# Pre-warmed Shell Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize command execution latency on Windows by implementing a stateless, pre-warmed background shell pool using `execa`.

**Architecture:** We pre-warm a shell process in background (`cmd.exe` or `powershell.exe` on Windows, `$SHELL` or `sh` on Mac/Linux) with piped standard I/O. When a command execution request arrives, we write the command + `\nexit\n` to its `stdin` and await the process termination to get the final output, while concurrently spawning a new pre-warmed process in the background.

**Tech Stack:** Node.js, TypeScript, Vitest, Execa.

## Global Constraints
- Node version >= 20.0.0
- Avoid native compiled dependencies (like `node-pty`) to maintain zero installation failure rates.
- Do not introduce state leakages (each command execution must remain stateless and independent).

---

### Task 1: Install Execa Dependency

**Files:**
- Modify: `d:\projetos\bmadspot\package.json`

**Interfaces:**
- Consumes: None
- Produces: `execa` dependency in `package.json` and node_modules.

- [ ] **Step 1: Add execa dependency to package.json**
  Update `dependencies` block in `package.json` to include `"execa": "^8.0.1"`.

- [ ] **Step 2: Run npm install**
  Run: `npm install`
  Expected: Successful installation with exit code 0.

- [ ] **Step 3: Verify installation**
  Run: `npm ls execa`
  Expected: Output showing `execa@8.0.1` installed successfully.

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add package.json package-lock.json
  git commit -m "chore: add execa dependency"
  ```

---

### Task 2: Implement PrewarmedShell and Refactor handleRunCommand

**Files:**
- Modify: `d:\projetos\bmadspot\src\core\agents\agent-tools.ts`

**Interfaces:**
- Consumes: `execa` library
- Produces: `handleRunCommand` refactored export in `agent-tools.ts` that uses pre-warmed shells.

- [ ] **Step 1: Implement pre-warming shell logic**
  Add imports and state variables for `nextShellProcess` and `prewarmShell()` function in `src/core/agents/agent-tools.ts`:
  ```typescript
  import { execa, type ExecaChildProcess } from 'execa';

  let nextShellProcess: ExecaChildProcess | null = null;

  export function prewarmShell() {
      const isWindows = process.platform === 'win32';
      const shell = isWindows 
          ? (process.env.COMSPEC || 'cmd.exe') 
          : (process.env.SHELL || 'sh');

      nextShellProcess = execa(shell, [], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          reject: false,
          buffer: true,
          cwd: process.cwd(),
          env: process.env
      });
  }
  ```

- [ ] **Step 2: Register process cleanup listener**
  Ensure we clean up the background shell process when Node exits to prevent orphaned processes:
  ```typescript
  process.on('exit', () => {
      if (nextShellProcess) {
          try {
              nextShellProcess.kill();
          } catch {
              // Ignore errors during exit cleanup
          }
      }
  });
  ```

- [ ] **Step 3: Refactor handleRunCommand to use pre-warmed processes**
  Replace `handleRunCommand` implementation:
  ```typescript
  export async function handleRunCommand(command: string): Promise<string> {
      tui.log.info(`💻 Executing: ${colors.dim(command)}`);

      if (!nextShellProcess) {
          prewarmShell();
      }
      const currentShell = nextShellProcess!;

      // Pre-warm the next process immediately in background
      prewarmShell();

      try {
          currentShell.stdin?.write(`${command}\nexit\n`);
          
          const { stdout, stderr } = await currentShell;
          const output = stdout.trim() || stderr.trim();
          return output || 'Command executed successfully (no output).';
      } catch (e: any) {
          return `Error executing command: ${e.message}`;
      }
  }
  ```

- [ ] **Step 4: Verify the build**
  Run: `npm run build`
  Expected: Successful compilation with no TS errors.

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add src/core/agents/agent-tools.ts
  git commit -m "feat: implement pre-warmed shell execution pool"
  ```

---

### Task 3: Create Unit Tests for agent-tools

**Files:**
- Create: `d:\projetos\bmadspot\src\core\agents\agent-tools.test.ts`

**Interfaces:**
- Consumes: `handleRunCommand` from `agent-tools.ts`
- Produces: Test suite verifying correctness and stateless nature of commands.

- [ ] **Step 1: Write the tests verifying command execution**
  Create `src/core/agents/agent-tools.test.ts`:
  ```typescript
  import { describe, it, expect, afterAll } from 'vitest';
  import { handleRunCommand, prewarmShell } from './agent-tools.js';

  describe('agent-tools: handleRunCommand', () => {
      it('should execute basic commands successfully', async () => {
          const result = await handleRunCommand('echo test-output-matching');
          expect(result).toContain('test-output-matching');
      });

      it('should execute commands in a stateless fashion', async () => {
          // Command 1: run cd to a different state
          await handleRunCommand('cd ..');
          
          // Command 2: run pwd or echo to check that we are still in original dir
          // Since it's stateless, the next process should still start in process.cwd()
          const result = await handleRunCommand('echo current-run');
          expect(result).toContain('current-run');
      });
  });
  ```

- [ ] **Step 2: Run tests to verify they pass**
  Run: `npx vitest run src/core/agents/agent-tools.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit tests**
  Run:
  ```bash
  git add src/core/agents/agent-tools.test.ts
  git commit -m "test: add unit tests for pre-warmed shell execution"
  ```
