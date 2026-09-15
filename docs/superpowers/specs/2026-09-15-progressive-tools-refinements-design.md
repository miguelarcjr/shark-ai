# Especificação de Design: Refinamentos de Revelação Progressiva, Poda de Schema e Segurança de Execução

**Data:** 2026-09-15  
**Status:** Aprovado  
**Contexto:** Integração ponta a ponta dos módulos de Revelação Progressiva (*Tiered Disclosure*), poda ativa de schemas em provedores de IA sem *Native Function Calling*, garantia de confirmação interativa para `tool_call` e normalização integral de leituras de `action.args` no Shark AI.

---

## 1. Contexto e Objetivos

Após a implementação inicial da Tríade de Revelação Progressiva (`tool_search`, `tool_describe`, `tool_call`), do motor BM25 e da migração para o envelope `{ type, args }`, uma análise comparativa entre as especificações e o código revelou quatro lacunas operacionais:

1. **Manifesto Desconectado:** O gerador de catálogo com orçamento de tokens (`generateTieredManifest`) existia isoladamente e não era injetado no System Prompt inicial do agente.
2. **Poda Inativa nos Providers:** O higienizador de schemas (`sanitizeResponseSchema`) não estava sendo executado antes do envio de payloads à API no `OpenAICompatibleProvider`, mantendo ferramentas bridge mesmo sem servidores MCP.
3. **Ausência de Aprovação para `tool_call`:** Ferramentas MCP disparadas via `tool_call` eram executadas sem solicitar aprovação manual quando o modo `/auto` estivesse desligado.
4. **Dispersão de Propriedades no Despachante:** Algumas ações (`invoke_subagent`, `activate_skill`, `complete_task`, `wait`) ainda liam exclusivamente propriedades no primeiro nível do objeto em vez de priorizarem `action.args`.

---

## 2. Decisões de Design e Arquitetura

### 2.1. Injeção do Catálogo no System Prompt (`prompts.ts`)
- Estender `BuildPromptOptions`:
  ```typescript
  export interface BuildPromptOptions {
    snapshot?: MemorySnapshot;
    repositoryContext?: string;
    skillsIndex?: string;
    toolsCatalog?: string; // Catálogo formatado via generateTieredManifest
  }
  ```
- No corpo de `buildUnifiedSystemPrompt`, se `options.toolsCatalog` estiver definido e não for vazio, injeta o bloco:
  ```markdown
  <tools_catalog>
  ${options.toolsCatalog}
  </tools_catalog>
  ```
- O System Prompt base passa a orientar a LLM sobre a presença deste manifesto e a transição para busca obrigatória caso o catálogo esteja no Tier 2 (resumo por servidor).

### 2.2. Extensão de `ChatOptions` e Poda Dinâmica (`provider.interface.ts` e `openai-compatible-provider.ts`)
- Adicionar os campos opcionais em `ChatOptions`:
  ```typescript
  export interface ChatOptions {
      onChunk?: (chunk: string) => void;
      onComplete?: (response: AgentResponse) => void;
      conversationId?: string;
      agentType: 'developer_agent';
      searchQuery?: string;
      systemPrompt?: string;
      hasMcpServers?: boolean;
  }
  ```
- No `OpenAICompatibleProvider.streamChat`:
  - Se `options.systemPrompt` estiver presente e o histórico estiver iniciando (`rawHistory.length === 0`), inicializa a conversa com o prompt customizado.
  - Ao configurar `requestPayload.response_format`, executa `sanitizeResponseSchema(baseSchema, { hasMcpServers: options.hasMcpServers ?? false })`.
  - Se `hasMcpServers` for falso, remove `tool_search`, `tool_describe` e `tool_call` do enum `type` do schema JSON estrito.

### 2.3. Confirmação Manual de Segurança para `tool_call` (`developer-agent.ts`)
- Quando a ação `tool_call` for despachada:
  - Se `autoApproveTools` for falso:
    1. Formata os argumentos JSON para inspeção visual do usuário.
    2. Invoca `tui.confirm` com mensagem explícita contendo o nome da ferramenta e o payload.
    3. Caso o usuário negue, aborta o disparo ao MCP e retorna ao modelo:
       `[Action tool_call("${toolName}") Aborted]: Execução cancelada pelo usuário.`
  - Se `autoApproveTools` for verdadeiro (ou o usuário confirmar), despacha para `bridgeToolsManager.executeToolCall`.

### 2.4. Normalização Integral de `action.args` no `developer-agent.ts`
- Todas as ações do desenvolvedor extraem seus argumentos primariamente de `action.args`:
  - `invoke_subagent`: `action.args?.task_file || action.task_file`
  - `activate_skill`: `action.args?.name || action.args?.skill_name || action.skill_name`
  - `complete_task`: `action.args?.content || action.content` e `action.args?.summary || action.summary`
  - `wait`: `action.args?.duration_seconds ?? action.duration_seconds ?? 60`
  - `talk_with_user`: `action.args?.content || action.content`
  - `read_file` / `delete_file`: `action.args?.path || action.path`
  - `list_files`: `action.args?.path || action.path || '.'`
  - `search_file` / `search_code`: `action.args?.query || action.query`

---

## 3. Tratamento de Erros e Casos de Borda

1. **Sem servidores MCP:** O catálogo `<tools_catalog>` é suprimido e o schema JSON não declara ferramentas bridge.
2. **Rejeição pelo usuário:** O loop do agente não quebra; uma mensagem informativa de abort é inserida no histórico para reorientação autônoma da LLM.
3. **Tipagem estrita TypeScript:** Ajuste dos tipos residuais em testes e módulos auxiliares para compilação limpa com `tsc --noEmit`.

---

## 4. Plano de Verificação e Testes

- `tests/core/api/prompts.test.ts`: Valida injeção de `<tools_catalog>` em `buildUnifiedSystemPrompt`.
- `src/core/api/openai-compatible-provider.test.ts`: Valida poda de schema com `hasMcpServers: false` vs `hasMcpServers: true`.
- `src/core/agents/developer-agent.test.ts`:
  - Valida solicitação e comportamento de recusa/aprovação em `tool_call`.
  - Valida execução de `invoke_subagent` e `complete_task` com parâmetros passados estritamente em `args`.
- Execução de suíte completa (`npm test`) e verificação de tipagem (`npx tsc --noEmit`).
