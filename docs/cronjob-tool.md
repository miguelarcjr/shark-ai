Esta é a especificação da ferramenta **`cronjob`** do Hermes Agent estruturada no formato de um **Documento de Análise de Requisitos de Software (SRS)** [cite: 12, 138].

---

# Documento de Análise de Requisitos: Ferramenta `cronjob` (Hermes Agent)

## 1. Visão Geral e Propósito
A ferramenta **`cronjob`** é o subsistema de agendamento e automação autônoma do Hermes Agent [cite: 11, 138]. Seu objetivo é permitir que o agente crie, consulte, modifique, pause e execute tarefas agendadas em segundo plano (sejam tarefas pontuais, recorrentes por intervalo, expressões cron clássicas ou acionamentos orientados a eventos) com suporte a disparo de scripts, injeção de *skills* e entrega multicanal [cite: 11, 12, 20].

---

## 2. Requisitos Funcionais (RF)

### RF01 — Operações da Ferramenta (`action`)
A ferramenta é exposta ao modelo como uma interface única com parâmetro `action` [cite: 12, 138]. Deve suportar as seguintes operações:
* **`create`**: Cadastra um novo agendamento com os parâmetros definidos [cite: 12, 138].
* **`list`**: Retorna a lista de tarefas agendadas registradas no perfil ativo com seus respectivos IDs, horários da próxima execução, estados e alvos de entrega [cite: 12, 138, 88].
* **`update`**: Permite atualização parcial das configurações de um agendamento existente (ex.: alterar o prompt, modificar o *schedule* ou atualizar as *skills* associadas) [cite: 12, 138].
* **`pause`**: Suspende temporariamente a execução automática da tarefa sem excluí-la do registro [cite: 12, 14, 138].
* **`resume`**: Reativa a tarefa suspensa ou rearma uma execução única (*one-shot*) concluída [cite: 12, 138, 409].
* **`run`**: Força a execução imediata e assíncrona do job em segundo plano fora da janela de horário agendada [cite: 12, 138, 549].
* **`remove`**: Cancela e remove permanentemente o registro do agendamento [cite: 12, 138].

---

### RF02 — Sintaxe de Agendamento (`schedule`)
O motor de agendamento deve aceitar quatro formatos estruturados para o parâmetro `schedule` [cite: 12]:
1. **Atraso Relativo (*Relative Delay*)**: Expressões de duração como `30m`, `2h` ou `1d` para disparos únicos após a duração especificada [cite: 12, 362].
2. **Intervalo Recorrente (*Interval*)**: Sintaxe do tipo `every 2h`, `every 30m` ou `every monday 9am` [cite: 12, 362].
3. **Sintaxe Cron Clássica (*Cron Expression*)**: Sintaxe de 5 campos do padrão Cron UNIX (ex.: `0 9 * * *` para todos os dias às 9h) [cite: 12, 13, 52].
4. **Marcação Temporal Exata ISO (*ISO Timestamp*)**: Carimbo de data/hora ISO 8601 para acionamentos pontuais pré-determinados (ex.: `2025-01-15T09:00:00Z`) [cite: 12].

---

### RF03 — Modos e Estratégias de Execução
A ferramenta deve suportar três padrões principais de execução [cite: 14, 48, 49, 319]:

* **Modo Agente Completo (*Agent-backed*)**:
  * Ao disparar, o agendador cria uma sessão limpa e isolada do `AIAgent` sem histórico da conversa atual (*fresh session*) [cite: 14, 48].
  * O modelo processa o prompt, invoca ferramentas caso necessário (ex.: buscas na web, leitura de arquivos) e gera o relatório final [cite: 14, 48, 138].
* **Modo Script sem Tokens (*No-Agent Mode — `no_agent=True`*)**:
  * Executa diretamente um script local (armazenado obrigatoriamente sob `~/.hermes/scripts/`) [cite: 48, 103, 526].
  * Redireciona o `stdout` do script diretamente para o canal de entrega configurado, consumindo **zero tokens de LLM** [cite: 48, 103, 527].
