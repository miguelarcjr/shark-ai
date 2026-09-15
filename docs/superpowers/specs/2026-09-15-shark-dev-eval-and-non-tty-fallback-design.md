# Shark Dev: Non-TTY TUI Fallback and DeepSeek Agent Evaluation

**Date:** 2026-09-15  
**Topic:** CLI Non-TTY Fallback & DeepSeek Model Evaluation  
**Status:** Approved  

---

## 1. Overview and Problem Statement

Shark Dev recently received significant architectural improvements and was configured to run with a DeepSeek LLM model. However:
1. When invoked inside non-interactive or subshell automation environments (such as IDE assistants, background processes, or CI/CD pipelines), `@clack/prompts` crashes immediately with:
   ```text
   TTY initialization failed: uv_tty_init returned EBADF (bad file descriptor)
   ```
2. Running evaluations directly against large production repositories (e.g. `proximodesafio-lovable`) overwhelms token limits and context windows with massive directory trees, leading to request timeouts (`OpenAI API request timed out after 5 minutes`).
3. To rigorously assess the performance, tool calling, reasoning, and auto-healing capabilities of Shark Dev with DeepSeek, we require:
   - A robust Non-TTY fallback mechanism in `src/ui/tui.ts`.
   - A clean, isolated sandbox fixture (`test-sandbox/`).
   - A structured 3-phase evaluation suite covering End-to-End development, Auto-healing resilience, and Advanced tools/MCP discovery.

---

## 2. Component Design: Non-TTY TUI Fallback

### 2.1 File: `src/ui/tui.ts`

Introduce environment detection to gracefully degrade from interactive `@clack/prompts` (which requires raw terminal mode) to standard `node:readline` and stream I/O when running without a physical TTY:

```typescript
function isInteractive(): boolean {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}
```

### 2.2 Prompts Behavior:
- **`text(opts)`**:
  - *TTY:* Call `p.text(opts)`.
  - *Non-TTY:* Write `opts.message` to `process.stdout` and read line from `process.stdin` via `readline.createInterface`.
- **`confirm(opts)`**:
  - *TTY:* Call `p.confirm(opts)`.
  - *Non-TTY:* Write prompt with `[y/N]`. Interpret `s`, `sim`, `y`, `yes` (case-insensitive) as `true`, otherwise `false`.
- **`select(opts)`**:
  - *TTY:* Call `p.select(opts)`.
  - *Non-TTY:* Print numbered list (`1) Option A`, `2) Option B`) and read numeric input or exact label match.
- **`spinner()`**:
  - *TTY:* Retain Clack's animated spinner.
  - *Non-TTY:* Replace ANSI animations with clean text logs:
    - `start(msg)`: Output `[START] ${msg}`
    - `stop(msg)`: Output `[DONE] ${msg}`
    - `message(msg)`: Output `[INFO] ${msg}`

---

## 3. Test Sandbox Architecture (`test-sandbox/`)

To prevent token waste, slow roundtrips, and polluted logs from large production projects, evaluations will be run in a lightweight, isolated fixture repository.

### 3.1 Structure
```text
test-sandbox/
├── package.json         # ES module with Vitest and TypeScript
├── tsconfig.json        # Minimal Node/ESNext config
├── vitest.config.ts     # Instant test runner (< 500ms)
├── src/
│   ├── calculator.ts    # Initial code module
│   └── calculator.test.ts # Fast unit tests
└── .git/                # Isolated Git repo (for git status/diff tracking)
```

### 3.2 Git & Workspace Configuration
- Add `test-sandbox/` to root `.gitignore`.
- Run `git init` inside `test-sandbox/` and make an initial commit so Shark Dev can perform branch, diff, and status operations without affecting the main repository.

---

## 4. Evaluation Scenarios & Protocol

Each scenario is executed sequentially against the sandbox using `shark dev` (both interactive via stdin and autonomous via `--auto`).

### Scenario 1: End-to-End Feature Development
- **Prompt:** Implement `calculateTax(amount: number, taxRate: number): number` with validation preventing negative amounts/rates, write unit tests in `calculator.test.ts`, and run test validation.
- **Success Criteria:**
  - Accurately inspects existing files (`read_file` or `search_code`).
  - Generates valid TypeScript code adhering to project conventions.
  - Executes `npm test` and confirms 100% passing tests.
  - Returns a clear, concise task summary.

### Scenario 2: Resilience and Auto-Healing
- **Prompt / Setup:** Inject a failing edge case in `test-sandbox/src/discount.ts` and `discount.test.ts`. Prompt: *"Run the test suite, identify why tests are failing, fix the underlying logic, and verify all tests pass."*
- **Success Criteria:**
  - Detects the Vitest test failure output and stack trace.
  - Diagnoses the root cause rather than brute-forcing or wiping the file.
  - Resolves the bug in <= 2 turns.
  - Confirms zero regressions.

### Scenario 3: Advanced Tools and Structured Search
- **Prompt:** *"Locate all occurrences of `calculateDiscount` in the codebase, refactor its signature to take an options object `{ amount: number, discountPercent: number, couponCode?: string }`, and update all callers and tests."*
- **Success Criteria:**
  - Utilizes `search_code`, `search_file`, or `ast-grep` rather than brute-force reading all files.
  - Updates signatures and test call-sites consistently.
  - Conforms to agent response JSON schemas without parser errors.

---

## 5. Observability and Evaluation Report

The evaluation results will be logged and analyzed across 4 telemetry layers:
1. **Raw LLM & Process Logs:** Captures DeepSeek tool call structures, reasoning tokens, and execution time.
2. **Git Diff Inspector:** Evaluates surgery and cleanliness of generated code diffs.
3. **Automated Test Validation:** Confirms actual execution correctness via Vitest.
4. **Final Deliverable:** `eval-deepseek-report.md` documenting:
   - Success rate and turn count per scenario.
   - DeepSeek model reasoning & tool-call accuracy.
   - Identified Shark Dev bottlenecks and architectural recommendations.
