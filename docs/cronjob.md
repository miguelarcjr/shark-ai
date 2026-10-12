Aqui está a **Especificação de Análise de Requisitos (SRS — Software Requirements Specification)** para a implementação do recurso de **Espelhamento de Notificações Agendadas (*Delivery Mirroring*) e Reativação de Contexto** no **Shark AI**, baseada na arquitetura do Hermes Agent:

---

# Documento de Análise de Requisitos: Espelhamento de Notificações e Reativação de Contexto (*Delivery Mirroring*)

## 1. Visão Geral e Escopo
O objetivo desta especificação é definir a arquitetura para garantir que, quando um **cronjob** ou **agendamento pontual (*one-shot*)** for executado pelo daemon do sistema para notificar o usuário (ex.: um lembrete ou relatório enviado via `deliver: "origin"` ou para um canal como WhatsApp/Telegram) [cite: 6, 13, 248], a mensagem gerada seja **espelhada (*mirrored*) e persistida diretamente no histórico da sessão de conversa ativa do usuário** [cite: 248, 325, 468, 471].

Isso resolve o problema de "amnésia de notificação": quando o usuário responde à notificação enviada pelo bot (ex.: *"Legal, qual é o primeiro passo?"*), a LLM recebe o histórico completo contendo a mensagem do lembrete espelhada, mantendo o contexto sem perda de informação [cite: 248, 325, 471].

---

## 2. Casos de Uso (UC)

### UC01 — Agendamento de Lembrete ou Notificação
* **Ator**: Usuário ou Agente [cite: 63].
* **Fluxo Principal**:
  1. O usuário solicita um lembrete ou acompanhamento em data/hora específica (ex.: *"Me lembre de revisarmos a PR na terça-feira às 16:00"*).
  2. O agente chama a ferramenta `cronjob(action="create", schedule="<ISO_TIMESTAMP>", prompt="...", deliver="origin")` [cite: 6, 63].
  3. O Gateway armazena o job no registro atômico de agendamentos (`jobs.json`), vinculando os metadados da sessão de origem (`platform`, `chat_id`, `thread_id`) [cite: 6, 420].

### UC02 — Execução e Espelhamento de Entrega (*Delivery Mirroring*)
* **Ator**: Daemon/Agendador de Segundo Plano (`InProcessCronScheduler` / Gateway) [cite: 6, 8].
* **Fluxo Principal**:
  1. No carimbo temporal agendado, o daemon executa o cronjob em uma sessão limpa e isolada (*fresh session*) [cite: 11, 248].
  2. O relatório/lembrete gerado é enviado para o canal externo via `DeliveryRouter` [cite: 13, 18, 321].
  3. O componente `gateway/[link suspeito removido]` (`mirror_to_session`) intercepta a confirmação de entrega e grava uma cópia dessa mensagem diretamente na tabela `messages` do `state.db` da sessão de origem do usuário [cite: 79, 324, 325, 471].

### UC03 — Reativação da Conversa pelo Usuário
* **Ator**: Usuário.
* **Fluxo Principal**:
  1. O usuário visualiza o lembrete no seu aplicativo de mensagem e digita uma resposta na conversa [cite: 248, 471].
  2. O motor do agente carrega o histórico do `state.db`, que já inclui a mensagem do lembrete espelhada [cite: 79, 248, 325].
  3. A LLM processa a resposta do usuário mantendo a continuidade do diálogo e a alternância estrita de papéis (*role alternation*) [cite: 248, 325].

---

## 3. Requisitos Funcionais (RF)

* **RF01 — Rotulagem e Atribuição da Mensagem Espelhada**:
  * A mensagem injetada no banco de dados da sessão do usuário deve conter um prefixo estruturado indicando a origem da automação [cite: 222, 248, 471]:
    ```text
    [Cron delivery: <Nome_do_Job>]
    <Conteúdo do Lembrete/Relatório>
    ``` [cite: 222, 471]
  * *Propósito*: Informar explicitamente à LLM nos turnos seguintes que aquele texto foi emitido pelo sistema no horário agendado, e não digitado pelo usuário humano [cite: 248].

