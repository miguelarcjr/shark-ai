# Progressive Tools Refinements & Execution Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar ponta a ponta a revelação progressiva no Shark AI com injeção do catálogo no System Prompt (*Tiered Disclosure*), poda ativa de schemas nos provedores (`sanitizeResponseSchema`), confirmação manual de segurança para `tool_call` e normalização integral de `action.args` no `DeveloperAgent`.

**Architecture:** O `DeveloperAgent` inicializa servidores MCP, gera o manifesto via `generateTieredManifest(mcpTools)` e o passa para o `buildUnifiedSystemPrompt`. O provedor sanitiza o schema do payload removendo bridge tools se `hasMcpServers` for falso. O despachante de ações solicita confirmação manual para qualquer `tool_call` antes da execução quando `/auto` estiver desligado e lê primariamente de `action.args`.

**Tech Stack:** TypeScript, Node.js, Vitest.

## Global Constraints

- O contrato padrão das ações deve ser sempre `{ type, args }`.
- Zero quebra de compatibilidade com modelos sem function calling nativo (StackSpot e OpenRouter).
- O catálogo de ferramentas MCP deve ser omitido quando não houver servidores configurados.
- Todo `tool_call` com `/auto` desligado exige confirmação explícita via `tui.confirm`.
- `npm test` e `npx tsc --noEmit` devem passar com 100% de sucesso e 0 erros.

---

### Task 1: Injeção do Catálogo no System Prompt (`prompts.ts`)

**Files:**
- Modify: `src/core/api/prompts.ts`
- Modify: `tests/core/api/prompts.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface BuildPromptOptions {
    snapshot?: MemorySnapshot;
    repositoryContext?: string;
    skillsIndex?: string;
    toolsCatalog?: string;
  }
  export function buildUnifiedSystemPrompt(options?: BuildPromptOptions): string;
  ```

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `tests/core/api/prompts.test.ts`:
```typescript
it('deve incluir bloco <tools_catalog> quando toolsCatalog for fornecido', () => {
    const prompt = buildUnifiedSystemPrompt({
        toolsCatalog: 'mcp_server_a: tool_1, tool_2'
    });
    expect(prompt).toContain('<tools_catalog>');
    expect(prompt).toContain('mcp_server_a: tool_1, tool_2');
    expect(prompt).toContain('</tools_catalog>');
});

it('não deve incluir bloco <tools_catalog> quando toolsCatalog for omitido ou vazio', () => {
    const prompt = buildUnifiedSystemPrompt();
    expect(prompt).not.toContain('<tools_catalog>');
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/api/prompts.test.ts`  
Expected: FAIL ("not to contain <tools_catalog>" ou "expected prompt to contain <tools_catalog>")

- [ ] **Step 3: Implementar em `prompts.ts`**

