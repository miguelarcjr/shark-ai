# Strict Structured Outputs Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar o `COORDINATOR_RESPONSE_JSON_SCHEMA` e o `SUBAGENT_RESPONSE_JSON_SCHEMA` às regras estritas do OpenAI Structured Outputs (`strict: true`), garantindo compatibilidade imediata com o StackSpot AI e provedores OpenAI.

**Architecture:** Modificar `TOOL_ARGS_PROPERTIES` para que todos os campos aceitem `null` e `arguments` seja uma string JSON anulável. Configurar `additionalProperties: false` e arrays `required` completos na raiz e nós aninhados (`action` e `args`). Manter parsing resiliente em `AgentActionSchema`.

**Tech Stack:** TypeScript, Node.js 22, Zod, Vitest.

## Global Constraints

- O schema deve ser 100% compatível com a especificação do OpenAI Structured Outputs com `strict: true`.
- Todos os campos de `properties` em qualquer nível de objeto DEVEM constar no array `required` correspondente.
- Todos os objetos devem ter `"additionalProperties": false`.
- O DeepSeek no OpenRouter continuará operando via `response_format: { type: "json_object" }` sem quebras.

---

### Task 1: Atualizar Schemas em `src/core/api/prompts.ts` e Testes

**Files:**
- Modify: `src/core/api/prompts.ts:139-325`
- Test: `src/core/api/prompts.test.ts`

**Interfaces:**
- Produces:
  - `TOOL_ARGS_PROPERTIES`: Record com tipos anuláveis (`type: ["string", "null"]`, etc.).
  - `COORDINATOR_RESPONSE_JSON_SCHEMA`: Schema com `additionalProperties: false`, `required: ["thought", "action", "summary"]`, `action.required: ["type", "args"]`, e `args.required: Object.keys(TOOL_ARGS_PROPERTIES)`.
  - `SUBAGENT_RESPONSE_JSON_SCHEMA`: Idêntica conformidade strict.

- [ ] **Step 1: Atualizar o teste unitário para validar conformidade strict do schema**

Em `src/core/api/prompts.test.ts`, adicionar verificações:
```typescript
it('deve ter conformidade estrita com OpenAI Structured Outputs', () => {
    const schema = COORDINATOR_RESPONSE_JSON_SCHEMA as any;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['thought', 'action', 'summary']);
    expect(schema.properties.action.additionalProperties).toBe(false);
    expect(schema.properties.action.required).toEqual(['type', 'args']);
    expect(schema.properties.action.properties.args.additionalProperties).toBe(false);
    expect(schema.properties.action.properties.args.required).toEqual(Object.keys(TOOL_ARGS_PROPERTIES));
    expect(TOOL_ARGS_PROPERTIES.arguments.type).toEqual(['string', 'null']);
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run src/core/api/prompts.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar as alterações em `src/core/api/prompts.ts`**

1. Em `TOOL_ARGS_PROPERTIES`:
   - Atualizar todos os tipos para aceitar `null`:
     - `path`: `["string", "null"]`
     - `content`: `["string", "null"]`
     - `start_anchor`: `["string", "null"]`
     - `end_anchor`: `["string", "null"]`
     - `command`: `["string", "null"]`
     - `query`: `["string", "null"]`
     - `is_regex`: `["boolean", "null"]`
     - `queries`: `["array", "null"]` com `items: { type: "string" }`
     - `names`: `["array", "null"]` com `items: { type: "string" }`
     - `name`: `["string", "null"]`
     - `arguments`: `["string", "null"]` com description orientando formato JSON serializado
     - `action`: `["string", "null"]`
     - `target`: `["string", "null"]`
     - `old_str`: `["string", "null"]`
     - `limit`: `["number", "null"]`
     - `task_file`: `["string", "null"]`
     - `duration_seconds`: `["number", "null"]`
     - `file_path`: `["string", "null"]`
     - `old_string`: `["string", "null"]`
     - `new_string`: `["string", "null"]`
     - `scope`: `["string", "null"]`
2. Em `COORDINATOR_RESPONSE_JSON_SCHEMA`:
   - `additionalProperties: false` na raiz.
   - `required: ["thought", "action", "summary"]`.
   - `action.additionalProperties: false`.
   - `action.required: ["type", "args"]`.
   - `args.additionalProperties: false`.
   - `args.required: Object.keys(TOOL_ARGS_PROPERTIES)`.
3. Em `SUBAGENT_RESPONSE_JSON_SCHEMA`:
   - Aplicar as mesmas regras de fechamento estrito.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run src/core/api/prompts.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/prompts.ts src/core/api/prompts.test.ts
git commit -m "feat(prompts): enforce strict OpenAI structured outputs compliance in schemas"
```

---

### Task 2: Validar e Atualizar `export-schema`

**Files:**
- Modify: `src/commands/export-schema.test.ts`
- Test: `src/commands/export-schema.test.ts`

- [ ] **Step 1: Escrever teste validando conformidade estrita no output do comando**

Em `src/commands/export-schema.test.ts`, verificar que o JSON emitido possui `additionalProperties: false` em todos os níveis de objeto e que `required` contém todas as chaves.

- [ ] **Step 2: Executar teste**

Run: `npx vitest run src/commands/export-schema.test.ts`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/export-schema.test.ts
git commit -m "test(export-schema): assert strict properties and required fields on exported schema"
```

---

### Task 3: Suporte Resiliente de `arguments` no Parser

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Test: `tests/core/agents/agent-response-parser-arguments.test.ts`

- [ ] **Step 1: Escrever teste verificando parsing de `arguments` em `tool_call` como string JSON e como objeto**

```typescript
it('deve parsear tool_call quando arguments for string JSON ou objeto', () => {
    const rawWithString = JSON.stringify({
        thought: 'test',
        action: {
            type: 'tool_call',
            args: {
                name: 'test_tool',
                arguments: '{"foo":"bar"}'
            }
        },
        summary: 'done'
    });
    const res = parseAgentResponse(rawWithString);
    expect(res.action.args.name).toBe('test_tool');
});
```

- [ ] **Step 2: Executar teste e ajustar parser se necessário**

Run: `npx vitest run tests/core/agents/agent-response-parser-arguments.test.ts`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/agent-response-parser.ts tests/core/agents/agent-response-parser-arguments.test.ts
git commit -m "fix(parser): ensure arguments string or object is safely parsed"
```

---

### Task 4: Suíte Completa de Regressão

- [ ] **Step 1: Executar todos os testes da aplicação**

Run: `npm test`  
Expected: Todos os testes passando sem quebras.

- [ ] **Step 2: Validar saída no terminal com comando real**

Run: `npx tsx src/bin/shark.ts export-schema coordinator`  
Expected: JSON válido emitido com `additionalProperties: false` e todos os campos em `required`.
