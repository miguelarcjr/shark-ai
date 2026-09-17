Aqui está a representação visual completa da arquitetura determinística de memória, execução in-loop e aprendizado autônomo inspirada no Hermes Agent para o **Shark AI**:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                   1. SYSTEM PROMPT (FROZEN SNAPSHOT CONGELADO NO BOOT)                   │
│ ┌──────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Camada Estável (Prefix Cache — 75% a 90% de economia de tokens)                       │ │
│ │ ├─ [SOUL.md] (~1.000 chars / ~350 tokens — Identidade e Persona — Somente-Leitura)   │ │
│ │ ├─ [USER.md] (~1.375 chars / ~500 tokens — Perfil Global do Desenvolvedor)            │ │
│ │ ├─ [MEMORY.md] (~2.200 chars / ~800 tokens — Notas e Convenções Locais do Projeto)   │ │
│ │ └─ <available_skills> (Índice Leve: Nome + Descrição de 1 linha de até 60 chars)     │ │
│ ├──────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ Camada de Repositório (Estável por Projeto)                                          │ │
│ │ └─ [AGENTS.md / .hermes.md] (Regras de Negócio e Arquitetura do Código-Fonte)        │ │
│ └──────────────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            │
                                            ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                         2. MOTOR DE EXECUÇÃO E REVELAÇÃO PROGRESSIVA                     │
│                                                                                          │
│   User Prompt ──► [LLM Principal] ──► Raciocínio (<think>) + Chamadas de Ferramentas     │
│                        │                                                                 │
│       ┌────────────────┼────────────────────────┬──────────────────────┐                 │
│       │                │                        │                      │                 │
│       ▼                ▼                        ▼                      ▼                 │
│  skill_view()    memory_tool()            tool_search()         session_search()         │
│  (Carrega        (Atualiza disco          (Busca BM25          (Busca textual FTS5       │
│   SKILL.md        sem alterar             em ferramentas        no SQLite local          │
│   sob demanda)    prompt ativo)            diferidas / MCP)     em <10ms)                │
└───────┬────────────────┬────────────────────────┬──────────────────────┬─────────────────┘
        │                │                        │                      │
        ▼                │                        ▼                      │
