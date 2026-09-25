# AgentEngine Full Structural Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Concluir a refatoração estrutural completa do núcleo do Shark AI, transferindo o loop de raciocínio, ferramentas e ciclo de turnos de `developer-agent.ts` para o `AgentEngine` agnóstico orientado a eventos, de modo que eventos de ferramentas (`tool_progress`), streaming e aprovações cheguem em tempo real a qualquer canal (CLI, WhatsApp, etc.), sem acoplamento com `tui`, `@clack/prompts` ou `process.stdin`.

**Architecture:** 
1. `AgentEngine` torna-se a máquina de execução principal: orquestra LLM (`ProviderResolver`), catálogo de ferramentas (`BridgeToolsManager`, FileSystem, Shell), histórico (`HistoryManager`, `ContextCompressor`), e aprovações atômicas (`PendingApprovalsManager`).
2. Toda a comunicação de saída do `AgentEngine` ocorre estritamente via `AgentOutboundEvent` (`tool_progress`, `text_delta`, `action_approval_request`, `turn_completed`, `turn_interrupted`).
3. `CliAdapter` é responsável exclusivamente por renderizar esses eventos no terminal (`tui.log`, `@clack/prompts`, spinners e diffs) e capturar entradas do terminal (`stdin`/`Esc`).
4. `WhatsAppAdapter` recebe os mesmos eventos e despacha atualizações em tempo real no chat (progresso de ferramentas, aprovações interativas e chunks de resposta).
5. `interactiveDeveloperAgent` em `developer-agent.ts` torna-se uma fachada elegante em torno do `AgentEngine` + `CliAdapter`, mantendo 100% de compatibilidade com os 48 testes existentes de `developer-agent.test.ts` e com o comando `shark dev`.

**Tech Stack:** TypeScript (Node >= 22.0.0, ESM), SQLite nativo (`DatabaseSync`), Vitest, ProviderResolver, BridgeTools, Baileys (no exemplo do WhatsApp).

## Global Constraints

- 100% de retrocompatibilidade com a suíte de testes existente (todos os 370 testes devem continuar passando).
- `AgentEngine` não deve importar diretamente `@clack/prompts`, `tui.ts` ou ler de `process.stdin`. Todo I/O de console/terminal pertence ao `CliAdapter`.
- O cancelamento via `AbortController` deve interromper imediatamente comandos em execução no shell e requisições no LLM.
- Nenhuma dependência externa de WhatsApp adicionada ao `package.json` principal.

---

### Task 1: Interface de Ações e Ferramentas Desacopladas no Core (`src/core/engine/agent-action-executor.ts`)

**Files:**
- Create: `src/core/engine/agent-action-executor.ts`
- Test: `src/core/engine/agent-action-executor.test.ts`

**Interfaces:**
- Produces: `AgentActionExecutor`
- Consumes: `AnchorManager`, `handleReadFile`, `handleRunCommand`, `BridgeToolsManager`, `AgentOutboundEvent`

- [ ] **Step 1: Escrever testes unitários para execução desacoplada de ações e emissão de eventos**
Testar execução de `read_file`, `create_file`, `modify_file` e `run_command` validando que eventos `tool_progress` (status `starting` e `completed` / `failed`) são emitidos via callback sem depender de `tui`.

- [ ] **Step 2: Implementar `AgentActionExecutor`**
Extrair e desacoplar o despacho de ações de `developer-agent.ts` para `AgentActionExecutor`, recebendo um `emitOutbound: (event: AgentOutboundEvent) => void` e `requestApproval: (toolName: string, args: any) => Promise<boolean>`.

- [ ] **Step 3: Executar testes de `AgentActionExecutor`**
Executar `npx vitest run src/core/engine/agent-action-executor.test.ts` e verificar PASS.

- [ ] **Step 4: Commit**
`git commit -m "feat: create decoupled AgentActionExecutor with event emissions"`

---

### Task 2: Incorporar o Loop do Agente e Ferramentas no `AgentEngine`

**Files:**
- Modify: `src/core/engine/agent-engine.ts`
- Test: `src/core/engine/agent-engine.test.ts`