* **RF02 — Preservação da Alternância Estrita de Papéis (*Role Alternation*)**:
  * Quando a notificação for espelhada na conversa do usuário, ela deve ser inserida gravada com o papel **`user`** (marcada com rótulo do sistema) ou **`assistant`** de acordo com a exigência da API do provedor de LLM [cite: 248, 325, 471].
  * A injeção deve ser anexada na **fronteira do turno (*turn boundary*)**, garantindo que não quebre a sequência alternada `user` → `assistant` [cite: 4, 248, 325].

* **RF03 — Desativação de Ferramentas Interativas durante a Execução**:
  * Durante o processamento do `cronjob` que gera a notificação, as ferramentas interativas **`clarify`** (perguntas ao usuário) e a própria **`cronjob`** (trava antirrecursiva) devem ser desativadas pelo runtime [cite: 11, 16].
  * O script do agendamento roda de forma 100% autônoma até produzir o texto final do lembrete [cite: 11, 248].

* **RF04 — Elegibilidade de Espelhamento (`mirror_delivery`)**:
  * O espelhamento deve ocorrer quando o parâmetro de entrega do job for [cite: 468, 469, 471]:
    1. `deliver: "origin"` (retorno à conversa de origem) [cite: 468, 469, 471];
    2. `deliver: "<platform>"` (canal principal configurado pelo usuário, ex.: `deliver: "whatsapp"`) [cite: 13, 469, 471];
    3. `deliver: "<platform>:<chat_id>"` com a opção **`attach_to_session: true`** habilitada no job [cite: 469, 471].
  * **Regra de Exceção**: Notificações transmitidas em modo broadcast (`deliver: "all"`) **nunca** devem ser espelhadas em sessões individuais para não poluir o histórico dos usuários [cite: 469, 471].

---

## 4. Requisitos Não-Funcionais (RNF)

* **RNF01 — Persistência no SQLite `state.db` em Modo WAL**:
  * O espelhamento de mensagens deve ser gravado de forma síncrona no SQLite da sessão (`state.db`) utilizando **PRAGMA journal_mode = WAL** e **PRAGMA busy_timeout = 5000** [cite: 146, 252].
  * As triggers automáticas da tabela virtual **`messages_fts` (FTS5)** devem atualizar os índices no mesmo momento da inserção, permitindo que buscas textuais de histórico (`session_search`) encontrem lembretes passados [cite: 79, 144].

* **RNF02 — Resiliência de Entrega (*Delivery Ledger*)**:
  * Se o envio da notificação para o aplicativo externo falhar (ex.: queda do gateway do Telegram/WhatsApp), o sistema registra o status `delivery_failed` no livro de obrigações de entrega (`deliveries.db`) e **não realiza o espelhamento na conversa do usuário** até que o envio seja confirmado [cite: 7, 249, 252].

* **RNF03 — Preservação do *Prompt Caching***:
  * A injeção da mensagem espelhada no histórico da conversa não altera o **System Prompt congelado** nem altera o catálogo estático de ferramentas, garantindo reaproveitamento de ~75% dos tokens de entrada no *Prompt Cache* (padrão Anthropic/OpenAI) [cite: 4, 5, 106].

---