* **Modo Monitoramento por Diferença (*Monitor Script / Watchdog*)**:
  * Executa um script de pré-coleta determinístico antes do turno da LLM [cite: 49, 319].
  * O agente é acordado para analisar os dados **apenas quando a saída do script sofrer alteração** em relação à execução anterior, evitando consumo desnecessário em períodos sem mudanças [cite: 319, 535].

---

### RF04 — Injeção de Skills Procedurais (`skills`)
* A ferramenta permite associar uma lista de *skills* cadastradas no sistema (`skills: ["arxiv", "obsidian"]`) [cite: 13, 55].
* Na execução do job, as instruções contidas nessas *skills* são carregadas em ordem e injetadas no contexto como mensagens do sistema/usuário para guiar os procedimentos do agente [cite: 14, 55].

---

### RF05 — Roteamento e Destino de Entrega (`deliver`)
Os resultados da execução devem poder ser roteados para múltiplos destinos flexíveis [cite: 20, 21]:
* **`origin`**: Devolve o resultado diretamente ao chat/canal onde o agendamento foi originalmente criado [cite: 21, 56].
* **`local`**: Grava o resultado em um arquivo Markdown local sob `~/.hermes/cron/output/` sem emitir notificações externas [cite: 21, 84].
* **Canais de Mensagaria Conectados**: Plataformas do Gateway como `telegram`, `discord`, `slack`, `email`, `whatsapp`, `signal`, `matrix`, entre outras [cite: 21, 73].
* **Alvos Específicos e Tópicos**: Aceita IDs específicos de chats e threads (ex.: `telegram:-1001234567890:17585` ou `discord:#engineering`) [cite: 20, 21, 22].
* **Injeção em Perfil Local (`bot-chat`)**: O alvo `bot-chat` (ou `bot-chat:<profile>`) entrega a saída diretamente na sessão canônica "Bot Chat" do perfil selecionado, fazendo com que aquele bot execute um turno completo de resposta sobre o conteúdo recebido [cite: 21, 22, 511, 515].

---

### RF06 — Supressão Silenciosa de Notificação (`[SILENT]`)
* Se a resposta gerada pelo agente ou o `stdout` do script contiver ou for exatamente o token `[SILENT]`, o subsistema de entrega deve suprimir o envio da mensagem externa [cite: 23, 50, 74].
* Essa funcionalidade evita poluição de notificações em tarefas de monitoramento que confirmam que "nada mudou" [cite: 50, 74].

---

## 3. Requisitos Não-Funcionais (RNF)

### RNF01 — Persistência e Armazenamento
* Os registros das tarefas devem ser mantidos no arquivo JSON em `~/.hermes/cron/jobs.json` [cite: 12].
* A gravação do arquivo deve utilizar semântica de substituição atômica (*atomic write*: grava em arquivo temporário e renomeia) com travamento de arquivo (`~/.hermes/cron/.tick.lock`) para impedir condições de corrida e corrupção entre múltiplos processos [cite: 12, 14, 363].

---

### RNF02 — Isolamento de Sessão e Segurança de Contexto
* Toda execução do agendador deve rodar com a flag `skip_memory=True` [cite: 363]. Isso impede que rotinas automatizadas de segundo plano alterem e poluam os arquivos globais de memória do usuário (`[link suspeito removido]`) sem supervisão direta [cite: 363].
* As mensagens entregues por cron jobs não devem ser espelhadas diretamente no histórico da sessão principal do canal de entrega para evitar violações na alternância estrita de papéis (`role alternation`) dos provedores de LLM [cite: 23, 25, 363].

---

