# Unify Schema and Handle Optional Enum Properties in OpenRouter Provider

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the schema definitions between Stackspot and OpenRouter providers, automatically generating strict schemas for OpenRouter from the official schema in `prompts.ts` while robustly cleaning up invalid enum inputs in the local parser.

**Architecture:** Use a dynamic schema conversion function inside `openai-compatible-provider.ts` to convert `AGENT_RESPONSE_JSON_SCHEMA` into a strict JSON Schema, and use Zod preprocessing to coerce `Action` to `null` when not in a `manage_subagents` action.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest.

## Global Constraints
- Target Node version is Node 20.
- Use `tsup` for compilation.
- Ensure all tests pass.

---

### Task 1: Add conversion logic to openai-compatible-provider.ts

**Files:**
- Modify: `src/core/api/openai-compatible-provider.ts`

**Interfaces:**
- Consumes: `AGENT_RESPONSE_JSON_SCHEMA` from `src/core/api/prompts.ts`
- Produces: Correct `response_format` JSON schema dynamically converted for OpenRouter.

- [ ] **Step 1: Write helper function `toStrictOpenAISchema` in `openai-compatible-provider.ts`**

Add the helper function to `src/core/api/openai-compatible-provider.ts` (showing implementation details):
```typescript
function toStrictOpenAISchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }
    const cloned = JSON.parse(JSON.stringify(schema));
    
    // OpenAI strict JSON Schema does not allow $schema or title at the root level
    delete cloned.$schema;
    delete cloned.title;

    function processNode(node: any) {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (node.type === 'object') {
            node.additionalProperties = false;

            if (node.properties) {
                const originalRequired = node.required || [];
                const allProperties = Object.keys(node.properties);

                node.required = allProperties;

                for (const key of allProperties) {
                    const prop = node.properties[key];

                    if (!originalRequired.includes(key)) {
                        if (prop.type) {
                            if (Array.isArray(prop.type)) {
                                if (!prop.type.includes('null')) {
                                    prop.type.push('null');
                                }
                            } else if (typeof prop.type === 'string') {
                                if (prop.type !== 'null') {
                                    prop.type = [prop.type, 'null'];
                                }
                            }
                        }
                    }

                    if (prop.enum && Array.isArray(prop.enum)) {
                        if (!prop.enum.includes(null)) {
                            prop.enum.push(null);
                        }
                    }

                    processNode(prop);
                }
            }
        } else if (node.type === 'array' && node.items) {
            processNode(node.items);
        }
    }

    processNode(cloned);
    return cloned;
}
```

- [ ] **Step 2: Replace hardcoded schema payload with dynamic conversion**

Update `streamChat` in `src/core/api/openai-compatible-provider.ts` (around lines 40-180) to import `AGENT_RESPONSE_JSON_SCHEMA` and dynamically convert it:
```typescript
import { AGENT_RESPONSE_JSON_SCHEMA } from './prompts.js';

// Inside streamChat:
if (this.options.useStructuredOutputs) {
    const strictSchema = toStrictOpenAISchema(AGENT_RESPONSE_JSON_SCHEMA);
    requestPayload.response_format = {
        type: 'json_schema',
        json_schema: {
            name: 'agent_response',
            strict: true,
            schema: strictSchema
        }
    };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/core/api/openai-compatible-provider.ts
git commit -m "feat: use unified AGENT_RESPONSE_JSON_SCHEMA for OpenRouter with dynamic strict converter"
```

---

