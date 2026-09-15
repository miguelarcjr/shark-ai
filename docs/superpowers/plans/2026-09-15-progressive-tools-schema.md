# Progressive Tools Schema & Tiered Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar no Shark AI o padrão de Revelação Progressiva (*Progressive Disclosure* com as bridge tools `tool_search`, `tool_describe`, `tool_call`), Degradação em Camadas (*Tiered Disclosure* com orçamento de tokens), Motor de Busca Léxica BM25, Envelope Uniforme `{ type, args }` no JSON Schema e Sistema de Erros Auto-Instrucionais (*Self-Teaching Errors*).

**Architecture:** A raiz de todas as ações passa a adotar `{ type, args }`, eliminando dezenas de campos opcionais nulos. Ferramentas Core (`read_file`, `modify_file`, `run_command`, etc.) permanecem carregadas; ferramentas secundárias (servidores MCP) ficam atrás de 3 ferramentas de ponte geridas por catálogo em memória e busca BM25. Falhas de validação de argumentos retornam mensagens instrutivas guiadas para recuperação autônoma da LLM.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest.

## Global Constraints

- Todas as ações do agente adotam a estrutura uniforme `{ type: string, args: Record<string, any> }`.
- O envelope de resposta da LLM preserva `{ thought: string | null, action: { type, args }, summary: string }`.
- Zero dependências de Native Function Calling: 100% compatível com StackSpot AI e OpenRouter via JSON Schema estrito ou JSON Prompt.
- Orçamento padrão do manifesto: máximo de 5% da janela de contexto ou teto de 4.000 tokens (`listing_max_tokens`).
- As ferramentas Core não passam pela ponte.
- Coordenador possui ferramentas de orquestração; Subagente possui apenas ferramentas de execução técnica.
- Erros de validação Zod geram retornos em texto explicativo com exemplos práticos (*Self-Teaching Errors*).

---

### Task 1: Motor de Busca Léxica BM25 para Ferramentas (`tool-catalog-search.ts`)

**Files:**
- Create: `src/core/tools/bridge/tool-catalog-search.ts`
- Test: `tests/core/tools/bridge/tool-catalog-search.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface DeferredToolEntry {
    name: string;
    source: string; // nome do servidor MCP ou plugin
    description: string;
    parameters?: Record<string, any>;
  }

  export interface ToolSearchResult {
    name: string;
    source: string;
    description: string;
    score: number;
  }

  export class ToolCatalogSearch {
    constructor(tools: DeferredToolEntry[]);
    search(queries: string[], limit?: number): { results: ToolSearchResult[]; available_sources?: string[] };
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/core/tools/bridge/tool-catalog-search.test.ts
import { describe, it, expect } from 'vitest';
import { ToolCatalogSearch, DeferredToolEntry } from '../../../src/core/tools/bridge/tool-catalog-search.js';

describe('ToolCatalogSearch', () => {
  const sampleTools: DeferredToolEntry[] = [
    {
      name: 'mcp_github_create_issue',
      source: 'github',
      description: 'Creates a new issue in a GitHub repository',
      parameters: { title: { type: 'string' }, body: { type: 'string' } }
    },
    {
      name: 'mcp_slack_post_message',
      source: 'slack',
      description: 'Send messages to Slack channels',
      parameters: { channel: { type: 'string' }, text: { type: 'string' } }
    }
  ];

  it('deve localizar ferramenta via BM25 e palavras-chave (inclusive plural)', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['create issues']);
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].name).toBe('mcp_github_create_issue');
  });

  it('deve localizar ferramenta por busca literal de substring na ausência de BM25', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['hub']);
    expect(res.results.some(r => r.name === 'mcp_github_create_issue')).toBe(true);
  });

  it('deve retornar available_sources quando nada for encontrado', () => {
    const catalog = new ToolCatalogSearch(sampleTools);
    const res = catalog.search(['ferramenta_totalmente_inexistente_12345']);
    expect(res.results.length).toBe(0);
    expect(res.available_sources).toEqual(['github', 'slack']);
  });
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/tools/bridge/tool-catalog-search.test.ts`  
Expected: FAIL com "Cannot find module"

- [ ] **Step 3: Implementar o motor de busca BM25 e Stemming**

