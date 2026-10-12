# Design Specification: Cronjob Parity com Subagente & Hermes (IPC + _CRON_HINT + Script Pre-Run)

- **Data**: 2026-10-12
- **Autor**: Shark AI Architecture Team & User
- **Status**: Aprovado (Brainstorming Concluído)
- **Documento Relacionado**: `docs/cronjob-updated.md`

---

## 1. Contexto e Problema

Na primeira implementação da ferramenta de Cronjobs do Shark AI, identificou-se um vazamento crítico de dados brutos na entrega para canais de mensageria (como WhatsApp):
1. **Poluição de Stdout**: O `CronExecutor` acumulava o `stdout`/`stderr` do processo do runner (`shark dev`), que continha:
   - Avisos da runtime do Node (`(node:...) ExperimentalWarning: SQLite...`).
   - Códigos de escape ANSI de formatação e cores do terminal (`\x1b[2m`, `\x1b[36m`, etc.).
   - Banners e status do TUI (`[START] 🦈 Shark Dev working...`, `[SUCCESS] ✅ Task Scope Completed`).
   - Raciocínio intermediário da LLM (*thinking* logs).
   - Comandos de ferramentas executados no shell (`[INFO] 💻 Executing: powershell...`).
2. **Regex Pós-Fato Frágil**: A função `extractCleanFinalResponse` tentava higienizar via regex um texto de console que frequentemente vinha colapsado ou formatado de forma imprevisível, resultando no envio do histórico inteiro do terminal para o WhatsApp.
3. **Ausência do `_CRON_HINT`**: A LLM não recebia a instrução contextual explícita informando que estava rodando em regime de agendamento automático, que sua resposta seria entregue automaticamente e que poderia utilizar `[SILENT]`.
4. **Scripts Pré-Run Não Integrados ao Agente**: Se um cronjob possuía `script` e agente ativado (`no_agent: false`), o script era ignorado pelo executor em vez de ser pré-executado para enriquecer o contexto factual da LLM.

---

## 2. Decisão de Arquitetura: Alinhamento ao Padrão de Subagentes

Em vez de reinventar a roda, a execução de cronjobs adotará a mesma arquitetura robusta já consolidada no `SubagentManager` (`src/core/workflow/subagent-manager.ts`):

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CRON SCHEDULER / EXECUTOR (Processo Pai)              │
│                                                                        │
│   1. Pré-execução de Script (se job.script & !no_agent)                │
│   2. Geração do Task Brief com _CRON_HINT + stdout do pré-script       │
│   3. fork(sharkJs, ['dev', ...], { silent: true })                     │
└───────────────┬──────────────────────────────────────▲─────────────────┘
                │                                      │
     (Streams stdout/stderr)                 (Canal IPC Nativo)
                │                         process.send({ cron_completion })
                ▼                                      │
┌───────────────────────────────┐     ┌────────────────┴─────────────────┐
│       ARQUIVO DE LOG          │     │     PROCESSO FILHO SHARK DEV     │
│ .shark/cron/output/           │     │                                  │
│ <jobId>-console.log           │     │  • Agente roda autonomamente     │
│ (Auditoria limpa, sem ANSI    │     │  • TUI e logs vão para stdout    │
│  no canal de mensageria)      │     │  • Finaliza com result.summary   │
└───────────────────────────────┘     └──────────────────────────────────┘
```

---

## 3. Especificação Detalhada dos Componentes

### 3.1. Isolamento de Console e Stream de Logs
No `CronExecutor` (`src/core/cron/cron-executor.ts`):
- O processo filho gerado por `fork` continuará com `silent: true`.
- Em vez de concatenar `stdoutBuffer += d.toString()`, o `CronExecutor` criará um `WriteStream` direcionado para `.shark/cron/output/<jobId>-console.log` e aplicará `child.stdout.pipe(logStream)` e `child.stderr.pipe(logStream)`.
- Isso garante que warnings do Node, banners do TUI e traces de ferramentas sejam salvos para histórico/debug sem poluir a memória de entrega.

### 3.2. Canal IPC Estruturado & Fallback por Arquivo
1. **Comunicação IPC Nativa**:
   - O `CronExecutor` escutará mensagens IPC:
     ```ts
     child.on('message', (msg: any) => {
         if (msg?.type === 'cron_completion') {
             cleanSummary = msg.summary;
             isSuccess = msg.success;
         }
     });
     ```
   - No `AgentEngine` (`src/core/engine/agent-engine.ts`), ao concluir a tarefa (se `process.env.SHARK_CRON_EXECUTION === 'true'`):
     ```ts
     if (process.env.SHARK_CRON_EXECUTION === 'true' && typeof process.send === 'function') {
         process.send({
             type: 'cron_completion',
             jobId: effectiveTaskId?.replace(/^cron-/, ''),
             success: result.success,
             summary: result.summary,
             error: result.error
         });
     }
     ```
2. **Fallback por Arquivo (`--result-file`)**:
   - Para máxima resiliência (ex: se o canal IPC for fechado abruptamente ou em ambientes onde IPC falhe), o `devCommand` aceitará `--result-file <path>`.
   - Antes de finalizar, o `devCommand` grava atomicamente o JSON `{ success, summary, error }`.
   - Se nenhuma mensagem IPC foi recebida, o `CronExecutor` lê o arquivo de resultado como fallback determinístico.

### 3.3. Injeção de Contexto e `_CRON_HINT`
No `CronExecutor.executeAgentSubprocess`:
O arquivo de tarefa (`briefFile`) receberá o cabeçalho rígido `_CRON_HINT`:
```markdown
# Scheduled Cron Task: ${job.name || job.id}