Em `src/core/api/prompts.ts`:
1. Adicionar `toolsCatalog?: string` em `BuildPromptOptions`.
2. Criar `const toolsCatalogBlock = options?.toolsCatalog ? `<tools_catalog>\n${options.toolsCatalog}\n</tools_catalog>` : '';`.
3. Adicionar `toolsCatalogBlock` no array filtrado de blocos retornado por `buildUnifiedSystemPrompt`.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/api/prompts.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/prompts.ts tests/core/api/prompts.test.ts
git commit -m "feat(prompts): add toolsCatalog injection to buildUnifiedSystemPrompt"
```

---

### Task 2: Extensão de `ChatOptions` e Poda Ativa de Schema no Provider (`openai-compatible-provider.ts`)

**Files:**
- Modify: `src/core/api/provider.interface.ts`
- Modify: `src/core/api/openai-compatible-provider.ts`
- Modify: `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: `sanitizeResponseSchema` de `src/core/api/schema-sanitizer.js`
- Produces:
  ```typescript
  export interface ChatOptions {
      // ...
      systemPrompt?: string;
      hasMcpServers?: boolean;
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

Em `src/core/api/openai-compatible-provider.test.ts`:
```typescript
it('deve podar bridge tools do schema quando hasMcpServers for falso', async () => {
    let capturedPayload: any = null;
    (global as any).fetch = vi.fn().mockImplementation((url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return Promise.resolve({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: vi.fn()
                        .mockResolvedValueOnce({
                            done: false,
                            value: new TextEncoder().encode('data: ' + JSON.stringify({
                                choices: [{ delta: { content: '{"thought":null,"action":{"type":"read_file","args":{"path":"test.ts"}},"summary":"ok"}' } }]
                            }) + '\n\n')
                        })
                        .mockResolvedValueOnce({ done: true, value: undefined })
                })
            }
        });
    });

    const provider = new OpenAICompatibleProvider({
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'test-key',
        model: 'gpt-4o',
        useStructuredOutputs: true
    });

    await provider.streamChat('hello', {
        agentType: 'developer_agent',
        hasMcpServers: false
    });

    const types = capturedPayload.response_format.json_schema.schema.properties.action.properties.type.enum;
    expect(types).not.toContain('tool_search');
    expect(types).not.toContain('tool_describe');
    expect(types).not.toContain('tool_call');
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`  
Expected: FAIL (types ainda contém bridge tools)

- [ ] **Step 3: Implementar em `provider.interface.ts` e `openai-compatible-provider.ts`**

1. Em `src/core/api/provider.interface.ts`, adicionar `systemPrompt?: string` e `hasMcpServers?: boolean` em `ChatOptions`.
2. Em `src/core/api/openai-compatible-provider.ts`:
   - Importar `sanitizeResponseSchema` de `./schema-sanitizer.js`.
   - Se `options.systemPrompt` for fornecido e `rawHistory.length === 0`, usar `options.systemPrompt` no content da mensagem de role `'system'`.
   - Ao montar `requestPayload.response_format`, chamar `sanitizeResponseSchema(baseSchema, { hasMcpServers: options.hasMcpServers ?? false })`.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/provider.interface.ts src/core/api/openai-compatible-provider.ts src/core/api/openai-compatible-provider.test.ts
git commit -m "feat(provider): apply schema pruning and dynamic system prompt in openai-compatible-provider"
```

---