Criar `src/core/tools/bridge/tool-catalog-search.ts` com:
- Tokenização simples e normalização de plurais básicos (inglês: remoção de 's', 'es', 'ing', 'ed').
- Algoritmo BM25 com k1=1.5 e b=0.75 calculando sobre `name`, `source`, `description` e nomes de parâmetros.
- Fallback por correspondência literal de substring em `name`.
- Diagnóstico com `available_sources` quando `results.length === 0`.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/tools/bridge/tool-catalog-search.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/bridge/tool-catalog-search.ts tests/core/tools/bridge/tool-catalog-search.test.ts
git commit -m "feat(bridge): add BM25 lexical search for tool catalog"
```

---

### Task 2: Degradação em Camadas do Manifesto (*Tiered Disclosure*)

**Files:**
- Create: `src/core/tools/bridge/tiered-disclosure.ts`
- Test: `tests/core/tools/bridge/tiered-disclosure.test.ts`

**Interfaces:**
- Consumes: `DeferredToolEntry` de `src/core/tools/bridge/tool-catalog-search.ts`
- Produces:
  ```typescript
  export interface TieredDisclosureOptions {
    listingMaxTokens?: number; // default: 4000
    contextWindow?: number;    // default: 128000
  }

  export function generateTieredManifest(
    tools: DeferredToolEntry[],
    options?: TieredDisclosureOptions
  ): { manifestText: string; tier: 1 | 2; isNamesOnly: boolean };
  ```

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/core/tools/bridge/tiered-disclosure.test.ts
import { describe, it, expect } from 'vitest';
import { generateTieredManifest } from '../../../src/core/tools/bridge/tiered-disclosure.js';
import { DeferredToolEntry } from '../../../src/core/tools/bridge/tool-catalog-search.js';

describe('generateTieredManifest', () => {
  it('Tier 1: deve truncar descrições em 60 caracteres no catálogo normal', () => {
    const tools: DeferredToolEntry[] = [{
      name: 'tool_a',
      source: 'src1',
      description: 'Esta é uma descrição extremamente longa que ultrapassa com certeza o limite de sessenta caracteres'
    }];
    const res = generateTieredManifest(tools, { listingMaxTokens: 4000 });
    expect(res.tier).toBe(1);
    expect(res.isNamesOnly).toBe(false);
    expect(res.manifestText).toContain('tool_a');
    expect(res.manifestText.length).toBeLessThan(120);
  });

  it('Fallback Names-Only: deve remover descrições se ultrapassar orçamento moderado', () => {
    const tools: DeferredToolEntry[] = Array.from({ length: 50 }, (_, i) => ({
      name: `tool_number_${i}`,
      source: 'srv',
      description: 'Descrição de teste média para a ferramenta'
    }));
    // Orçamento baixo para forçar names-only
    const res = generateTieredManifest(tools, { listingMaxTokens: 60 });
    expect(res.isNamesOnly).toBe(true);
    expect(res.manifestText).toContain('tool_number_0');
    expect(res.manifestText).not.toContain('Descrição de teste');
  });

  it('Tier 2: deve resumir por servidor se estourar até mesmo a lista de nomes', () => {
    const tools: DeferredToolEntry[] = Array.from({ length: 200 }, (_, i) => ({
      name: `mass_tool_${i}`,
      source: 'massive_server',
      description: 'Desc'
    }));
    const res = generateTieredManifest(tools, { listingMaxTokens: 10 });
    expect(res.tier).toBe(2);
    expect(res.manifestText).toContain('massive_server: 200 tools');
  });
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/tools/bridge/tiered-disclosure.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar a lógica de degradação em camadas**

Criar `src/core/tools/bridge/tiered-disclosure.ts`:
- Calcular `effectiveMaxTokens = Math.min(listingMaxTokens || 4000, contextWindow * 0.05)`.
- Estimar tokens (1 token ≈ 4 caracteres).
- Formatar Tier 1 truncando descrições em 60 caracteres.
- Se exceder `effectiveMaxTokens`, tentar fallback para *Names-Only*.
- Se servidor individual for anômalo, aplicar degradação isolada por servidor.
- Se ainda exceder, degradar para Tier 2 (Resumo de contagem por servidor).

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/tools/bridge/tiered-disclosure.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/bridge/tiered-disclosure.ts tests/core/tools/bridge/tiered-disclosure.test.ts
git commit -m "feat(bridge): implement tiered disclosure and token budgeting"
```

---

### Task 3: Handlers da Ponte e Desembrulho Seguro (`bridge-tools.ts`)

**Files:**
- Create: `src/core/tools/bridge/bridge-tools.ts`
- Test: `tests/core/tools/bridge/bridge-tools.test.ts`

