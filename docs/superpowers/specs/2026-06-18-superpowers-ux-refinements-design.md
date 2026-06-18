# Design Spec: Superpowers UX Refinements

## Goal
Improve the user experience and token efficiency when using skills and subagents in Shark AI.

## Requirements & Solved Issues

### 1. Skill Prompt Collision
- **Problem**: When a new skill was activated, the previous skills remained active in `skillManager`. This concatenated multiple large skill prompts in every turn, bloating the context window, wasting tokens, and causing conflicting instructions that confused the LLM.
- **Solution**: Modify `skillManager.activateSkill` to call `this.reset()` before activating a new skill. This ensures only the newly requested skill is active in the prompt context.

### 2. Mid-Execution `/skills` Command Interception
- **Problem**: The `/skills` command only worked at the very beginning of the developer agent execution. If the agent prompted the user for input during its execution loop, typing `/skills` would just send `/skills` as text to the LLM.
- **Solution**: Centralize all user text inputs in `interactiveDeveloperAgent` through a helper function `promptUser` that intercepts `/skills`, prompts the user for skill activation via TUI, and then reprompts for the task response.

### 3. Subagent Feedback Visual Output
- **Problem**: Subagents ran silently in the background with no visual distinction. Their console logs lacked context (no prefix showing which subagent logged them), and the user had no idea how many subagents were active or what they were doing.
- **Solution**:
  - Add a `summary` field to `SubagentState` in [subagent-manager.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/src/core/workflow/subagent-manager.ts).
  - Prefix all console logging inside [developer-agent.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/src/core/agents/developer-agent.ts) with `[Subagent: <Role>]` when running as a subagent.
  - Print status updates whenever `response.summary` changes.
  - Dynamically display the active subagents count in the parent's spinnerText (e.g. `🦈 Shark Dev working... (Active subagents: 2)`).

## Verification Plan
- Run `npm test` to verify that all unit and integration tests compile and pass successfully.
- Manually run interactive sessions to verify:
  1. Activating a skill clears other active skills.
  2. Typing `/skills` during interactive prompts works correctly.
  3. Subagent activity prints with the appropriate role prefix.
