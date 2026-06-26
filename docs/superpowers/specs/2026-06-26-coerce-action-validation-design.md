# Spec: Unification of StackSpot and OpenRouter Schemas

We will eliminate the hardcoded schema duplication in `openai-compatible-provider.ts` and ensure it dynamically uses the official schema from `prompts.ts` while satisfying OpenAI's strict schema constraints.

## User Review Required

> [!IMPORTANT]
> - We will replace the duplicate, hardcoded schema in `openai-compatible-provider.ts` with a dynamic converter function (`toStrictOpenAISchema`).
> - This function will automatically format the official `AGENT_RESPONSE_JSON_SCHEMA` from `prompts.ts` to be compliant with OpenAI's Structured Outputs (`strict: true`) requirements: making all fields `required` (while allowing `null` for optional ones), adding `additionalProperties: false`, and ensuring `enum` lists include `null` when nullable.
> - This keeps both providers perfectly in sync and removes the unused AST tools from OpenRouter.

## Proposed Changes

### OpenAI Compatible Provider

#### [MODIFY] [openai-compatible-provider.ts](file:///d:/projetos/bmadspot/src/core/api/openai-compatible-provider.ts)
- Import `AGENT_RESPONSE_JSON_SCHEMA` from `./prompts.js`.
- Add a helper function `toStrictOpenAISchema(schema: any): any` that:
  - Deep-clones the input schema.
  - Recursively ensures all objects have `additionalProperties: false`.
  - Recursively ensures all properties defined in an object's `properties` are included in its `required` array.
  - If a property was not in the original `required` array, adds `"null"` to its type array and `null` to its `enum` array if it has one.
- Use this helper function to dynamically generate the payload's `response_format.json_schema.schema`.

### Response Parser Validation

#### [MODIFY] [agent-response-parser.ts](file:///d:/projetos/bmadspot/src/core/agents/agent-response-parser.ts)
- Keep/refine the object-level `z.preprocess` in `AgentActionSchema` to coerce `Action` to `null` if the action `type` is not `manage_subagents`. This acts as a safeguard against any model anomalies.

## Verification Plan

### Automated Tests
- Run `npx vitest run src/core/agents/agent-response-parser.test.ts`
- Run `npm run build`