**Interfaces:**
- Consumes: `ToolCatalogSearch` e `DeferredToolEntry`
- Produces:
  ```typescript
  export interface BridgeExecutionResult {
    success: boolean;
    output: any;
    error?: string;
  }

  export class BridgeToolsManager {
    constructor(catalog: ToolCatalogSearch, toolExecutor: (name: string, args: any) => Promise<any>);
    executeToolSearch(args: { queries: string[]; limit?: number }): Promise<BridgeExecutionResult>;
    executeToolDescribe(args: { names: string[] }): Promise<BridgeExecutionResult>;
    executeToolCall(args: { name: string; arguments: Record<string, any> }): Promise<BridgeExecutionResult>;
  }
  ```

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/core/tools/bridge/bridge-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BridgeToolsManager } from '../../../src/core/tools/bridge/bridge-tools.js';
import { ToolCatalogSearch } from '../../../src/core/tools/bridge/tool-catalog-search.js';

describe('BridgeToolsManager', () => {
  const tools = [{
    name: 'mcp_math_add',
    source: 'math',
    description: 'Add two numbers',
    parameters: { a: { type: 'number' }, b: { type: 'number' } }
  }];
  const catalog = new ToolCatalogSearch(tools);
  const mockExecutor = vi.fn().mockResolvedValue({ sum: 42 });

  it('executeToolDescribe deve carregar schema em lote', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolDescribe({ names: ['mcp_math_add'] });
    expect(res.success).toBe(true);
    expect(res.output.tools.mcp_math_add).toBeDefined();
  });

  it('executeToolCall deve desembrulhar e repassar parâmetros para o executor real', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolCall({ name: 'mcp_math_add', arguments: { a: 20, b: 22 } });
    expect(res.success).toBe(true);
    expect(mockExecutor).toHaveBeenCalledWith('mcp_math_add', { a: 20, b: 22 });
  });

  it('executeToolCall deve rejeitar com erro instrucional se a ferramenta não existir', async () => {
    const manager = new BridgeToolsManager(catalog, mockExecutor);
    const res = await manager.executeToolCall({ name: 'mcp_inexistente', arguments: {} });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Action tool_call Failed');
    expect(res.error).toContain('tool_search');
  });
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/tools/bridge/bridge-tools.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar `BridgeToolsManager`**

Criar `src/core/tools/bridge/bridge-tools.ts`:
- Implementar `executeToolSearch`: chama `catalog.search(queries, limit)`.
- Implementar `executeToolDescribe`: busca os schemas no catálogo para cada nome em `names`.
- Implementar `executeToolCall`: valida existência, loga no debug logger `[tool_call -> name]`, repassa para `toolExecutor`. Se falhar, formata mensagem de erro instrucional.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/tools/bridge/bridge-tools.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/tools/bridge/bridge-tools.ts tests/core/tools/bridge/bridge-tools.test.ts
git commit -m "feat(bridge): implement bridge tool handlers and safe unwrapping"
```

---

### Task 4: Atualização dos Schemas JSON e Higienização Dinâmica (`prompts.ts` e `schema-sanitizer.ts`)

**Files:**
- Create: `src/core/api/schema-sanitizer.ts`
- Modify: `src/core/api/prompts.ts`
- Test: `tests/core/api/schema-sanitizer.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function sanitizeResponseSchema(
    schema: Record<string, any>,
    options: { hasMcpServers: boolean }
  ): Record<string, any>;
  ```

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/core/api/schema-sanitizer.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeResponseSchema } from '../../../src/core/api/schema-sanitizer.js';
import { COORDINATOR_RESPONSE_JSON_SCHEMA } from '../../../src/core/api/prompts.js';

describe('sanitizeResponseSchema', () => {
  it('deve remover bridge tools do enum de type se hasMcpServers for false', () => {
    const sanitized = sanitizeResponseSchema(COORDINATOR_RESPONSE_JSON_SCHEMA, { hasMcpServers: false });
    const types = sanitized.properties.action.properties.type.enum;
    expect(types).not.toContain('tool_search');
    expect(types).not.toContain('tool_describe');
    expect(types).not.toContain('tool_call');
  });

  it('deve manter bridge tools se hasMcpServers for true', () => {
    const sanitized = sanitizeResponseSchema(COORDINATOR_RESPONSE_JSON_SCHEMA, { hasMcpServers: true });
    const types = sanitized.properties.action.properties.type.enum;
    expect(types).toContain('tool_search');
    expect(types).toContain('tool_describe');
    expect(types).toContain('tool_call');
  });
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/api/schema-sanitizer.test.ts`  
Expected: FAIL