**Interfaces:**
- Produces: `AgentEngine.processMessage()`, `AgentEngine.runTurn()`, emissões de `tool_progress`, `turn_completed`, `turn_interrupted`
- Consumes: `AgentActionExecutor`, `ProviderResolver`, `SessionLeaseManager`, `PendingApprovalsManager`

- [ ] **Step 1: Atualizar testes de `AgentEngine` para validar ciclo completo com ferramentas**
Adicionar cenários onde o mock LLM retorna ações (`read_file`, `complete_task`) e verificar se o `MockAdapter` recebe os eventos `tool_progress` (`starting`, `completed`) e `turn_completed`.

- [ ] **Step 2: Implementar o loop conversacional e de ações no `AgentEngine`**
Mover a orquestração do prompt do sistema (`buildUnifiedSystemPrompt`), chamada ao provedor de LLM (`streamChat`), tratamento de `response.action` e emissão de eventos para dentro do `AgentEngine`.

- [ ] **Step 3: Executar testes unitários do `AgentEngine`**
Executar `npx vitest run src/core/engine/agent-engine.test.ts` e verificar PASS.

- [ ] **Step 4: Commit**
`git commit -m "feat: migrate agent reasoning and tool loop into AgentEngine"`

---

### Task 3: Refatorar `developer-agent.ts` como Fachada sobre `AgentEngine` + `CliAdapter`

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Modify: `src/core/adapters/cli/cli-adapter.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Produces: `interactiveDeveloperAgent(options)` delegando para `AgentEngine`
- Consumes: `AgentEngine`, `CliAdapter`

- [ ] **Step 1: Ajustar `CliAdapter` para lidar com aprovações interativas e prompts do terminal**
Garantir que o `CliAdapter` responda a `action_approval_request` perguntando ao usuário no terminal via `tui.confirm` e despachando `action_approval_response`.

- [ ] **Step 2: Refatorar `developer-agent.ts` para delegar para o `AgentEngine`**
Garantir que a função legada utilize o novo motor sem quebrar a API pública nem os hooks existentes (como Subagents e MCP).

- [ ] **Step 3: Executar a suíte de testes de `developer-agent`**
Executar `npx vitest run src/core/agents/developer-agent.test.ts` e garantir que todos os testes passem.

- [ ] **Step 4: Commit**
`git commit -m "refactor: turn developer-agent into facade over AgentEngine"`

---

### Task 4: Atualizar `WhatsAppAdapter` com Emissão de Progresso em Tempo Real

**Files:**
- Modify: `src/core/adapters/whatsapp/whatsapp-adapter.ts`
- Modify: `examples/whatsapp-bot/src/index.ts`
- Test: `src/core/adapters/whatsapp/whatsapp-adapter.test.ts`

**Interfaces:**
- Produces: Notificações de ferramentas em tempo real no WhatsApp (`tool_progress` -> mensagens/edições no WhatsApp)
- Consumes: `AgentOutboundEvent`

- [ ] **Step 1: Adicionar testes de emissão de progresso no `whatsapp-adapter.test.ts`**
Verificar se eventos `tool_progress` (`starting`, `completed`) enviam mensagens de status ou atualizam a mensagem no transporte do WhatsApp.

- [ ] **Step 2: Implementar envio de progresso no `WhatsAppAdapter`**
Quando o adapter receber `tool_progress`, enviar mensagem contextual ao usuário no WhatsApp (ex: `⚙️ [read_file] Lendo package.json...`).

- [ ] **Step 3: Testar e comitar**
`git commit -m "feat: enable real-time tool progress in WhatsAppAdapter"`

---

### Task 5: Validação Global e Demonstração no WhatsApp Bot

- [ ] **Step 1: Executar suite completa `npm test`**
Garantir 370+ testes verdes.
- [ ] **Step 2: Testar build (`npm run build`)**
Garantir compilação limpa do TypeScript.
- [ ] **Step 3: Validar a experiência no WhatsApp Bot conectado**
Confirmar que ao enviar "Investigue o projeto...", o usuário no WhatsApp recebe os status de ferramenta e a resposta completa sem travar.