┌──────────────┐         │             ┌────────────────────┐            │
│  [SKILL.md]  │         │             │  [MCP Server]      │            │
│  (Entra como│         │             │  (Schema retornado │            │
│   turno de   │         │             │   via tool_describe│            │
│   ferramenta)│         │             └────────────────────┘            │
└──────────────┘         │                                               │
                         ▼                                               ▼
┌──────────────────────────────────────────────┐       ┌───────────────────────────────────┐
│     3. ARQUIVOS PLANOS (MemoryStore)         │       │    4. STATE DB (SQLite FTS5)      │
│  - ~/.shark/SOUL.md (Somente-Leitura)        │       │  - state.db (Modo WAL)            │
│  - ~/.shark/USER.md (Global)                 │       │  - Tabela FTS5: messages_fts      │
│  - <workspace>/.shark/MEMORY.md (Local)      │       │  - Triggers de Sincronização      │
└──────────────────────┬───────────────────────┘       └───────────────────────────────────┘
                       │
                       │ (Contadores de Turno / Iterações)
                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                    5. APRENDIZADO AUTÔNOMO E MANUTENÇÃO EM SEGUNDO PLANO                 │
│                                                                                          │
│   ┌────────────────────────────────────────┐   ┌─────────────────────────────────────┐   │
│   │ Fork Review Agent (In-Memory)          │   │ Curator (Manutenção em Standby)     │   │
│   │ ├─ Dispara a cada N turnos/iterações   │   │ ├─ Rastreia telemetria de uso       │   │
│   │ ├─ Reflete sobre o histórico recente   │   │ ├─ Marca como 'stale' (30 dias)     │   │
│   │ ├─ Atualiza MEMORY.md e USER.md        │   │ └─ Arquiva em '.archive/' (90 dias) │   │
│   │ └─ Redige novas Skills (skill_manage)  │   │                                     │   │
│   └────────────────────────────────────────┘   └─────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Detalhamento das 5 Camadas da Arquitetura

#### 1. System Prompt & Frozen Snapshot (Camada Estável)
* **Preservação de Prompt Caching**: O System Prompt é montado no boot da sessão e permanece **congelado** durante toda a conversa ativa [cite: 81, 130]. Isso garante até 90% de desconto em tokens de entrada nas chamadas subsequentes [cite: 81, 130].
* **Limites Rígidos de Caracteres**:
  * **`SOUL.md`**: Teto de **1.000 caracteres** (~350 tokens). Define a persona e é **estritamente somente-leitura** para o agente, impedindo ataques de *prompt injection* [cite: 81, 128, 129].
  * **`USER.md`**: Teto de **1.375 caracteres** (~500 tokens). Escopo global (`~/.shark/USER.md`) para o perfil do desenvolvedor [cite: 81, 128].
  * **`MEMORY.md`**: Teto de **2.200 caracteres** (~800 tokens). Escopo local (`<workspace>/.shark/MEMORY.md`) para fatos e convenções do repositório [cite: 81, 128].
* **Índice Leve de Skills**: O prompt não carrega o código das skills, apenas a tag `<available_skills>` contendo o nome e uma descrição curta de 1 linha (até 60 caracteres) por habilidade [cite: 81, 131, 132].

#### 2. Execução In-Loop & Revelação Progressiva (*Progressive Disclosure*)
* **Carregamento de Skills (`skill_view`)**: Se a tarefa exigir um manual procedimental longo, o agente executa `skill_view(name)` [cite: 132, 308]. O conteúdo do `SKILL.md` entra no histórico do chat como um turno de ferramenta, sem sujar ou alterar o System Prompt base [cite: 132].
* **Busca de Ferramentas Diferidas (`tool_search` / `tool_describe`)**: Para integrações extensas de MCPs, o agente usa busca léxica BM25 para encontrar a ferramenta (`tool_search`), solicita seu schema JSON (`tool_describe`) e a executa (`tool_call`) [cite: 211, 467].
* **Gravações de Memória (`memory_tool`)**: Quando o agente roda `add`, `replace` ou `remove`, o arquivo físico no disco é atualizado na hora [cite: 81, 130]. No entanto, o System Prompt ativo continua congelado para não quebrar o cache; o novo dado só entrará no prompt na sessão seguinte [cite: 81, 130].

#### 3. Persistência e Busca Histórica (`StateDB` - SQLite FTS5)
* **Banco de Dados Local (`state.db`)**: Todas as mensagens de todas as sessões do projeto são salvas em modo WAL (*Write-Ahead Logging*) no SQLite local [cite: 80, 81, 127].
* **Busca Textual de Alta Performance (`session_search`)**: A tabela virtual `messages_fts` (FTS5) permite ao agente consultar conversas passadas via texto completo em **menos de 10ms**, sem gastar tokens com RAG vetorial ou modelos de embeddings [cite: 80, 81, 127].

#### 4. Gestão Determinística de Janela (`ContextCompressor`)
* **Gatilho de Tolerância**: Dispara apenas quando a conversa atinge 80% do teto da janela de contexto [cite: 80, 81, 137].
* **Estratégia de *Tail Protection***:
  * **Pinned (Fixo)**: System Prompt + Turnos 0/1 do usuário mantidos intactos no topo [cite: 80, 137].
  * **Middle (Miolo)**: Trecho intermediário antigo é resumido em um bloco condensado [cite: 80, 137].
  * **Tail (Cauda Mantida)**: As últimas 15 a 20 mensagens mais recentes são preservadas na íntegra para manter o contexto imediato de execução [cite: 80, 81, 137].

#### 5. Aprendizado Autônomo e Curadoria (*Self-Improvement Loop* & *Curator*)
* **Fork em Segundo Plano**: Um agente de revisão em segundo plano roda periodicamente sobre um snapshot em memória da sessão (sem congelar ou atrapalhar o chat do usuário) [cite: 3, 360, 375].
  * A cada **10 turnos de usuário**: Reflete e salva lições aprendidas em `MEMORY.md` ou `USER.md` [cite: 3, 360].
  * A cada **10 iterações de ferramentas**: Detecta procedimentos complexos resolvidos e redige uma nova skill reutilizável via `skill_manage` [cite: 360, 373].
* **Processo do Curator**: Em momentos de inatividade, o *Curator* analisa a telemetria das skills [cite: 373, 375]. Habilidades não utilizadas por 30 dias mudam para o estado *stale*, e após 90 dias são movidas para o diretório `.archive/` para manter a biblioteca enxuta [cite: 377, 392].
Detalhe arquitetonicamente para mim sobre Aprendizado Autônomo e Curadoria do hermes agent

A arquitetura de **Aprendizado Autônomo e Curadoria** do **Hermes Agent** é projetada como um loop fechado de aprendizado (*closed learning loop*). Em vez de operar como um agente estático, o Hermes analisa suas próprias execuções para extrair fatos perenes (memória declarativa e de perfil) e procedimentos operacionais reutilizáveis (memória procedural em forma de *skills*), mantendo essa biblioteca limpa ao longo do tempo.

---

### 1. Loop de Auto-Aperfeiçoamento (*Self-Improvement Loop*)

O processo de aprendizado contínuo ocorre em tempo de execução logo após os turnos de conversa, operando por meio de gatilhos automáticos baseados em contadores de uso:

* **Gatilho de Memória (`_turns_since_memory`)**: A cada **10 turnos de usuário**, o sistema aciona um agente de revisão em segundo plano (*forked review agent*). Esse *fork* inspeciona o histórico recente da conversa para identificar preferências do desenvolvedor ou fatos estáveis do ambiente, gravando-os nos arquivos `USER.md` ou `MEMORY.md`.
* **Gatilho de Procedimentos (`_iters_since_skill`)**: A cada **10 iterações de ferramentas** dentro de uma tarefa complexa, o *fork* de revisão avalia se o agente resolveu um problema inédito. Se identificar um padrão útil, ele redige ou atualiza um manual passo a passo (`SKILL.md`) em `~/.hermes/skills/` através da ferramenta `skill_manage`.
* **Execução Isolada e Preservação de Cache**:
  * O agente de revisão roda em uma *thread* separada e não bloqueia a conversa ativa do usuário.
  * Ele reutiliza o prefixo do System Prompt da sessão principal para manter o *Prompt Caching* aquecido.
  * Caso seja configurado um modelo secundário mais barato via `auxiliary.background_review`, o *fork* utiliza um resumo compacto do histórico para minimizar o uso de tokens na nova chamada.
* **Governança e Portas de Aprovação**:
  * **Aprovação de Escrita (`write_approval`)**: Se `memory.write_approval` ou `skills.write_approval` estiverem ativados (`true`), as alterações geradas em segundo plano não são aplicadas diretamente no disco; elas ficam encadeadas para revisão do usuário via comandos `/memory pending` ou `/skills pending`.
  * **Notificações**: O parâmetro `display.memory_notifications` controla o nível de feedback exibido no chat sobre as memórias ou *skills* atualizadas pelo processo de fundo.
  * **Ferramentas Restritas**: O *fork* de revisão roda com uma lista restrita de ferramentas (acesso à ferramenta `memory`, `skill_manage` e leitura de arquivos), sendo impedido de rodar comandos de terminal arbitrários ou enviar mensagens externas.

---

### 2. Arquitetura do Sistema de Curadoria (*Curator*)

À medida que o agente cria novas *skills* autonomamente, a biblioteca local em `~/.hermes/skills/` corre o risco de acumular instruções duplicadas, obsoletas ou muito estreitas, poluindo o índice de habilidades e consumindo tokens de forma desnecessária. Para resolver isso, o sistema conta com o **Curator**.

#### Condições e Mecanismo de Disparo
O *Curator* não roda como um *daemon* contínuo de relógio, mas é avaliado na inicialização da CLI ou pelo *ticker* de manutenção do gateway quando duas condições são satisfeitas:
1. O intervalo de tempo configurado em `curator.interval_hours` foi atingido (padrão: **7 dias**).
2. O agente permaneceu inativo pelo período mínimo definido em `curator.min_idle_hours` (padrão: **2 horas**).

#### As Duas Fases de Manutenção

1. **Fase 1: Transições Determinísticas de Estado (Sem uso de LLM / Custo Zero)**:
   * O sistema lê a telemetria de uso gravada em `~/.hermes/skills/.usage.json` (`use_count`, `view_count`, `patch_count`, `last_activity_at`).
   * **Ativa \\(\rightarrow\\) Stale**: *Skills* sem qualquer uso por mais de 30 dias (`stale_after_days: 30`) mudam para o estado inativo (*stale*).
   * **Stale \\(\rightarrow\\) Archived**: *Skills* inativas por mais de 90 dias (`archive_after_days: 90`) são movidas para o diretório `.archive/` (`~/.hermes/skills/.archive/`).
   * **Garantia Não-Destrutiva**: O *Curator* **nunca apaga arquivos definitivamente** de forma automática; ele apenas os move para a pasta `.archive/`, permitindo recuperação instantânea via `hermes curator restore <nome>`.

2. **Fase 2: Consolidação Orientada por LLM (Opt-in via `curator.consolidate: true`)**:
   * Desativada por padrão para economizar tokens.
   * Quando ativada, o *Curator* dispara uma sessão em segundo plano usando o modelo definido em `auxiliary.curator`.
   * O modelo inspeciona os arquivos `SKILL.md` ativos, lê seus conteúdos e funde *skills* com sobreposição funcional em manuais mais amplos (guarda-chuvas), ajustando o repositório via `skill_manage`.
   * Se uma *skill* consolidada ou renomeada for referenciada por uma tarefa agendada no `cron`, o *Curator* reescreve automaticamente as referências da tarefa para apontar para a nova *skill*.

---

### 3. Governança, Proveniência e Auditoria da Curadoria

* **Escopo e Jurisdição de Proveniência**:
  * O *Curator* gerencia estritamente as *skills* que possuem a marcação `created_by: agent` / `agent_created: true` no seu registro de uso (gerada unicamente pelas criações em segundo plano).
  * *Skills* criadas manualmente pelo desenvolvedor ou solicitadas diretamente no chat presencial possuem `created_by: null` e são ignoradas pelo *Curator* para evitar que trabalhos do usuário sejam alterados sem consentimento.
  * O usuário pode estender a curadoria a *skills* antigas usando o comando `hermes curator adopt <nome>`.
  * *Skills* baixadas de hubs externos (`agentskills.io`) são imunes ao *Curator*, enquanto *skills* nativas empacotadas no repositório só são arquivadas se `curator.prune_builtins: true` estiver ativo.
* **Isenção por Pinned e Cron**:
  * O usuário pode fixar qualquer habilidade com `hermes curator pin <nome>`. *Skills* fixadas são totalmente ignoradas pelas transições de arquivamento e protegidas contra deleção por ferramentas do agente.
  * *Skills* associadas a tarefas agendadas ativas ou pausadas no `cron` também são protegidas contra arquivamento.
* **Backups e Livro-Razão (`.curator_ledger.jsonl`)**:
  * Antes de qualquer ciclo do *Curator*, o sistema gera um snapshot compactado `tar.gz` do diretório de *skills* em `~/.hermes/skills/.curator_backups/`. O usuário pode reverter o ciclo inteiro a qualquer momento com `hermes curator rollback`.
  * Toda mutação individual (criação, edição, patch, arquivamento ou restauração) é registrada no arquivo append-only `~/.hermes/skills/.curator_ledger.jsonl` contendo ator, ação, justificativa e hashes SHA256 dos arquivos antes/depois, permitindo desfazer alterações isoladas específicas.

Detalhe para mim melhor Fork Review Agent, suas regras, validações, fluxo e system prompt

O **Fork Review Agent** (implementado no Hermes Agent pela rotina `_spawn_background_review`) é um mecanismo assíncrono de auto-aperfeiçoamento contínuo (*Self-Improvement Loop*) [cite: 2, 372, 475, 1147]. Ele executa em segundo plano (*background thread*) sobre um *snapshot* isolado da conversa sem bloquear a interação do desenvolvedor e sem invalidar o *Prompt Caching* da sessão principal [cite: 372, 443, 475, 1147].

---

### 1. Gatilhos de Disparo (*Triggers*)

O agente de revisão não roda ininterruptamente, mas é acionado por contadores operacionais ou comandos explícitos [cite: 333, 372, 373]:

* **Gatilho de Memória (`_turns_since_memory`)**: Dispara automaticamente quando a conversa atinge o intervalo configurado de turnos do usuário (padrão de a cada 10 mensagens) para salvar preferências ou fatos perenes [cite: 372, 373].
* **Gatilho de Habilidade (`_iters_since_skill`)**: Dispara quando o agente principal acumula um número limite de chamadas/iterações de ferramentas (padrão de a cada 10 iterações em um turno) para abstrair soluções técnicas complexas [cite: 372, 373].
* **Disparo Manual (`/refine`)**: O desenvolvedor pode forçar a revisão a qualquer momento usando `/refine [instruções de foco]` [cite: 333, 444, 1147].
* **Desativação Autônoma**: O bloco `auxiliary.background_review.enabled: false` desativa os disparos automáticos por contadores, mantendo ativo apenas o comando manual `/refine` [cite: 444, 1147].
* **Diferimento em GPUs Locais (`defer: auto`)**: Quando executado sobre servidores locais (como `llama-server`), o *fork* é enfileirado para rodar apenas durante momentos de ociosidade (*settle window*), evitando disputar a GPU com a próxima resposta do chat [cite: 446, 447, 630].

---

### 2. Regras e Restrições Estritas de Segurança

Para evitar comportamento descontrolado, contaminação de contexto ou destruição de dados, o *Fork Review Agent* segue regras rígidas [cite: 253, 399, 1107, 1154, 1161]:

1. **Isolamento Absoluto do Histórico (*Deep Copy Snapshot*)**:
   * O *fork* recebe uma cópia clonada e profunda (`deep copy`) das mensagens da sessão ativa [cite: 1107, 1108].
   * Nenhuma mutação interna do *fork* altera o histórico de mensagens ou os blocos de texto da sessão do usuário [cite: 1107, 1108, 1092].
2. **Conjunto Restrito de Ferramentas (*Whitelisted Toolset*)**:
   * O *fork* só tem acesso a ferramentas de aprendizado (`memory` e `skill_manage`) e leitura passiva (`read_file`, `search_files`) [cite: 445, 1154].
   * Ferramentas ativas e perigosas são **estritamente bloqueadas** via *whitelist* de thread: `terminal` (execução de shell), `delegate_task`, `send_message`, `cronjob` e `clarify` [cite: 253, 399, 1154].
3. **Proibição de Deleção Autônoma (*Delete Gate*)**:
   * O *fork* de revisão em segundo plano pode adicionar ou atualizar memórias, mas é **impedido de apagar registros** [cite: 1161]. Se tentar deletar entradas para liberar espaço, a alteração é bloqueada e convertida em uma proposta pendente [cite: 1161].
4. **Filtro Anti-Padrões e Anti-Ruído**:
   * O prompt obriga o agente a ignorar falhas temporárias do ambiente (ex: *"comando não encontrado"*, *"ferramenta indisponível"*, *"dependência não instalada"*) [cite: 1156, 1157].
   * Ele é instruído a registrar apenas a **solução/correção**, e nunca alegações negativas ou narrativas pontuais da tarefa [cite: 1157].
5. **Teto Rígido de Orçamento de Tokens (`max_input_tokens`)**:
   * A execução do *fork* é interrompida antes de fazer uma nova chamada de API caso o consumo acumulado de tokens de entrada atinja o teto global configurado [cite: 1153].

---

### 3. Validações e Governança de Saída

* **Porta de Aprovação de Escrita (`write_approval`)**:
  * Se `memory.write_approval` ou `skills.write_approval` estiverem ativados (`true`), as edições geradas pelo agente não vão direto para o disco [cite: 2, 448].
  * Elas são enviadas para filas de aprovação e o usuário precisa revisá-las e aprová-las via `/memory pending` ou `/skills pending` [cite: 862].
* **Notificações em Chat (`display.memory_notifications`)**:
  * O feedback no chat pode ser configurado entre `off` (silencioso), `concise` (exibe a linha `💾 Memory updated`) ou `verbose` (exibe o diff do que mudou) [cite: 442, 1148].
* **Marcação de Proveniência para o Curator**:
  * Todas as habilidades geradas pelo *fork* recebem o metadado `created_by: agent` [cite: 443, 460]. Isso autoriza o processo de manutenção **Curator** a gerenciar o ciclo de vida dessas skills (tornando-as inativas após 30 dias de ociosidade e arquivando-as após 90 dias) [cite: 443, 444, 460].

---

### 4. Fluxo Operacional Passo a Passo

```text
Turno Concluído ──► Verificação de Gatilhos (Contadores / /refine)
                          │
                          ▼
             Clonagem Estrutural (Snapshot)
                          │
                          ▼
           Roteamento de Roteiro / Runtime
          ┌───────────────┴───────────────┐
          ▼                               ▼
 [Paridade de Cache]             [Modelo Auxiliar Barato]
 (Modelo Principal +              (Modelo secundário +
  System Prompt Congelado)         Digest Resumido)
          │                               │
          └───────────────┬───────────────┘
                          │
                          ▼
            Execução com Toolset Restrito
         (memory, skill_manage, read_file)
                          │
                          ▼
         Validação de Escrita / write_approval
          ┌───────────────┴───────────────┐
          ▼                               ▼
[Aprovação Ativa: Salva]      [Aprovação Exigida: Estágia]
(MEMORY.md / USER.md / SKILL.md)  (/memory pending / /skills pending)
                          │
                          ▼
          Atribuição de Tokens & Notificação
```

1. **Gatilho**: Ao final de um turno, o runtime avalia os contadores `_turns_since_memory` e `_iters_since_skill` [cite: 372, 373].
2. **Snapshot**: O sistema extrai um *snapshot* recente da conversa e verifica se o provedor suporta chamadas de ferramentas nativas [cite: 1098, 1107].
3. **Seleção de Runtime**:
   * **Modo Padrão (Paridade de Cache)**: Reutiliza o modelo e o System Prompt exatos da conversa principal [cite: 443, 1148, 1149]. Isso garante 100% de aproveitamento do *Prompt Cache* mantido pelo provedor [cite: 443, 1149].
   * **Modo Auxiliar (`auxiliary.background_review`)**: Se configurado para um modelo secundário mais barato (ex: Gemini Flash), o sistema condensa o histórico em um resumo (*digest*) antes de enviar para economizar tokens de entrada [cite: 443, 1151].
4. **Execução Isolada**: A *thread* roda o loop de inferência permitindo apenas ações de leitura e escrita de memórias/skills [cite: 445, 1154].
5. **Sincronização**: O *fork* atribui seu uso de tokens à sessão pai (`_record_review_usage_to_parent`) e encerra limpo sem alterar a janela de contexto ativa [cite: 443, 1099].

---

### 5. System Prompt da Revisão (`_COMBINED_REVIEW_PROMPT`)

Abaixo está a estrutura instrucional injetada no System Prompt do *Fork Review Agent* [cite: 628, 1156]:

```markdown
You write git commit messages, durable memory entries, and procedural skills by inspecting recent conversations.

## Memory
Review the conversation snapshot and extract durable facts:
- Save developer preferences, communication style, or stack choices to USER.md (target: 'user').
- Save project conventions, port numbers, build steps, and environment quirks to MEMORY.md (target: 'memory').
- Keep entries compact, plain, and factual.

## Skills
If the conversation demonstrates a multi-step workflow, debugging technique, or complex procedure that solved a task:
- Use `skill_manage` to create or update a SKILL.md manual.
- Write clear trigger conditions (When to Use) and step-by-step procedures.

## Critical Guidance (Do NOT capture):
- Do NOT capture transient setup or environment errors (e.g. "command not found", "missing binary", "tool uninstalled", "browser broken").
- Do NOT capture negative-claim phrasings or temporary failure states. Always capture the FIX, not the failure.
- Do NOT capture one-off task narratives or specific code refactors tied strictly to a single file.
- Do NOT attempt to delete existing memories in background mode.
``` [cite: 1156, 1157, 1161]

O **Curator Agent** (ou processo de curadoria em segundo plano) é o subsistema do Hermes Agent responsável pela **manutenção e higiene da memória procedural** (*skills*) [cite: 453, 1179]. Quando o agente aprende procedimentos de forma autônoma, ele pode gerar dezenas de *skills* redundantes, curtas ou sobrepostas ao longo do tempo [cite: 453]. O Curator opera em segundo plano para rastrear telemetria de uso, envelhecer habilidades ociosas, consolidar duplicatas e arquivar manuais obsoletos sem interromper a sessão ativa [cite: 453, 455].

---

### 1. Gatilhos de Disparo (*Triggers*)

O Curator não roda como um processo contínuo que consome recursos de CPU ininterruptamente, mas é avaliado na inicialização da CLI ou pelo *ticker* de manutenção do gateway quando duas condições são satisfeitas [cite: 455, 1179]:

* **Janela de Intervalo (`interval_hours`)**: Por padrão, deve ter decorrido pelo menos **168 horas (7 dias)** desde a última execução [cite: 455, 459].
* **Janela de Ociosidade (`min_idle_hours`)**: O agente deve ter permanecido inativo e sem interações de chat por pelo menos **2 horas** [cite: 455, 459].
* **Adiamento no Primeiro Boot (*First-Run Deferral*)**: Em instalações novas, o Curator adia a primeira execução em um intervalo completo para dar tempo ao usuário de revisar sua biblioteca [cite: 456].
* **Disparo Manual**: Pode ser executado sob demanda via CLI com `hermes curator run` (ou em *dry-run* com `hermes curator run --dry-run`) e via comando de barra com `/curator run` [cite: 456, 462, 476].

---

### 2. Jurisdição, Regras e Validações de Segurança

Para evitar a modificação indevida de instruções criadas pelo desenvolvedor, o Curator possui regras de governança e portas de segurança rígidas [cite: 454, 468, 470, 1313]:

1. **Jurisdição por Proveniência (`created_by: agent`)**:
   * O Curator gerencia primordialmente habilidades que possuem a marcação `created_by: "agent"` ou `agent_created: true` no arquivo `.usage.json` (geradas pelo *Fork Review Agent*) [cite: 468, 469].
   * Habilidades criadas manualmente pelo desenvolvedor ou solicitadas diretamente no chat possuem `created_by: null` e são **imunes** às alterações do Curator, a menos que sejam explicitamente entregues pelo usuário via `hermes curator adopt <nome>` [cite: 470, 471, 472].
   * Habilidades baixadas de *hubs* externos (`agentskills.io`) são totalmente protegidas [cite: 454, 468]. Por padrão (`prune_builtins: true`), habilidades nativas (*built-ins*) não utilizadas podem passar por arquivamento inativo, mas nunca por consolidação [cite: 454, 459, 477].
2. **Isenção de Habilidades Fixadas (`pinned`)**:
   * O usuário pode fixar qualquer habilidade com `hermes curator pin <nome>` [cite: 462, 475].
   * Habilidades fixadas são **ignoradas por todas as transições automáticas** do Curator e ficam protegidas contra a ação `delete` da ferramenta `skill_manage` [cite: 475, 476].
3. **Proteção por Tarefas de Agendamento (`cron`)**:
   * Qualquer *skill* associada a uma tarefa agendada ativa ou pausada no `cron` fica protegida contra o arquivamento inativo [cite: 457, 477].
4. **Princípio do Arquivamento Não-Destrutivo**:
   * O Curator **nunca deleta arquivos do disco de forma permanente** nas transições automáticas; ele apenas move os diretórios para a pasta de salvamento seguro em `~/.hermes/skills/.archive/` [cite: 454, 457].
5. **Fail-Closed no Modo LLM (Validação de Absorção)**:
   * Durante a consolidação via LLM, a tentativa de executar a ação `delete` via `skill_manage` **falha se o parâmetro `absorbed_into` não for informado** [cite: 1313]. Isso impede que o modelo exclua uma habilidade sem declarar em qual *skill* guarda-chuva o conhecimento foi preservado [cite: 1313].
   * O modelo deve obrigatoriamente ler uma *skill* com `skill_view` antes de aplicar qualquer alteração ou *patch* [cite: 1313].

---

### 3. Backups e Livro-Razão de Auditoria (*Ledger*)

Antes de aplicar qualquer modificação física na biblioteca de habilidades, o Curator aciona mecanismos de proteção [cite: 463, 464]:

* **Snapshot Tarball Automático**: Um backup compactado `.tar.gz` do diretório `~/.hermes/skills/` é salvo em `~/.hermes/skills/.curator_backups/<utc-iso>/` antes da execução [cite: 463]. O estado completo pode ser revertido a qualquer momento com `hermes curator rollback` [cite: 462, 463].
* **Livro-Razão Append-Only (`.curator_ledger.jsonl`)**: Cada mutação individual (criação, *patch*, arquivamento, restauração ou expurgo) é gravada em `~/.hermes/skills/.curator_ledger.jsonl` contendo [cite: 464, 465]:
  * Identificador da mutação e *timestamp* [cite: 465].
  * Ator responsável (`curator`, `agent` ou `user`) [cite: 465].
  * Justificativa e evidência de absorção (`absorbed_into`) [cite: 465].
  * Manifestos com *hashes* SHA256 de todos os arquivos antes e depois da alteração, permitindo a reversão cirúrgica de uma única ação via `hermes curator rollback <entry-id>` [cite: 465, 466].

---

### 4. Fluxo Operacional Passo a Passo

```text
       Verificação de Disparo (interval_hours >= 7d AND min_idle_hours >= 2h)
                                      │
                                      ▼
                        Snapshot de Backup (.tar.gz)
                                      │
                                      ▼
          FASE 1: Transições Determinísticas (Custo Zero / Sem LLM)
          ├─ Leitura de .usage.json
          ├─ Sem uso por > 30 dias ──► Estado muda para 'stale'
          └─ Sem uso por > 90 dias ──► Movido para '.archive/'
                                      │
                                      ▼
          FASE 2: Consolidação por LLM (Opt-in: curator.consolidate: true)
          ├─ Spawna background fork usando auxiliary.curator
          ├─ Inspeção via skill_view()
          ├─ Agrupamento de habilidades sobrepostas (Umbrellas)
          └─ Atualização automática de referências em tarefas do cron
                                      │
                                      ▼
         Gravação do Livro-Razão (.jsonl) e Relatórios (REPORT.md / run.json)
```

1. **Passo 1 (Validação de Inatividade)**: O sistema confirma que os limites de tempo e ociosidade foram atingidos [cite: 455].
2. **Passo 2 (Snapshot)**: Cria o backup da pasta de *skills* em `.curator_backups/` [cite: 463].
3. **Passo 3 (Fase 1 - Pruning Determinístico)**:
   * Sem chamadas de API [cite: 457].
   * Habilidades ativas não utilizadas há mais de 30 dias (`stale_after_days`) avançam para o estado *stale* [cite: 457, 459].
   * Habilidades ociosas há mais de 90 dias (`archive_after_days`) são movidas para `.archive/` [cite: 457, 459].
   * Habilidades recém-criadas sem nenhum uso possuem carência mínima de 30 dias antes do arquivamento [cite: 457].
4. **Passo 4 (Fase 2 - Consolidação por LLM)**:
   * **Inativa por Padrão**: Só executa se `curator.consolidate: true` for configurado no `config.yaml` ou se o flag `--consolidate` for passado via CLI [cite: 457, 458].
   * Utiliza um modelo secundário configurado em `auxiliary.curator` (ex: `google/gemini-2.5-flash`) [cite: 460, 461].
   * O agente em segundo plano analisa as *skills* ativas, lê o conteúdo com `skill_view`, funde manuais pequenos em instrução guarda-chuva e ajusta os nomes de *skills* vinculados a tarefas do `cron` [cite: 457, 1278].
5. **Passo 5 (Relatório de Saída)**: O relatório da execução é gravado em `~/.hermes/logs/curator/<timestamp>/` contendo `run.json` (dados brutos de telemetria) e `REPORT.md` (resumo em Markdown com o mapa explicativo de nomes renomeados e consolidados) [cite: 480, 481, 482].

---

### 5. System Prompt das Instruções do Curator (`CURATOR_REVIEW_PROMPT`)

Abaixo está o bloco de instruções que orienta a LLM durante a Fase 2 de consolidação [cite: 1266]:

```markdown
You are the skill curator for Hermes Agent. Your job is to review agent-created skills and keep the skill library clean, sharp, and focused.

## Your Goal
Inspect the candidate skills, identify overlaps, and consolidate narrow near-duplicate skills into comprehensive umbrella skills.

## Rules of Engagement
1. Use `skill_view(name)` to read full contents of candidate skills before making decisions.
2. If two or more skills cover the same tool, workflow, or domain:
   - Create or update a unified umbrella skill using `skill_manage`.
   - Ensure support files (references/, templates/, scripts/) are preserved or re-homed properly.
   - Archive the absorbed narrow skills using `skill_manage(action="delete", name="...", absorbed_into="umbrella-name")`.
3. Do NOT invent new skills out of thin air — only consolidate or refine existing candidate skills based on observed conversation patterns.
4. Do NOT attempt to pin skills or instruct the user to pin skills. Pinning is an explicit user opt-out action.
5. If a skill is distinct, well-written, and non-redundant, leave it as `keep`.

## Output
Provide a structured summary of transitions made (kept, patched, consolidated, or archived) with the explicit absorption map for any merged skills.
``` [cite: 457, 1266, 1313]
No ecossistema do **Hermes Agent**, o gerenciamento da **memória procedural** ("como executar procedimentos e fluxos de trabalho") é realizado pelo conjunto de ferramentas do toolset **`skills`** [cite: 281]. 

A arquitetura opera sob o princípio de **Revelação Progressiva (*Progressive Disclosure*)**, garantindo que manuais extensos só consumam a janela de contexto quando forem estritamente necessários [cite: 222, 312]. As três ferramentas centrais que compõem esse ecossistema são **`skills_list`**, **`skill_view`** e **`skill_manage`** [cite: 281].

---

### 1. `skills_list` (Descoberta de Catálogo)
É a ferramenta de busca e inventário inicial [cite: 281].

* **Função**: Retorna o catálogo compacto de todas as habilidades ativas e instaladas na sessão [cite: 222, 281].
* **Impacto no Contexto**: Injeta apenas um manifesto leve com o nome da habilidade e uma descrição curta de 1 linha (até 60 caracteres) por item [cite: 222, 312].
* **Uso pelo Agente**: No início da sessão ou antes de responder a uma tarefa complexa, o agente consulta essa lista para verificar se já existe um manual pronto para aquele problema [cite: 222].

---

### 2. `skill_view` (Leitura sob Demanda)
É a ferramenta de carregamento dinâmico que traz as instruções detalhadas do disco para a conversa [cite: 222, 281].

* **Parâmetros**:
  * `name` *(obrigatório)*: O nome da habilidade desejada (ex: `"github-pr-workflow"`) [cite: 222, 281].
  * `file_path` *(opcional)*: Caminho relativo para arquivos de apoio armazenados dentro da pasta da skill (ex: `"references/api-docs.md"`, `"scripts/setup.sh"`) [cite: 222, 228, 281].
* **Substituição de Variáveis de Template**: Ao ler o `SKILL.md`, o runtime substitui dinamicamente os tokens `${HERMES_SKILL_DIR}` pelo caminho absoluto do diretório no disco e `${HERMES_SESSION_ID}` pelo ID da sessão ativa [cite: 174].
* **Preservação de Cache**: O conteúdo do `SKILL.md` entra no histórico da conversa como o **resultado de um turno de ferramenta**, mantendo o System Prompt base congelado e preservando o *Prompt Caching* do provedor [cite: 246, 314].

---

### 3. `skill_manage` (Escrita, Edição e Manutenção Procedural)
É a ferramenta de edição autônoma que permite ao agente **aprender com a experiência**, criando, corrigindo ou deletando manuais procedimentais [cite: 231, 281, 366].

#### Ações Suportadas (`action`):
1. **`create`**: Escreve um pacote completo de habilidade criando a pasta `~/.hermes/skills/<nome>/` e o arquivo `SKILL.md` inicial [cite: 227, 366, 828].
2. **`edit`**: Sobrescreve o conteúdo integral do arquivo `SKILL.md` ou realiza reestruturações completas no texto [cite: 366, 824].
3. **`patch`**: Executa substituições cirúrgicas de blocos de texto (`old_string` \\(\rightarrow\\) `new_string`), evitando reescrever o arquivo inteiro [cite: 366, 824].
4. **`write_file`**: Cria ou atualiza arquivos secundários de apoio dentro das subpastas da skill (`references/`, `templates/`, `scripts/`) [cite: 228, 824].
5. **`remove_file`**: Deleta um arquivo de apoio específico mantendo o restante do pacote da skill intacto [cite: 824].
6. **`delete`**: Move o pacote da habilidade para a pasta de salvamento e arquivamento em `~/.hermes/skills/.archive/` [cite: 341, 366, 824].

---

### Mecanismos de Proteção e Governança do `skill_manage`

1. **Bloqueio de Delecão para Skills Fixadas (*Pinned*)**:
   Se uma habilidade for fixada pelo usuário (`hermes curator pin <nome>`), o runtime do `skill_manage` **recusa a ação `delete`**, instruindo o agente de que a habilidade está protegida contra remoção [cite: 355-356, 840].
2. **Porta de Aprovação de Escrita (`skills.write_approval`)**:
   Quando a trava de segurança `write_approval: true` está ativada nas configurações, as alterações executadas pelo `skill_manage` não vão direto para o disco [cite: 379]. Elas são retidas em `~/.hermes/pending/skills/` e o usuário deve revisá-las e aprová-las usando os comandos `/skills pending` ou `/skills approve <id>` [cite: 379].
3. **Marcação de Proveniência**:
   Quando a criação da skill ocorre durante o loop de auto-aperfeiçoamento em segundo plano (*background review*), o `skill_manage` registra a metadado `created_by: agent` no arquivo `.usage.json` [cite: 348-349]. Isso sinaliza ao sistema de manutenção **Curator** que a habilidade pode passar por envelhecimento e arquivamento automático após 90 dias de inatividade [cite: 342, 348].

---

### Quadro Comparativo do Toolset

| Ferramenta | Entrada Principal | Saída | Uso Principal |
| :--- | :--- | :--- | :--- |
| **`skills_list`** | *(nenhuma)* | Nomes e resumos curtos de até 60 chars [cite: 222, 281]. | Mapear quais procedimentos o agente conhece [cite: 222]. |
| **`skill_view`** | `name`, `file_path` [cite: 222, 281] | Conteúdo em Markdown do `SKILL.md` ou arquivo de apoio [cite: 222, 228, 281]. | Ler o passo a passo exato para executar uma tarefa [cite: 222]. |
| **`skill_manage`** | `action`, `name`, `content`, `file_path` [cite: 366, 824] | Confirmação de escrita/patch ou retenção pendente [cite: 379, 823]. | Registrar novos aprendizados e manter a biblioteca atualizada [cite: 231, 366]. |