### RNF03 — Tolerância a Falhas e Timeouts de Inatividade
* **Timeout por Inatividade**: Sessões orientadas por LLM são reguladas por um teto de inatividade configurável (`HERMES_CRON_TIMEOUT`, padrão de 600 segundos) [cite: 19, 79]. O job pode rodar por períodos longos desde que continue emitindo tokens ou chamando ferramentas [cite: 19, 79].
* **Hard Timeout de Interrupção**: Limite de segurança de interrupção forçada por rodada (padrão de 3 minutos em execuções no daemon) para impedir que loops infinitos monopolizem a fila do agendador [cite: 363].

---

### RNF04 — Diagnóstico de Conexão do Daemon (`gateway_running`)
* Ao executar `action="create"`, a ferramenta deve checar a vivacidade do processo daemon do Gateway [cite: 509, 510].
* Se o Gateway não estiver rodando no sistema no momento da criação, a ferramenta salva o job, mas retorna o parâmetro `gateway_running: false` com um aviso explícito ao modelo informando que a tarefa foi salva mas não irá disparar até que o serviço `hermes gateway` seja iniciado [cite: 509, 510].

---

### RNF05 — Escalabilidade e Suporte a Nuvem (*Chronos / Scale-to-Zero*)
* Em implantações de infraestrutura hospedada, o acionador do ciclo (*tick*) deve suportar o provedor de cron estendido **Chronos** [cite: 15, 16, 382].
* O Chronos permite que instâncias do Gateway fiquem totalmente desligadas (*scale to zero*) entre os agendamentos, sendo acordadas por um *webhook* assinado por JWT exatamente no carimbo temporal `next_run_at` de cada job [cite: 16, 17, 382].

---

## 4. Regras de Negócio (RN) e Tratamento de Erros

* **RN01 — Trava de Proteção de Ciclo de Vida (`lifecycle_guard`)**:
  * A ferramenta deve **rejeitar obrigatoriamente** a criação de qualquer job cujo prompt ou script tente executar comandos de reinicialização ou parada do próprio serviço Gateway (ex.: `hermes gateway restart`, `systemctl restart hermes-gateway`) [cite: 367, 368].
  * *Motivo*: A execução desse comando mataria o processo do Gateway e geraria um loop infinito de disparo e reinicialização por sinais do sistema operacional (`SIGTERM-respawn loop`) [cite: 367].
* **RN02 — Obrigatoriedade de Script em `no_agent`**:
  * A chamada `cronjob(action="create", no_agent=True)` deve retornar erro de validação caso o parâmetro `script` não seja informado [cite: 526].
* **RN03 — Trava de Traversal de Caminhos de Scripts**:
  * Os scripts associados aos agendamentos devem residir exclusivamente dentro do diretório autorizado do ecossistema (`~/.hermes/scripts/`), impedindo a execução arbitrária de binários em locais não verificados [cite: 78, 495].
* **RN04 — Isolamento de Subagentes em Ambientes Kanban**:
  * Quando acionado por um subagente em uma fila multi-agente (Kanban), a ferramenta isola as variáveis de contexto (`HERMES_KANBAN_TASK`) [cite: 332, 522]. A tarefa agendada roda de forma independente sem alterar o estado nem fechar a tarefa do trabalhador pai no quadro [cite: 332, 522].

  ### 1. Como funciona o loop do cronjob?

O agendamento e a execução de cronjobs no Hermes Agent são gerenciados pelo subsistema do agendador (`InProcessCronScheduler` ou `Chronos` no modo gerenciado para nuvem) [cite: 2, 5].

No modo padrão (*in-process ticker*), o daemon do sistema roda um loop de varredura (*tick cycle*) a cada **60 segundos** [cite: 4, 5]:

1. **Trava de Segurança (*Scheduler Lock*)**: Ao iniciar cada tick, o sistema adquire uma trava de arquivo no SO (`~/.hermes/cron/.tick.lock`) para evitar que execuções sobrepostas processem o mesmo lote de tarefas ao mesmo tempo [cite: 4, 12].
2. **Leitura e Filtro**: Carrega o arquivo atômico de jobs (`~/.hermes/cron/jobs.json`) e filtra as tarefas cujo horário agendado venceu (`next_run_at <= agora`) e cujo estado é `scheduled` [cite: 4].
3. **Instanciação e Execução**: Para cada tarefa pendente [cite: 4]:
   * O estado do job é marcado como `running` [cite: 4].
   * O sistema cria uma **nova sessão limpa do agente (`AIAgent`)** [cite: 4, 9].
   * Se houver *skills* anexadas ao job, elas são carregadas e injetadas como instruções no contexto [cite: 4].
   * O prompt da tarefa é processado pelo agente [cite: 4].
   * Ao finalizar, a saída/relatório é despachada para o destino configurado (ex.: Telegram, Discord, e-mail ou arquivo Markdown local) pelo roteador de entregas (`deliver`) [cite: 4, 38].
4. **Atualização de Estado**: O contador de execuções (`run_count`) é incrementado, a próxima data/hora (`next_run_at`) é calculada e o arquivo `jobs.json` é salvo [cite: 4].
5. **Liberacao da Trava**: A trava de arquivo é liberada ao fim da rodada [cite: 4].

> **Nota (Modo Sem LLM — `no_agent=True`)**: Se a tarefa for configurada com `no_agent=True`, o loop executa diretamente um script local (localizado obrigatoriamente em `~/.hermes/scripts/`) e redireciona seu `stdout` para o destino configurado sem invocar nenhuma LLM (gastando zero tokens) [cite: 25, 59].

---

### 2. Ele usa o mesmo agente principal?

**Não.** O cronjob **não utiliza** a sessão de conversa do agente principal nem herda o histórico do chat em que foi criado [cite: 4, 9, 25].

* **Sessão Isolada (*Fresh Session Isolation*)**: Cada execução de cronjob roda em uma instância totalmente **nova e independente do `AIAgent`** [cite: 4, 9].
* **Sem Contexto de Chat Anterior**: Não há histórico de mensagens anteriores nem memória de conversas passadas no contexto [cite: 9, 25]. Por essa razão, o prompt registrado no cronjob precisa ser totalmente auto-contido [cite: 9, 25].
* **Isolamento de Memória Durável**: Por padrão, sessões de cronjob executam com a flag `skip_memory=True` [cite: 9, 287]. Isso significa que tarefas automatizadas de segundo plano **não podem alterar nem gravar** novos fatos nos arquivos de memória global (`[link suspeito removido]` / `[link suspeito removido]`), prevenindo a contaminação ou corrupção não supervisionada da memória do usuário [cite: 9, 287].

---

### 3. Ele tem todas as funções e tools do agente principal disponíveis?

**Não todas.** Embora o agente do cronjob herde a maioria das ferramentas técnicas de execução (como `terminal`, `read_file`, `write_file`, `patch`, `web_search` e `browser`) [cite: 89, 143], ele possui **restrições e travas estritas**:

1. **Trava Antirrecursiva (*Recursion Guard*)**: A própria ferramenta `cronjob` fica **desativada** dentro das sessões disparadas por cron [cite: 9, 12, 477]. Isso impede que uma tarefa agendada crie outros cronjobs recursivos que estourem o consumo de tokens [cite: 12].
2. **Bloqueio de Ferramentas Interativas**:
   * Ferramentas interativas como **`clarify`** (que fazem perguntas de esclarecimento ao usuário) e **`send_message`** são desativadas ou restritas, pois não há um operador humano presente para responder interativamente durante a execução em segundo plano [cite: 9, 188, 477].