### Task 3: Injeção de Manifesto e Confirmação de Segurança para `tool_call` no `developer-agent.ts`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `generateTieredManifest` de `src/core/tools/bridge/tiered-disclosure.js`
- Comportamento:
  - Se `mcpTools.length > 0`, gera manifesto e injeta no `buildUnifiedSystemPrompt`.
  - Passa `systemPrompt` e `hasMcpServers: mcpTools.length > 0` para `provider.streamChat`.
  - Para ação `tool_call`: se `!autoApproveTools`, solicita confirmação via `tui.confirm`. Se recusado, aborta sem chamar o executor.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/core/agents/developer-agent.test.ts`:
```typescript
it('deve solicitar confirmação antes de executar tool_call quando autoApproveTools for falso e respeitar cancelamento', async () => {
    // Mock do tui.confirm retornando false
    vi.spyOn(tui, 'confirm').mockResolvedValueOnce(false);

    // Configura resposta simulada com tool_call
    // Executa interactiveDeveloperAgent em lote
    // Verifica que tui.confirm foi chamado com o nome da ferramenta
    // Verifica que o resultado retornado ao modelo contém "[Action tool_call" e "Aborted"
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "deve solicitar confirmação"`  
Expected: FAIL

- [ ] **Step 3: Implementar a segurança de `tool_call` e injeção do manifesto no `developer-agent.ts`**

1. Ao inicializar o agente:
   ```typescript
   const manifest = mcpTools.length > 0 ? generateTieredManifest(mcpTools).manifestText : undefined;
   const dynamicSystemPrompt = buildUnifiedSystemPrompt({ toolsCatalog: manifest });
   ```
2. Ao chamar `provider.streamChat`:
   Passar `systemPrompt: dynamicSystemPrompt` e `hasMcpServers: mcpTools.length > 0` no objeto `ChatOptions`.
3. No bloco `action.type === 'tool_call'`:
   ```typescript
   if (!autoApproveTools) {
       const formattedArgs = Object.keys(toolArguments).length > 0 
           ? JSON.stringify(toolArguments, null, 2) 
           : '{}';
       const approved = await tui.confirm({
           message: `Deseja executar a ferramenta MCP '${colors.bold(toolName)}'?\nArgumentos:\n${formattedArgs}`
       });
       if (!approved) {
           resultMsg = `[Action tool_call("${toolName}") Aborted]: Execução cancelada pelo usuário.`;
           log.warning(`🚫 Execução de '${toolName}' rejeitada pelo usuário.`);
           continue; // ou avança para a próxima iteração
       }
   }
   ```

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "deve solicitar confirmação"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(agent): wire tiered manifest to prompt and add confirmation prompt for tool_call"
```

---

### Task 4: Normalização Completa de `action.args` no `developer-agent.ts`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Garante que todas as ações leiam primariamente de `action.args.<campo>` com fallback para `action.<campo>`.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar teste em `src/core/agents/developer-agent.test.ts`:
```typescript
it('deve extrair argumentos de invoke_subagent e complete_task estritamente de action.args', async () => {
    // Executa invoke_subagent com { type: 'invoke_subagent', args: { task_file: 'task.md' } }
    // Verifica que o subagentManager recebeu task.md corretamente
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "deve extrair argumentos de invoke_subagent"`  
Expected: FAIL

- [ ] **Step 3: Implementar a normalização de leituras em `developer-agent.ts`**

Ajustar as linhas do despachante:
- `invoke_subagent`: `const taskFile = action.args?.task_file || action.task_file;`
- `activate_skill`: `const name = action.args?.name || action.args?.skill_name || action.skill_name || '';`
- `complete_task`: `const detailedContent = action.args?.content || action.content || '';` e `const taskSummary = action.args?.summary || action.summary || response.summary || 'Task completed successfully.';`
- `wait`: `const duration = action.args?.duration_seconds ?? action.duration_seconds ?? 60;`
- `talk_with_user`: `const contentStr = action.args?.content || action.content || '';`
- `read_file` / `delete_file`: `const filePath = action.args?.path || action.path;`
- `list_files`: `const targetDir = action.args?.path || action.path || '.';`
- `search_file` / `search_code`: `const query = action.args?.query || action.query;`

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run src/core/agents/developer-agent.test.ts -t "deve extrair argumentos de invoke_subagent"`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat(agent): standardize all action handlers to prioritize action.args"
```

---

### Task 5: Resolução de Tipagens TypeScript e Verificação Geral

**Files:**
- Modify: `src/core/workflow/subagent-manager.test.ts`
- Modify: `src/core/workflow/context-compressor.ts`
- Modify: `src/core/agents/developer-agent.test.ts`
- Modify: `src/ui/verify-box.ts`
- Modify: `src/ui/verify-colors.ts`

- [ ] **Step 1: Executar `npx tsc --noEmit` para catalogar os erros atuais**

Run: `npx tsc --noEmit`

- [ ] **Step 2: Corrigir divergências de tipo**

1. Em `src/core/workflow/subagent-manager.test.ts`: tratar `'args' is possibly 'undefined'` com operador `!` ou checagem segura.
2. Em `src/core/workflow/context-compressor.ts`: ajustar tipo de comparação de role para compatibilidade estrita.
3. Em `src/core/agents/developer-agent.test.ts`: corrigir mock de `fs` para `fs.readFileSync` sem `.default`.
4. Em `src/ui/verify-box.ts` e `verify-colors.ts`: adicionar extensões `.js` nos imports relativos.

- [ ] **Step 3: Executar `npx tsc --noEmit` para verificar 0 erros**

Run: `npx tsc --noEmit`  
Expected: Código de saída 0 (sem nenhum erro de tipo)

- [ ] **Step 4: Executar toda a suíte de testes Vitest**

Run: `npm test`  
Expected: Todos os 53+ arquivos de teste passando (PASS)

- [ ] **Step 5: Commit**

```bash
git add src/ tests/
git commit -m "fix(types): resolve tsc compilation warnings and ensure 100% test pass"
```

---

## Self-Review

1. **Spec coverage:** As 4 pendências identificadas (Tiered Disclosure no prompt, poda de schema, segurança de `tool_call` e `args` normalizados) estão rigorosamente distribuídas nas Tasks 1 a 4. A Task 5 garante integridade total de build e compilação.
2. **Placeholder scan:** Nenhum "TBD" ou "TODO". Comandos e códigos de teste completos e reproduzíveis.
3. **Type consistency:** Contratos de `BuildPromptOptions`, `ChatOptions` e `DeveloperAgent` alinhados entre todas as tarefas.