- [ ] **Step 3: Atualizar `prompts.ts` e implementar `schema-sanitizer.ts`**

1. Em `src/core/api/prompts.ts`:
   - Atualizar `COORDINATOR_RESPONSE_JSON_SCHEMA` e `SUBAGENT_RESPONSE_JSON_SCHEMA` para o envelope `{ type, args }`.
   - Adicionar o bloco de instruções para Progressive Disclosure no prompt.
2. Em `src/core/api/schema-sanitizer.ts`:
   - Clonar o schema e filtrar o array `properties.action.properties.type.enum` conforme as opções.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/api/schema-sanitizer.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/schema-sanitizer.ts src/core/api/prompts.ts tests/core/api/schema-sanitizer.test.ts
git commit -m "feat(schema): update to { type, args } and add schema sanitizer"
```

---

### Task 5: Validador Zod e Erros Auto-Instrucionais (*Self-Teaching Errors*)

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Test: `tests/core/agents/agent-response-parser-self-teaching.test.ts`

**Interfaces:**
- Atualizar `AgentActionSchema` para aceitar `args` genérico e despachar para validadores específicos de ferramenta (`modifyFileArgsSchema`, `readFileArgsSchema`, etc.), retornando mensagens guiadas com exemplos.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// tests/core/agents/agent-response-parser-self-teaching.test.ts
import { describe, it, expect } from 'vitest';
import { parseAgentResponse } from '../../../src/core/agents/agent-response-parser.js';

describe('Self-Teaching Errors in AgentResponseParser', () => {
  it('deve formatar erro instrucional para modify_file sem âncoras', () => {
    const rawResponse = JSON.stringify({
      thought: 'Editando...',
      action: {
        type: 'modify_file',
        args: { path: 'src/index.ts', novo_codigo: 'console.log(1);' }
      },
      summary: 'Editado.'
    });

    const parsed = parseAgentResponse(rawResponse);
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toContain('[Action modify_file Failed]');
    expect(parsed.errorMessage).toContain('start_anchor');
    expect(parsed.errorMessage).toContain('read_file');
  });

  it('deve aceitar payload válido com { type, args }', () => {
    const rawResponse = JSON.stringify({
      thought: 'Lendo...',
      action: {
        type: 'read_file',
        args: { path: 'src/index.ts' }
      },
      summary: 'Lendo index.'
    });

    const parsed = parseAgentResponse(rawResponse);
    expect(parsed.isError).toBe(false);
    expect(parsed.action.type).toBe('read_file');
    expect(parsed.action.args.path).toBe('src/index.ts');
  });
});
```

- [ ] **Step 2: Executar o teste para verificar falha**

Run: `npx vitest run tests/core/agents/agent-response-parser-self-teaching.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implementar validação e mensagens de recuperação em `agent-response-parser.ts`**

- Suportar `{ type, args }` no `AgentActionSchema` (mantendo compatibilidade retroativa durante a transição).
- Adicionar gerador de erro formatado para `modify_file`, `tool_call` e `tool_describe`.
- Garantir que `[SYSTEM ERROR]` retorne prompt sintético para auto-recuperação.

- [ ] **Step 4: Executar o teste para verificar aprovação**

Run: `npx vitest run tests/core/agents/agent-response-parser-self-teaching.test.ts`  
Expected: PASS

- [ ] **Step 5: Executar a suíte de regressão completa**

Run: `npm test`  
Expected: Todos os testes existentes e novos passando.

- [ ] **Step 6: Commit**

```bash
git add src/core/agents/agent-response-parser.ts tests/core/agents/agent-response-parser-self-teaching.test.ts
git commit -m "feat(parser): add self-teaching error formatting for { type, args }"
```

---

## Self-Review

1. **Spec coverage:** 
   - Envelope `{ type, args }` coberto em Task 4 e Task 5.
   - BM25 e Stemming coberto em Task 1.
   - Degradação em camadas (*Tiered Disclosure*) coberto em Task 2.
   - Bridge tools (`tool_search`, `tool_describe`, `tool_call`) coberto em Task 3.
   - Higienização conservadora coberta em Task 4.
   - Erros auto-instrucionais cobertos em Task 3 e Task 5.
2. **Placeholder scan:** Nenhum "TBD" ou "TODO". Códigos de teste e comandos exatos fornecidos.
3. **Type consistency:** Interfaces de `DeferredToolEntry`, `ToolCatalogSearch`, `BridgeToolsManager` e schemas `{ type, args }` mantêm compatibilidade entre todas as tasks.
