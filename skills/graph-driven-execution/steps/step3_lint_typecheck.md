# Step 3: Static Typecheck & Lint Gate

## Goal
Verify static typing, strict compilation, and code hygiene before exposing the diff to human or adversarial review.

## Actions for the Coordinator
1. **Run Deterministic Gate:**
   - Execute: `node skills/graph-driven-execution/scripts/exec-ctl.mjs verify lint`
   - *Requirement:* `tsc --noEmit` and linter checks must pass with zero errors.
2. **If Errors Occur:**
   - Re-dispatch `tdd-dev` to fix type discrepancies or unused imports.
3. **Transition to Code Review:**
   - Execute: `node skills/graph-driven-execution/scripts/exec-ctl.mjs transition --next`
   - Proceed to `step4_adversarial_review.md`.