[IMPORTANT: You are running as a scheduled cron job.
DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest.
SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]" (nothing else) to suppress delivery. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more.
AUTONOMY: Do not ask questions or prompt the user for confirmation; complete the required task autonomously.]
```

Se `job.skills` estiverem configuradas, elas são listadas logo abaixo.

### 3.4. Scripts Pré-Run (`script` com Agente)
No `CronExecutor.execute`:
- Se `job.script` estiver definido e `!job.no_agent`:
  1. O executor roda o script no diretório do projeto (`job.project_root || projectRoot`).
  2. O `stdout` resultante é capturado.
  3. É injetado no brief da tarefa antes do prompt do usuário:
     ```markdown
     ## Dados Coletados pelo Script de Monitoramento / Pré-Execução:
     ```
     ${scriptResult.output}
     ```

     ## Instrução da Tarefa:
     ${job.prompt}
     ```
- Isso permite que tarefas como monitoramento de APIs, status de serviços ou pipelines injetem dados reais instantaneamente para a LLM interpretar.

### 3.5. Formatação da Entrega (WhatsApp & Canais de Mensageria)
No `AgentEngine.deliverCronResult` (`src/core/engine/agent-engine.ts`):
1. **Detecção de Silêncio (`[SILENT]`)**:
   - Se `cleanSummary.trim() === '[SILENT]'` ou `cleanSummary` contiver exclusivamente `[SILENT]`, a entrega é 100% cancelada (`return;`).
2. **Cabeçalho Identificador Obrigatório**:
   - A mensagem entregue nos canais remotos (WhatsApp, etc.) terá o cabeçalho formatado com o nome ou ID do job:
     ```markdown
     [Cron: ${job.name || job.id}]
     ${cleanSummary}
     ```
3. **Persistência e Espelhamento**:
   - O `CronDeliveryMirror` preserva o espelhamento no `state.db` e no histórico da sessão com o texto limpo entregue.

---

## 4. Estratégia de Testes e Validação

1. **Testes Unitários no `cron-executor.test.ts`**:
   - Validar que o `CronExecutor` extrai a resposta limpa via IPC ou fallback `--result-file`.
   - Validar que logs de stdout/stderr são canalizados para o arquivo de log e **não** retornados no `cleanOutput`.
   - Validar que scripts pré-run são executados e seu stdout é injetado no prompt da tarefa quando `!job.no_agent`.
   - Validar detecção determinística de `[SILENT]`.
2. **Testes Unitários no `agent-engine.test.ts`**:
   - Validar que `deliverCronResult` formata a mensagem com `[Cron: <nome>]` e envia o texto limpo.
   - Validar que `deliverCronResult` suprime entrega quando `cleanOutput` for `[SILENT]`.
3. **Validação de Não-Regressão**:
   - Execução da suíte completa de testes de cron (`npm test src/core/cron`).