3. **Limites Rígidos de Tempo e Inatividade**:
   * **Timeout por Inatividade**: O agente pode usar ferramentas continuamente enquanto estiver ativo, mas é encerrado automaticamente se ficar ocioso após o tempo limite configurado (`HERMES_CRON_TIMEOUT`, padrão de 600 segundos) [cite: 11, 42].
   * **Hard Interrupt de Segurança**: Execuções automatizadas no daemon possuem um teto rígido de interrupção (padrão de 3 minutos) para impedir que loops infinitos em scripts ou ferramentas travem o agendador [cite: 287].


A execução de um **cronjob** e a de um **subagente** no Hermes Agent compartilham princípios de isolamento de contexto, mas possuem naturezas, propósitos e ciclos de vida diferentes [cite: 9, 13, 140, 158].

---

### 1. A execução de um cronjob é tipo como se fosse um subagente?

**Não exatamente, embora ambos funcionem com contexto isolado (*fresh session*).**

* **Como funciona o Cronjob**: O cronjob é disparado pelo **agendador do sistema/daemon** (`InProcessCronScheduler` ou `Chronos`) com base em um tempo configurado (ex.: intervalos `every 1h` ou expressões Cron) [cite: 9, 10, 278, 279]. Quando o horário chega, o sistema cria uma **sessão totalmente limpa do `AIAgent`** [cite: 9, 13, 31]:
  * Não carrega o histórico de conversas anteriores ou do chat em que foi criado [cite: 13, 31].
  * É executado de forma **auto-contida** (não pode fazer perguntas de esclarecimento ao usuário) [cite: 13].
  * Roda com `skip_memory=True` por padrão para não alterar os arquivos globais de memória durável (`[link suspeito removido]`) sem supervisão [cite: 13, 280, 419].
  * A ferramenta de gerenciar cronjobs fica desativada dentro da sessão do cronjob como trava antirrecursiva [cite: 13, 161].
  * Pode rodar em modo sem LLM (`no_agent=True`), executando apenas scripts de terminal sem gastar tokens [cite: 31, 279].

* **Como funciona o Subagente (`delegate_task`)**: O subagente é disparado por um **agente pai durante uma conversa ativa** para resolver uma subtarefa pontual em paralelo (ex.: refatorar um código ou pesquisar na web) [cite: 93, 140, 158]. Ele retorna seu resumo diretamente para o contexto do agente pai dentro da própria sessão [cite: 93, 140].

---

### 2. O agente principal é notificado disso?

**Não de forma automática ou intrusiva dentro do histórico de conversa principal.**

* **Isolamento de Sessão**: As mensagens e entregas de um cronjob **não são espelhadas diretamente no histórico da sessão de chat ativa** do agente [cite: 18, 20, 280]. Isso é uma regra de arquitetura para evitar contaminação do histórico e violações na alternância de papéis (`user`/`assistant`) na API da LLM [cite: 18, 20, 280].
* **Roteamento pela propriedade `deliver`**: O resultado da execução é roteado de acordo com o destino configurado [cite: 15, 16, 36]:
  * **`origin`**: Envia a resposta final diretamente para o chat/canal de onde o agendamento foi criado originalmente (ex.: uma mensagem no Telegram ou Discord) [cite: 15, 16, 36].
  * **`bot-chat`**: Injeta a saída diretamente na sessão canônica *"Bot Chat"* de um perfil de bot local, fazendo o bot reagir e executar um turno de resposta completo [cite: 16, 17, 37].
  * **`local`**: Salva o relatório silenciosamente em um arquivo Markdown em `~/.hermes/cron/output/` sem enviar nenhuma notificação para o usuário ou agente [cite: 16, 21].
  * **Canais específicos**: Pode ser roteado diretamente para Telegram, Discord, Slack, E-mail, etc. [cite: 15, 16, 36]
* **O marcador `[SILENT]`**: Se a instrução do cronjob resultar no token `[SILENT]` (por exemplo, quando um script de monitoramento verifica que nada mudou), qualquer notificação externa é completamente suprimida [cite: 18, 32, 38].