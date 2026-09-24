# Spec: Arquitetura Orientada a Eventos Multi-Canal (AgentEngine & Adapters)

**Data:** 2026-09-24  
**Status:** Aprovado  
**Escopo:** `shark-ai` (Core Engine, CLI, WhatsApp, Web, IDE)

---

## 1. Visão Geral e Motivação

Atualmente, o `shark dev` possui toda a lógica de orquestração do agente (`interactiveDeveloperAgent` em `src/core/agents/developer-agent.ts`) fortemente acoplada ao terminal. Ela depende diretamente de `process.stdin`, `@clack/prompts`, eventos ANSI e chamadas de renderização (`tui.log`, `tui.box`), além de manter promessas síncronas bloqueantes em memória (`waitForInputOrNotification`).

Essa arquitetura impede que novos canais (como WhatsApp, Telegram, Web UI, extensões de IDE ou automações via Webhook) interajam com o agente sem duplicar código ou gerar instabilidade. Em canais assíncronos e distribuídos como o WhatsApp:
- O usuário pode demorar minutos ou horas para responder a uma aprovação de ferramenta.
- O processo pode reiniciar ou cair enquanto aguarda resposta.
- Mensagens chegam picadas em rajada (*bursts*).
- O envio desenfreado de streaming de texto (*TextDeltas*) causa bloqueio por spam/rate-limit na API do canal.
- Mensagens simultâneas na mesma sessão podem gerar condições de corrida no SQLite e no sistema de arquivos.

Esta especificação define a refatoração do Shark AI para uma **Máquina de Estados Orientada a Eventos (*Event-Driven Engine*)** desacoplada do transporte, complementada por **Adaptadores de Canal Isolados (`AgentChannelAdapter`)**, persistência resiliente de aprovações com padrão **Pause & Resume** e trava de sessão contra concorrência (**`SessionTurnLease`**).

---

## 2. Arquitetura do Sistema

```text
               ┌────────────────────────────────────────────────────────┐
               │                   AgentEngine Core                     │
               │                                                        │
               │  ┌──────────────────────┐   ┌───────────────────────┐  │
               │  │   SessionTurnLease   │   │    AbortController    │  │
               │  │    (Trava SQLite)    │   │     (Cancelamento)    │  │
               │  └──────────────────────┘   └───────────────────────┘  │
               │  ┌──────────────────────┐   ┌───────────────────────┐  │
               │  │   Tool Orchestrator  │   │   PendingApprovals    │  │
               │  │   (c/ AbortSignal)   │   │   (Pause & Resume)    │  │
               │  └──────────────────────┘   └───────────────────────┘  │
               └───────────────────────────▲────────────────────────────┘
                                           │ Inbound / Outbound Events
                                           ▼
                             ┌───────────────────────────┐
                             │    AgentChannelAdapter    │
                             │        (Interface)        │
                             └─────────────┬─────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  ▼                        ▼                        ▼
           ┌─────────────┐   ┌──────────────────────────┐   ┌──────────────┐
           │ CliAdapter  │   │ WhatsAppAdapter          │   │ Server/Web   │
           │             │   │                          │   │ Adapter      │
           │ - TUI/Clack │   │ - Debouncer (0.8s)       │   │ (WebSocket/  │
           │ - Stdin/Raw │   │ - Throttler (1.5s)       │   │  JSON-RPC)   │
           │ - Fast-exit │   │ - In-place Status Edit   │   │              │
           │ - Zero delay│   │ - 3.5k Chunking + Anexo  │   │              │
           │             │   │ - Fallback Numérico      │   │              │
           │             │   │ - Pipeline STT / Visão   │   │              │
           │             │   │ - Filtro Menção Grupos   │   │              │
           └─────────────┘   └──────────────────────────┘   └──────────────┘
```

---

## 3. Contratos de Eventos e Interfaces

### 3.1 Interface `AgentChannelAdapter`
Todo canal de comunicação deve implementar o contrato canônico:

```ts
export interface AgentChannelAdapter {
    readonly channelId: string; // 'cli' | 'whatsapp' | 'web' | 'ide'

    /**
     * O Core do agente envia eventos para o canal.
     */
    emit(event: AgentOutboundEvent): Promise<void> | void;

    /**
     * O canal registra o callback para despachar eventos recebidos do usuário para o Core.
     */
    onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void;

    /**
     * Ciclo de vida opcional do adaptador.
     */
    start?(): Promise<void>;
    stop?(): Promise<void>;
}
```

