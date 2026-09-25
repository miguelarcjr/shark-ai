# Spec: Modularização e Decomposição do AgentEngine

**Data:** 2026-09-25  
**Status:** Aprovado  
**Escopo:** `shark-ai` (`src/core/engine/`)

---

## 1. Visão Geral e Motivação

Recentemente, a arquitetura do Shark AI foi migrada para um modelo agnóstico de canais, reduzindo o arquivo `developer-agent.ts` de 1.546 linhas para apenas 47 linhas como uma fachada limpa. No entanto, o novo [`AgentEngine`](file:///d:/projetos/bmadspot/src/core/engine/agent-engine.ts) absorveu múltiplas responsabilidades e ultrapassou 850 linhas.

Atualmente, o `AgentEngine` acumula:
1. **Coordenação de Sessão e Canais:** Gerenciamento de eventos (`attachAdapter`, `emitOutbound`), controle de leases (`SessionLeaseManager`) e interrupções (`AbortController`).
2. **Setup de Ambiente e Contexto:** Inicialização de servidores MCP (`McpManager`), snapshot de memória (`MemoryStore`), formatação de skills index, injeção de `project-context.md` e histórico, e montagem do prompt dinâmico do sistema.
3. **Sincronização de Subagentes:** Leitura da mailbox de disco e fila em memória, formatação de notificações em XML (`<subagent_notification>`), montagem do painel de subagentes ativos e manipulação de sinais de encerramento (`SIGINT`/`SIGTERM`) para limpar processos filhos.
4. **Laço de Execução ReAct:** Loop interativo principal (`while (keepGoing)`), compressão de histórico (`ContextCompressor`), chamadas ao LLM (`activeProvider.streamChat`), parsing de strings de conclusão/falha (`TASK_COMPLETED:` / `TASK_FAILED:`) e despacho de ações de controle (`complete_task`, `wait`, `talk_with_user`).

Esta especificação define a decomposição do `AgentEngine` em módulos menores, altamente coesos e testáveis, trazendo o `agent-engine.ts` para menos de 200 linhas de pura orquestração.

---

## 2. Nova Arquitetura de Módulos

```text
src/core/engine/
├── agent-engine.ts              # Orquestrador central (~150-180 linhas): leases, adapters, eventos e disparo
├── engine-context-builder.ts    # Setup (~120-150 linhas): MCP, Memory, Skills, ProjectContext e System Prompt
├── subagent-sync.ts             # Sincronização (~90-120 linhas): drain mailbox (XML), painel ativo e cleanup SIGINT/SIGTERM
├── turn-loop-runner.ts          # Ciclo ReAct (~200-250 linhas): chamada LLM, compressão e despacho de ações
├── agent-action-executor.ts     # Já existente: execução de ferramentas
├── agent-slash-commands.ts      # Já existente: tratamento de comandos slash
└── ...
```

---

## 3. Detalhamento dos Componentes e Responsabilidades

### 3.1 `engine-context-builder.ts`
Responsável por toda a infraestrutura inicial de contexto antes do início dos turnos:
- Inicializa servidores MCP via `McpManager` e gera o manifesto `generateTieredManifest`.
- Carrega snapshots do `MemoryStore`.
- Formata metadados de skills via `skillManager.formatSkillsIndex`.
- Constrói o `dynamicSystemPrompt` unificado (`buildUnifiedSystemPrompt`).
- Resolve `project-context.md` e histórico anterior para formar o prompt base inicial.
- Fornece um callback `updateDynamicPrompt()` invocado caso ferramentas atualizem a memória durante a execução.

```ts
export interface PreparedEngineContext {
    dynamicSystemPrompt: string;
    basePrompt: string;
    mcpManager: McpManager;
    bridgeTools: BridgeToolsManager;
    memoryStore: MemoryStore;
    activeProvider: any;
    activeConversationId: string;
    conversationKey: string;
    forkReviewAgent: ForkReviewAgent;
    updateDynamicPrompt: () => Promise<void>;
}
```

### 3.2 `subagent-sync.ts`
Isola os detalhes de concorrência e sincronização de subagentes:
- `drainIncomingNotifications(recipientId: string, messageQueue: MessageQueue): Promise<string[]>`:
  Lê mensagens em disco (`subagentManager.retrieveMessages`) e drena a fila assíncrona (`messageQueue`), formatando com `<subagent_notification status="...">`.
- `formatActiveSubagentsPanel(parentId: string): string`:
  Gera o bloco textual descritivo dos subagentes atualmente em execução paralela.
- `setupProcessCleanup(parentId: string, log: (msg: string) => void): { dispose: () => void }`:
  Registra handlers de `SIGINT` e `SIGTERM` para encerrar todos os subagentes filhos e retorna função de descarte para ser chamada no bloco `finally`.
- `terminateChildSubagents(parentId: string)`:
  Função auxiliar para matar subagentes restantes ao término de uma tarefa ou cancelamento.

### 3.3 `turn-loop-runner.ts`
Implementa o laço de execução do agente (`ReActLoop`):
- Recebe o contexto preparado (`PreparedEngineContext`), `actionExecutor`, `abortController`, `messageQueue`, `adapter` e opções de execução.
- Executa o loop `while (keepGoing)`:
  1. Verifica se houve abort do turno.
  2. Coleta mensagens recebidas via `drainIncomingNotifications` e injeta painel de `formatActiveSubagentsPanel`.
  3. Executa compressão com tail-protection (`ContextCompressor.compress`).
  4. Executa `streamChat` com o provedor ativo com tratamento de `AbortError` / tecla Esc.
  5. Trata respostas de texto (`TASK_COMPLETED:` / `TASK_FAILED:`).
  6. Despacha ações especiais:
     - `complete_task`: finaliza a tarefa, atualiza status do subagente (se aplicável), dispara `forkReviewAgent` e exibe/pergunta feedback.
     - `wait`: pausa pelo tempo determinado ou aguarda nova mensagem na `messageQueue`.
     - `talk_with_user`: envia mensagem interativa, verifica restrições de subagente e aguarda input do usuário.
     - Demais ações: delega para `actionExecutor.executeAction(action)`.
- Retorna `Promise<DevelopmentResult>` padronizado `{ success: boolean, summary: string }`.

### 3.4 `agent-engine.ts` (Orquestrador Refatorado)
Atua como ponto focal enxuto:
- Expõe a API pública inalterada: `attachAdapter()`, `abortCurrentTurn()`, `emitOutbound()`, `processMessage()`, `runInteractive()`.
- Gerencia leases com `SessionLeaseManager`.
- Cria e orquestra a chamada de `EngineContextBuilder.prepare()` e `TurnLoopRunner.run()`.
- Bloco `finally` rigoroso: limpa ferramentas (`cleanupAgentTools()`), fecha servidores MCP (`mcpManager.closeAll()`) e descarta listeners de processo.

---

## 4. Garantia de Retrocompatibilidade e Testes

- **Assinaturas Públicas Inalteradas:** Todas as interfaces (`AgentEngineOptions`, `EngineRunOptions`, `DevelopmentResult`) continuam idênticas.
- **Integração com CLI e WhatsApp:** O [`developer-agent.ts`](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts) e adaptadores existentes continuam instanciando e executando `AgentEngine` exatamente como antes.
- **Suíte de Testes:** A suíte existente em `src/core/engine/` (`agent-engine.test.ts`, `agent-action-executor.test.ts`, `pending-approvals.test.ts`, etc.) continuará passando sem alterações nos casos de teste externos. Testes unitários dedicados serão adicionados para `engine-context-builder` e `subagent-sync`.
