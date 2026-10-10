Aqui estão os detalhes técnicos referentes à arquitetura do **Hermes Agent**:

---

### 1. Política de Atraso (Catch-up / Missed Runs)
* **Sem acúmulo em rajada (*No Backfill Storm*)**: Se o sistema ficar offline durante a madrugada e reiniciar 6 horas depois, o Hermes **nunca executa em rajada (*backfill*)** todas as instâncias perdidas sequencialmente [cite: 337, 363, 479].
* **Tarefas Recorrentes (*Interval / Cron*)**: O Hermes detecta os disparos pendentes e realiza o **coalescimento (*coalescing*)**: ele executa a tarefa **apenas 1 vez** para compensar o período offline (registrando o evento no contador `catch_up_occurrences`) e reancora o carimbo `next_run_at` para o próximo horário regular da agenda [cite: 328, 337, 479].
* **Tarefas Pontuais (*One-shot / Reminders*)**: Possuem uma janela rígida de tolerância de atraso (`ONESHOT_GRACE_SECONDS`, ex.: ~120 segundos) [cite: 300, 485, 492]. Se o horário do disparo tiver vencido além dessa margem de tolerância, a tarefa pontual **caduca e é aposentada** com um registro de diagnóstico em vez de ser disparada com horas de atraso [cite: 485, 492].

---

### 2. Sobreposição do Mesmo Job (Overlap Prevention)
* **Prevenção Rígida de Sobreposição (*Prevent Overlap*)**: O Hermes impede que um mesmo job execute concorrentemente com uma instância anterior ainda ativa [cite: 9, 35, 505].
* **Mecanismo de Trava e Estado**:
  * O agendador adquire uma trava de arquivo entre processos (`~/.hermes/cron/.tick.lock`) e mantém um controle de execuções em andamento (`_running_job_ids`) e de reivindicação atômica no banco SQLite (`claim_job_for_fire`) [cite: 9, 300, 327, 505].
  * Se o ciclo de varredura (*tick* de 60 segundos) constatar que o disparo anterior daquele `job_id` ainda está processando ferramentas ou gerando tokens, ele registra a mensagem *"already running — skipping"* e **pula a execução do novo ciclo**, aguardando a finalização da instância em andamento [cite: 35, 505].

---

### 3. Concorrência Máxima de Jobs Simultâneos
* **Fila por Varredura e Thread Pool**: A cada ciclo de 60 segundos do daemon, o agendador descobre os jobs que venceram e os despacha para uma pool assíncrona de threads de segundo plano (`DaemonThreadPoolExecutor`) [cite: 5, 300].
* **Desacoplamento de Scripts**: Scripts de pré-coleta de dados são despachados para a thread pool sem reter a trava do ciclo (*tick lock*), garantindo que um script lento não bloqueie o disparo de outros jobs agendados para o mesmo minuto [cite: 5, 9].
* **Proteção contra Estouro de Rate Limit**:
  * As chamadas às APIs de LLM compartilham uma barreira de limitação de requisições por hora/minuto em nível de processo (`nous_rate_guard`) [cite: 254, 262].
  * Caso múltiplos jobs disparem juntos e a API retorne erros de cota (HTTP 429), as execuções acionam o *jittered exponential backoff* [cite: 252, 257] e alternam para os modelos configurados na cadeia de contingência (`fallback_providers`) sem travar a máquina [cite: 161, 250].

---

### 4. Política de Retentativas e Falhas (Retry Policy)
* **Falhas de Infraestrutura / LLM (Erros Transitórios)**: Durante a execução de um turno do cronjob, se ocorrerem falhas de rede, estouro de *context window* ou erro 429/500/503 na API da LLM, o mecanismo de resiliência interna do agente tenta até 3 retentativas com *exponential backoff* [cite: 236, 250] e percorre a lista de provedores reserva (`fallback_providers`) [cite: 161, 250].
* **Falhas Finais / Erros de Script**: Se o script falhar, houver um erro irrecuperável ou o job estourar o limite de tempo por inatividade (`HERMES_CRON_TIMEOUT`, padrão de 600s) [cite: 5, 34]:
  1. O erro é registrado no livro de execuções e no gerenciador de incidentes duráveis (`cron/[link suspeito removido]`) [cite: 302, 303].
  2. O Hermes **não realiza retentativas em loop imediato do job inteiro** [cite: 19, 498].
  3. Ele envia um alerta de falha formatado (ex.: `⚠️ Cron 'X' failed: ...`) para o canal configurado (`--failure-deliver` ou `--deliver`) [cite: 19, 461] e **aguarda o próximo intervalo regular agendado** [cite: 498].

---

### 5. Edição de Código Autônoma (Write vs. Read-Only)
* **Uso Predominante e Prática**: Embora a maioria dos usuários utilize cronjobs para monitoramento e geração de relatórios (*read-only*) [cite: 23, 24], tarefas de modificação técnica (como auditorias semanais de segurança, varredura de dependências e refatorações) são plenamente suportadas [cite: 24, 41].
* **Recomendações e Travas de Segurança Recomendadas**:
  1. **Negação Autônoma de Comandos Perigosos (`cron_mode: deny`)**: No modo autônomo de cron, a validação de comandos bloqueia automaticamente qualquer instrução classificada como perigosa (ex.: `rm -rf`, `git push --force`, edição de arquivos de sistema) sem tentar abrir prompts interativos [cite: 108, 109].
  2. **Isolamento de Memória (`skip_memory=True`)**: As sessões do cronjob rodam obrigatoriamente com a opção `skip_memory=True`, impedindo que execuções em segundo plano modifiquem ou corrompam a memória durável global do projeto (`[link suspeito removido]` / `[link suspeito removido]`) [cite: 300].
  3. **Ambiente de Execução em Containers (`Docker Backend`)**: Para cronjobs que alteram código, é recomendado configurar `terminal.backend: docker` no `config.yaml` [cite: 62, 64].
  4. **Sandbox de Escrita e Checkpoints**: Utilizar a variável `HERMES_WRITE_SAFE_ROOT` para restringir a escrita ao diretório do projeto [cite: 58] e manter os `checkpoints` (*shadow git*) ativos para permitir rollback rápido (`/rollback`) de alterações incorretas [cite: 60, 61, 87].

---

### 6. Formatação e Chunking de Relatórios Longos nos Canais
* **Divisão Inteligente consciente do Markdown (*Smart Chunking*)**:
  * Em plataformas que suportam entrega em múltiplas mensagens e edição em tempo real (como Telegram, Discord, Slack, WhatsApp via Baileys e Signal), o Hermes ativa a funcionalidade `splits_long_messages=True` [cite: 197, 208, 515].
  * O relatório é fatiado respeitando o limite da plataforma (ex.: 4.096 caracteres no Telegram/WhatsApp [cite: 208, 221], 2.000 no Discord [cite: 518]) preservando a integridade dos blocos de código (`code fences`), tabelas e parágrafos [cite: 208, 521].
* **Corte com Salvamento em Arquivo Local (*Truncate & Save*)**:
  * Em plataformas sem suporte a envio fatiado ou quando a saída excede limites razoáveis de entrega do canal (para evitar *flooding* de dezenas de mensagens) [cite: 351, 516, 519]:
  * O texto enviado no chat é cortado nos primeiros ~4.000 caracteres, acompanhado do aviso de rodapé: `"truncated, full output saved to ~/.hermes/cron/output/<job_id>_<timestamp>.txt"` [cite: 351, 516, 517].
  * Se o canal do gateway suportar envio de mídias/documentos nativos, o arquivo é anexado e entregue como documento para download [cite: 155].