### 3.2 Eventos de Entrada (*Inbound Events*)
Representam dados e ordens enviadas pelo usuário através do canal:

1. **`UserMessage`**:
   - `sessionId`: string (chave de roteamento da sessão, ex: `cli:local` ou `whatsapp:dm:5511999999999`).
   - `text`: string (texto enviado ou transcrição de áudio).
   - `media?`: array de anexos locais baixados (`{ path: string, mimeType: string }`).
   - `role`: `'user'`.
   - `origin`: `{ channelId: string, senderId: string, isGroup?: boolean }`.
2. **`ActionApprovalResponse`**:
   - `approvalId`: UUID da aprovação solicitada.
   - `decision`: `'approved' | 'rejected' | 'always'`.
   - `feedback?`: string opcional (caso o usuário queira redirecionar o agente ao rejeitar).
3. **`ClarifyResponse`**:
   - `questionId`: UUID da pergunta.
   - `answer`: string ou string[] selecionada pelo usuário.
4. **`AbortCommand`**:
   - `sessionId`: string.
   - `reason?`: string (ex: `'user_cancelled'`, `'new_priority_message'`).

### 3.3 Eventos de Saída (*Outbound Events*)
Representam a telemetria, streaming e solicitações do agente para o canal:

1. **`ReasoningDelta` / `TextDelta`**: Fragmentos de texto do raciocínio e da resposta gerada pelo LLM.
2. **`ToolProgress`**:
   - `toolName`: nome da ferramenta (ex: `bash`, `write_file`).
   - `status`: `'starting' | 'running' | 'completed' | 'failed'`.
   - `details?`: argumentos parciais, descrição da ação ou mensagem de erro.
3. **`ActionApprovalRequest`**:
   - `approvalId`: UUID único persistido no banco.
   - `toolName`: nome da ferramenta que requer aprovação.
   - `toolArgs`: parâmetros da ferramenta.
   - `riskLevel`: `'low' | 'medium' | 'high'`.
   - `ttlMs`: tempo limite de validade (ex: 600.000ms = 10 minutos).
   - `fallbackText`: mensagem formatada para canais sem botões nativos.
4. **`ClarifyRequest`**:
   - `questionId`: UUID único.
   - `question`: texto da pergunta.
   - `options?`: lista de opções de escolha.
5. **`MediaAttachment`**:
   - `filePath`: caminho absoluto do artefato gerado (PDF, PNG, ZIP, TXT).
   - `mimeType`: tipo MIME do arquivo.
   - `caption?`: legenda resumida para o chat.
6. **`PresenceStatus`**:
   - `status`: `'typing' | 'idle' | 'executing_tool'`.
   - `emojiReaction?`: `'👀' | '✅' | '❌'`.
7. **`TurnCompleted`**:
   - `sessionId`: string.
   - `summary`: string final da tarefa.
8. **`TurnInterrupted`**:
   - `sessionId`: string.
   - `reason`: string informativa.

---

## 4. Persistência, Concorrência e Tolerância a Falhas (StateDB / SQLite)

### 4.1 Trava de Turno de Sessão (`SessionTurnLease`)
Para evitar que múltiplos comandos ou mensagens concorrentes corrompam a mesma sessão:

* **Tabela SQLite `session_turn_leases`:**
  ```sql
  CREATE TABLE IF NOT EXISTS session_turn_leases (
      session_id TEXT PRIMARY KEY,
      holder_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
  );
  ```
* **Regras de Negócio do Lease:**
  - **Duração do Lease:** TTL de 30 segundos.
  - **Heartbeat:** Renovado a cada 5 segundos pelo turno ativo durante a execução de ferramentas.
  - **Recuperação de Crash:** Se o processo Node.js cair abruptamente, após 30 segundos sem heartbeat o lease é considerado expirado e pode ser adquirido por uma nova mensagem do usuário.
  - **Tratamento de Concorrência:**
    - Se o canal enviar um `AbortCommand`, ele ignora o lock e aciona imediatamente o `AbortController` do turno atual.
    - Se for uma nova `UserMessage` e a sessão estiver ocupada: o engine pode enfileirar ou abortar graciosamente o turno anterior para assumir a nova instrução prioritária.

### 4.2 Padrão Pause & Resume com `pending_approvals`
Elimina `await waitFor(...)` em memória, permitindo pausas indeterminadas e tolerância a reinicializações:

* **Tabela SQLite `pending_approvals`:**
  ```sql
  CREATE TABLE IF NOT EXISTS pending_approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      checkpoint_message_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_args TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      resolved_at INTEGER
  );
  ```
* **Fluxo de Aprovação:**
  1. O agente identifica uma ferramenta sensível que necessita de aprovação humana.
  2. Grava um novo registro em `pending_approvals` com `status = 'pending'`, salvando o `checkpoint_message_id` (última mensagem persistida no histórico).
  3. Emite `ActionApprovalRequest` para o canal ativo.
  4. O turno entra em estado **PAUSED** e o processo pode ser liberado (não consome memória com listeners bloqueantes).
  5. Quando o webhook/usuário responde:
     - Executa atualização atômica de proteção contra duplo clique:
       ```sql
       UPDATE pending_approvals 
       SET status = 'approved', resolved_at = ? 
       WHERE id = ? AND status = 'pending';
       ```
     - Se `changes === 0`, a requisição já foi tratada anteriormente ou expirou.
     - Se `changes === 1`, o `AgentEngine` carrega as mensagens até `checkpoint_message_id`, injeta a aprovação e retoma o loop de ferramentas de forma transparente.
* **Reaper de Expiração (TTL):**
  - Aprovações não respondidas dentro de `expires_at` são marcadas como `expired` e liberam a sessão para novas instruções.

### 4.3 Cancelamento Ativo (`AbortController`)
* Cada turno ativo instancia um `AbortController`.
* Esse controller é repassado a:
  - Chamadas de LLM via `fetch` (`signal: abortController.signal`).
  - Execução de comandos shell via `execa` (`signal: abortController.signal`).
  - Execução de subagentes e MCP tools.
* Ao receber um `AbortCommand`, `abortController.abort()` é chamado imediatamente, interrompendo processos filhos no sistema operacional sem deixar processos zumbis.

---

## 5. Especificação dos Adaptadores de Canal

### 5.1 `CliAdapter` (Terminal do Desenvolvedor)
* **Objetivo:** Experiência de desenvolvimento local interativa, com latência zero.
* **Entradas:**
  - `stdin` configurado para capturar comandos, `/refine`, `/chat` e seleção de menus com `@clack/prompts`.
  - Captura imediata da tecla `Esc` para disparar `AbortCommand` sem encerrar o processo Node.js.
  - `Ctrl+C` mantido para encerramento de emergência.
* **Saídas:**
  - Streaming contínuo: cada `TextDelta` é escrito no `stdout` instantaneamente.
  - `ToolProgress`: exibe caixas coloridas (`tui.box`), diffs com cores ANSI e spinners informativos.
  - `Thought`: renderizado em estilo esmaecido (*dim*).

### 5.2 `WhatsAppAdapter` (Redes de Mensagens Assíncronas)
* **Objetivo:** Comunicação estável, anti-spam, anti-ban e resiliente a falhas de rede.
* **Separação Arquitetural (Adapter vs. Driver/Transport):**
  - **`WhatsAppAdapter`:** Implementa `AgentChannelAdapter`. Responsável estritamente pela lógica comportamental e tradução de eventos (debouncing, throttling, fatiamento de caracteres, parsing de respostas numéricas e conversão de markdown). **Não depende diretamente de nenhuma biblioteca pesada de WhatsApp**, evitando inchar o CLI.
  - **`WhatsAppTransport` (Interface de Rede Plugável):** Interface injetada no adapter (`sendText`, `sendMedia`, `editMessage`, `onRawMessage`). Pode ser implementada por diferentes drivers de acordo com o ambiente:
    1. *Driver Baileys:* Conexão direta via WebSockets/QR Code local em Node.js.
    2. *Driver Evolution API / Z-API:* Comunicação via chamadas HTTP REST / Webhooks para um microserviço intermediário.
    3. *Driver Meta Cloud API Oficial:* Conexão oficial via Graph API e Webhooks.
* **Entradas:**
  - **Quiet-Period Debouncer (0.8s):** Mensagens consecutivas do mesmo usuário em um intervalo inferior a 800ms são consolidadas em um único `UserMessage`.
  - **Filtro de Menção em Grupos:** Em grupos de WhatsApp, ignora conversas paralelas e só aciona o agente se houver menção explícita (`@Shark`) ou resposta direta (*quote*) a uma mensagem do bot.
  - **Pipeline STT & Visão:** Áudios são baixados e transcritos via Whisper/STT; imagens de erros e capturas de tela são baixadas localmente e repassadas em `UserMessage.media`.
  - **Fallback Numérico de Seleção:** Suporta tanto o clique em botões interativos do WhatsApp quanto respostas textuais diretas (*"1"*, *"2"*, *"sim"*, *"não"*).
