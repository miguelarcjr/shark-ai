# Step 0: Multi-Source Context Grounding (Node: CONTEXT_GROUNDING)

## Goal
Ingest and synthesize background documentation, meeting transcripts, pull requests, issue threads, or legacy code to distill clear business rules and an explicit conflict matrix before requirements elicitation begins.

## Actions for the Coordinator
1. **Register Background Sources (if available):**
   - For each document, transcript, URL, or code area provided by the user or found in the project:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs source add --type <transcript|url|code|doc> --origin "<path_or_url>"`
   - *Note:* If no background sources exist, you can proceed directly to Transition (the gate auto-seeds a clean baseline).

2. **Generate Researcher Briefing:**
   - Run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs brief researcher`

3. **Dispatch Multi-Source Context Grounder:**
   - Use `invoke_subagent` with:
     - `role`: "Multi-Source Context Grounder"
     - `task_file`: `.shark/specs/<spec-id>/briefs/researcher-brief.md`
   - The researcher reads the sources, extracts business rules (`BR-xx`), and constructs the conflict matrix (`[CONF-xx]`), writing `.shark/specs/<spec-id>/artifacts/context-pack.md`.

4. **Validate Gate:**
   - Run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs validate`
   - Checks that `artifacts/context-pack.md` exists and contains `# Context Pack`, `1. Regras de Negocio`, and `2. Matriz de Conflitos`.

5. **Transition to Elicitation:**
   - Run:
     `node skills/spec-driven-graph/scripts/spec-ctl.mjs transition --next`
   - Proceed to `step1_elicit.md`. The Product Analyst will automatically receive the conflict matrix to probe during user interviews.