## 5. Esquema de Dados e Fluxo no SQLite (`state.db`)

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             SISTEMA DE DELIVERY DE CRON                           │
│                                                                                  │
│   1. Executa job agendado em sessão isolada (Fresh AIAgent Session)             │
│   2. Gera texto: "Lembrete: Revisão do PR #1234"                                 │
│   3. Valida envio com sucesso no adaptador (WhatsApp/Telegram/Discord)           │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           COMPONENTE: gateway/[link suspeito removido]                          │
│                                                                                  │
│   mirror_to_session(                                                             │
│       platform="whatsapp",                                                       │
│       chat_id="5511999999999",                                                   │
│       message_text="[Cron delivery: Lembrete PR]\nLembrete: Revisão do PR #1234",│
│       role="user"                                                                │
│   )                                                                              │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         ARMAZENAMENTO: SQLite (~/.shark/state.db)               │
│                                                                                  │
│   INSERT INTO messages (session_id, role, content, timestamp)                    │
│   VALUES ('sess_123', 'user', '[Cron delivery: Lembrete PR]...', 1760180000);    │
│                                                                                  │
│   -- Trigger FTS5 dispara automaticamente para indexação do conteúdo             │
└──────────────────────────────────────────────────────────────────────────────────┘
``` [cite: 79, 144, 252, 324, 325, 471]

---

## 6. Regras de Negócio (RN)

* **RN01 — Silenciamento Silencioso (`[SILENT]`)**:
  * Se a resposta gerada pelo agendamento contiver ou for exatamente o token `[SILENT]`, tanto a notificação externa quanto o espelhamento na conversa são totalmente cancelados [cite: 15, 26, 264].

* **RN02 — Isolamento da Janela de Leitura**:
  * O processo em segundo plano do cronjob apenas escreve no banco da sessão do usuário ao concluir a entrega; ele não interfere nem trava a mensagem que o usuário possa estar digitando no mesmo instante no chat [cite: 11, 248, 325].

* **RN03 — Desduplicação de Entregas**:
  * Mensagens registradas no livro de entregas (`deliveries.db`) possuem chave de execução única (`execution_id`), impedindo que reinicializações do daemon enviem notificações duplicadas ou espelhem o mesmo lembrete duas vezes no histórico [cite: 16, 249, 252].

No **Hermes Agent** (e no modelo de requisitos para o **Shark AI**), a mensagem gerada por uma tarefa agendada ou cronjob **não é espelhada** no histórico da conversa do usuário nos seguintes casos específicos:

1. **Uso do Token de Silêncio (`[SILENT]`)**:
   * Se a resposta gerada pelo modelo ou script contiver ou for exatamente o token `[SILENT]` (ou variações como `NO_REPLY`), o envio externo é cancelado e **o espelhamento no chat é totalmente suprimido**. Isso é usado em rotinas de monitoramento quando nada mudou.

2. **Transmissões em Massa (*Broadcast / `deliver: "all"`*)**:
   * Disparos em massa direcionados para múltiplos canais (`deliver: "all"`) **não são espelhados em chats individuais** para evitar contaminação e poluição de histórico nas sessões ativas dos usuários.

3. **Destinos Explícitos de Terceiros sem `attach_to_session`**:
   * Se a entrega for configurada para um canal ou ID de chat de terceiros específico (ex.: `deliver: "telegram:-1001234567890"` ou `deliver: "slack:C01234"`), ela **não é espelhada** por padrão. 
   * A mensagem só será espelhada na sessão se a opção **`attach_to_session: true`** tiver sido explicitamente ativada ao criar a tarefa. (Por padrão, apenas alvos de conversa direta como `deliver: "origin"` ou o canal principal da plataforma têm elegibilidade automática).

4. **Falha na Entrega para o Canal Externo (`delivery_failed`)**:
   * Se o envio da notificação falhar no adaptador de destino (por exemplo, erro de conexão, bot bloqueado ou falha no gateway de mensageria), a mensagem é marcada como falha no registro de entregas e **não é inserida na conversa** até que a entrega seja confirmada.

5. **Modo de Salvamento Apenas Local (`deliver: "local"`)**:
   * Quando o job é configurado com `deliver: "local"`, o relatório é gravado apenas como um arquivo `.md` no diretório local (`~/.hermes/cron/output/`). Como nenhuma mensagem é transmitida para uma plataforma de chat, **nenhum espelhamento de sessão ocorre**.