* **Saídas:**
  - **Output Throttler (1.5s):** Acumula deltas de texto do modelo e só atualiza o WhatsApp a cada 1.5s para evitar bloqueio por taxa de requisições.
  - **In-Place Status Editing:** Utiliza edição da mensagem de progresso existente para atualizar status (*"🔍 Lendo arquivos..."* -> *"⚙️ Rodando testes..."*), mantendo a conversa limpa.
  - **Fatiamento Inteligente (3.500 caracteres):** Mensagens longas são fatiadas respeitando quebras de linha e blocos de código. Mensagens que ultrapassem 10.000 caracteres são exportadas como anexo `.txt`/`.md` com legenda explicativa.
  - **Reações e Presença:** Dispara indicador de digitação (*typing*) e reações de emoji (👀 ao iniciar, ✅ ao concluir).

---

## 6. Estrutura de Arquivos e Plano de Transição

### 6.1 Nova Estrutura de Diretórios
```text
src/
├── core/
│   ├── engine/
│   │   ├── agent-engine.ts           # Máquina de estados principal e loop agnóstico
│   │   ├── events.ts                 # Definições de tipos AgentInboundEvent e AgentOutboundEvent
│   │   ├── session-lease.ts          # SessionTurnLease e controle de locks no SQLite
│   │   └── pending-approvals.ts      # Controle de aprovações duráveis, TTL e resume
│   ├── adapters/
│   │   ├── adapter.interface.ts      # Contrato AgentChannelAdapter
│   │   ├── cli/
│   │   │   ├── cli-adapter.ts        # Renderizador Clack/TUI e listener de Stdin/Esc
│   │   │   └── formatting.ts         # Utilitários de ANSI, Markdown e Diffs
│   │   └── whatsapp/                 # Adaptador de mensagens assíncronas
│   │       ├── whatsapp-adapter.ts   # Debouncer, Throttler e ciclo de eventos
│   │       ├── chunker.ts            # Fatiador de 3.5k caracteres e exportador de anexos
│   │       └── media-pipeline.ts     # Pipeline de download, STT e anexos
│   └── agents/
│       └── developer-agent.ts        # Fachada para retrocompatibilidade
└── commands/
    ├── dev.ts                        # Inicializa AgentEngine + CliAdapter
    └── serve.ts                      # Comando para rodar Shark em modo servidor/gateway
```

### 6.2 Retrocompatibilidade de `developer-agent.ts`
Para garantir que nenhum comando ou teste automatizado existente quebre durante a transição, a função legada `interactiveDeveloperAgent` torna-se uma fachada simples:

```ts
export async function interactiveDeveloperAgent(options: DeveloperAgentOptions = {}): Promise<DevelopmentResult> {
    const engine = new AgentEngine({
        taskId: options.taskId,
        context: options.context,
        auto: options.auto
    });

    const cliAdapter = new CliAdapter({
        auto: options.auto
    });

    engine.attachAdapter(cliAdapter);
    return engine.run(options.taskInstruction);
}
```

---

## 7. Estratégia de Testes

1. **Testes do Core com `MockAdapter` (`agent-engine.test.ts`):**
   - Validação de transições de estado, emissão de eventos e respostas sem tocar no terminal ou na rede.
2. **Testes de Concorrência e Lease (`session-lease.test.ts`):**
   - Garantir que duas instâncias concorrentes não consigam adquirir o lease para a mesma sessão.
   - Testar liberação automática de lease após expiração do TTL de 30s.
3. **Testes de Idempotência e Pause/Resume (`pending-approvals.test.ts`):**
   - Validar que cliques duplicados em aprovações retornam `changes === 0`.
   - Validar que aprovações expiradas pelo TTL não executam a ferramenta associada.
4. **Testes Unitários dos Adaptadores:**
   - `CliAdapter`: verificação de renderização e propagação de teclas com streams mockadas.
   - `WhatsAppAdapter`: verificação de debouncing (0.8s) e throttling (1.5s) com temporizadores simulados (`vi.useFakeTimers()`).
   - `chunker.test.ts`: garantia de que blocos de código não são corrompidos ao fatiar mensagens de 3.500 caracteres.