### Task 2: Implement robust preprocessing in local parser

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`

**Interfaces:**
- Consumes: parsed JSON object from LLM response.
- Produces: Sanitized `AgentAction` matching `AgentActionSchema`.

- [ ] **Step 1: Wrap `AgentActionSchema` definition in an object-level preprocess**

Modify `src/core/agents/agent-response-parser.ts` (lines 5-90) to add object-level preprocessing:
```typescript
export const AgentActionSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object') {
        // Trim type if it is a string
        if (typeof val.type === 'string') {
            val.type = val.type.trim();
        }
        // Trim Action if it is a string
        if (typeof val.Action === 'string') {
            val.Action = val.Action.trim();
        }
        // Coerce Action to null if it's not a manage_subagents action
        if (val.type !== 'manage_subagents' || val.Action === '') {
            val.Action = null;
        }
    }
    return val;
}, z.object({
    type: z.enum([
        'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
        'list_structure', 'modify_ast', 'search_ast', 'run_command',
        'talk_with_user', 'use_mcp_tool',
        'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
        'complete_task',
        'wait',
        'notify_user',
        'ast_list_structure',
        'ast_get_method',
        'ast_add_method', 'ast_modify_method', 'ast_remove_method',
        'ast_add_class',
        'ast_get_property', 'ast_add_property', 'ast_modify_property', 'ast_remove_property',
        'ast_add_decorator',
        'ast_add_interface', 'ast_add_type_alias',
        'ast_add_function', 'ast_remove_function',
        'ast_add_import', 'ast_remove_import', 'ast_organize_imports'
    ]),
    path: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    line_range: z.array(z.number()).nullable().optional(),
    target_content: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    tool_name: z.string().nullable().optional(),
    tool_args: z.string().nullable().optional(),
    query: z.string().nullable().optional(),
    is_regex: z.boolean().nullable().optional(),
    pattern: z.string().nullable().optional(),
    fix: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    file_path: z.string().nullable().optional(),
    class_name: z.string().nullable().optional(),
    method_name: z.string().nullable().optional(),
    method_code: z.string().nullable().optional(),
    property_name: z.string().nullable().optional(),
    property_code: z.string().nullable().optional(),
    extends_class: z.string().nullable().optional(),
    implements_interfaces: z.array(z.string()).nullable().optional(),
    decorator_code: z.string().nullable().optional(),
    interface_code: z.string().nullable().optional(),
    type_code: z.string().nullable().optional(),
    function_name: z.string().nullable().optional(),
    function_code: z.string().nullable().optional(),
    import_statement: z.string().nullable().optional(),
    module_path: z.string().nullable().optional(),
    new_body: z.string().nullable().optional(),
    confirmed: z.boolean().nullable().optional(),
    start_anchor: z.string().nullable().optional(),
    end_anchor: z.string().nullable().optional(),
    skill_name: z.string().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
    Subagents: z.array(z.object({
        TypeName: z.string(),
        Role: z.string(),
        Prompt: z.string()
    })).nullable().optional(),
    Recipient: z.string().nullable().optional(),
    Message: z.string().nullable().optional(),
    Action: z.enum(['list', 'kill', 'kill_all']).nullable().optional(),
    ConversationIds: z.array(z.string()).nullable().optional(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    system_prompt: z.string().nullable().optional(),
    enable_write_tools: z.boolean().nullable().optional(),
    enable_subagent_tools: z.boolean().nullable().optional(),
    enable_mcp_tools: z.boolean().nullable().optional(),
}));
```

- [ ] **Step 2: Commit**

```bash
git add src/core/agents/agent-response-parser.ts
git commit -m "refactor: apply robust object-level preprocessing to coerce Action field"
```

---

### Task 3: Write tests and compile

**Files:**
- Modify: `src/core/agents/agent-response-parser.test.ts`

- [ ] **Step 1: Write test case for non-manage_subagents actions containing arbitrary strings in Action**

Add tests to `src/core/agents/agent-response-parser.test.ts`:
```typescript
        it('coerces Action to null if type is not manage_subagents', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'invoke_subagent',
                    Action: 'invoke_subagent',
                    Recipient: 'subagent',
                    Message: 'do work'
                },
                summary: 'Invoking subagent'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('invoke_subagent');
            expect((parsed.action as any).Action).toBeNull();
        });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/core/agents/agent-response-parser.test.ts`
Expected: PASS

- [ ] **Step 3: Compile the project**

Run: `npm run build`
Expected: ESM and DTS compile with ⚡️ Build success.

- [ ] **Step 4: Commit**

```bash
git add src/core/agents/agent-response-parser.test.ts
git commit -m "test: add test for Action coercion on non-manage_subagents actions"
```
