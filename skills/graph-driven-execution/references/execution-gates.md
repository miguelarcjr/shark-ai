# Execution Quality Gates (Deterministic & LLM)

This reference defines the strict, non-negotiable gates enforced by `exec-ctl.mjs` during the implementation phase.

## 1. Deterministic Machine Gates (Zero Token Cost, Zero Error Tolerance)

1. **RED Failure Proof Gate:**
   - Command: `exec-ctl verify red`
   - Requirement: Test runner returns exit code $\neq 0$.
   - Anti-Tautology Rule: If a test passes before code is written, it is rejected as a false positive.

2. **GREEN Implementation Gate:**
   - Command: `exec-ctl verify green`
   - Requirement: Test runner returns exit code $0$, with zero failed assertions.

3. **Compiler & Lint Gate:**
   - Command: `exec-ctl verify lint`
   - Requirement: `tsc --noEmit` and ESLint return exit code $0$. No compiler errors or unhandled types.

4. **Blast Radius Gate:**
   - Verified during transitions.
   - Requirement: Modified files must be a subset of the task's declared files.

5. **Clean Working Tree Gate:**
   - Verified before and after atomic commits.
   - Requirement: `git status --porcelain` must be completely empty.

---

## 2. Cognitive LLM Gates (Subagent Reviewers)

1. **Test Rigor & Anti-Mock Gate (`test-auditor`):**
   - Audits the failing test for weak assertions (`toBeDefined`) or excessive mocking of business logic.

2. **Adversarial Code & Security Gate (`code-reviewer`):**
   - Audits the live `git diff` for concurrency races, unhandled promise rejections, memory leaks, and architectural boundary violations.
   - Issues either `VERDICT: PASS`, `VERDICT: PASS WITH WARNINGS`, or `VERDICT: BLOCKER: <remediation>`.
