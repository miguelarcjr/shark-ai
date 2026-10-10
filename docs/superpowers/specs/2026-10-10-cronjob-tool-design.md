# Design Specification: Ferramenta Cronjob no Shark Dev

**Data:** 2026-10-10  
**Autor:** Antigravity & Miguel Arcangelo  
**Status:** Aprovado  
**Inspiração:** Hermes Agent (`docs/cronjob-tool.md`)  

---

## 1. Visão Geral e Propósito

A ferramenta **`cronjob`** provê ao Shark Dev um subsistema autônomo e desacoplado de agendamento de tarefas. Com ela, o próprio agente (ou o usuário) pode programar execuções pontuais ou recorrentes para monitoramento, testes, rotinas de manutenção ou geração de relatórios, sem bloquear ou interromper a sessão ativa de desenvolvimento do usuário.

### Princípios Norteadores
1. **Isolamento de Processo (*Process Isolation*)**: Execuções com LLM rodam em subprocessos Node.js independentes (*fresh session*), evitando vazamento de memória e garantindo que falhas em tarefas de segundo plano nunca derrubem o terminal interativo do usuário.
2. **Desacoplamento de I/O e Não-Interrupção**: O terminal principal não é pausado nem recebe injeções indesejadas no meio da linha de raciocínio da LLM. O roteamento de saída é governado pelo parâmetro `deliver`.
3. **Economia de Tokens (*Zero-Token Mode*)**: Suporte nativo ao modo `no_agent: true`, permitindo a execução direta de comandos e scripts locais sem instanciar LLM.
4. **Proteção de Memória Durável**: Tarefas automatizadas rodam com `--skip-memory` para impedir a gravação desgovernada de fatos em `MEMORY.md` e `USER.md`.
5. **Travas Estritas de Segurança**: Travas antirrecursivas (um cronjob não pode agendar outro cronjob) e travas de ciclo de vida (bloqueio de comandos que reiniciem o próprio serviço).

---

## 2. Arquitetura e Modelo de Dados

### 2.1 Estrutura de Arquivos
Todos os módulos do cronjob residem no Core desacoplado do Shark AI:

```
src/core/cron/
├── cron-types.ts           # Interfaces, enums e tipos estruturados
├── cron-storage.ts         # Persistência atômica (.tmp + rename) e lock de arquivo
├── cron-scheduler.ts       # Loop de verificação (ticker), parser de schedule e timers
├── cron-executor.ts        # Runner de subprocessos isolados e scripts diretos
└── cron-tool-handler.ts    # Handler que processa a action 'cronjob' do LLM
```

### 2.2 Modelo de Dados (`.shark/cron/jobs.json`)
Os jobs são armazenados por repositório/workspace dentro do diretório `.shark/cron/`:

```typescript
export type CronJobStatus = 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';

export interface CronJob {
    id: string;                     // ID único: ex. "job-1728591234-abcd"
    name?: string;                  // Nome amigável ou identificador descritivo
    schedule: string;               // Expressão de tempo ("30m", "every 2h", "0 9 * * *", ISO)
    status: CronJobStatus;          // Estado atual do agendamento
    prompt?: string;                // Instrução auto-contida para execução com LLM
    script?: string;                // Caminho do script para execução direta (no_agent: true)
    no_agent?: boolean;             // Se true: executa script sem LLM
    skills?: string[];              // Skills a serem injetadas no contexto do job
    deliver: 'origin' | 'local' | 'whatsapp' | string; // Destino do relatório
    created_at: number;             // Timestamp de criação (ms)
    next_run_at: number;            // Timestamp da próxima execução planejada (ms)
    last_run_at?: number;           // Timestamp da última execução (ms)
    run_count: number;              // Quantidade total de disparos
    last_status?: string;           // Status da última rodada
    last_output_file?: string;      // Caminho do último relatório em .shark/cron/output/
}

export interface CronDatabase {
    version: 1;
    jobs: Record<string, CronJob>;
}
```

### 2.3 Gravação Atômica e Concorrência (`.tick.lock`)
1. **Escrita Atômica**: O arquivo `jobs.json` nunca é sobrescrito diretamente. Ele é escrito em um arquivo temporário (`jobs.json.tmp.<uuid>`) e atômica e confiavelmente renomeado para `jobs.json`.
2. **Lock de Agendador (`.tick.lock`)**: Ao iniciar a rodada de verificação ou atualizar dados concorrentes, cria-se o arquivo `.shark/cron/.tick.lock`. Locks com mais de 120 segundos são considerados órfãos (*stale*) e liberados automaticamente.
3. **Relatórios em Disco**: As execuções gravam seus resultados integrais em `.shark/cron/output/<job-id>-<timestamp>.md`.

---

## 3. Interface da Ferramenta e Schemas do Agente

### 3.1 Ação Única `cronjob`
O modelo interage via action unificada `cronjob` contendo o parâmetro `action`:

```json
{
  "thought": "Preciso agendar a checagem de integridade das dependências a cada 4 horas.",
  "action": {
    "type": "cronjob",
    "args": {
      "action": "create",
      "schedule": "every 4h",
      "prompt": "Verifique a integridade de npm audit e reporte alertas críticos.",
      "deliver": "origin"
    }
  },
  "summary": "Agendado monitoramento de dependências para cada 4 horas."
}
```

### 3.2 Operações Suportadas (`args.action`)
* **`create`**: Cria um novo agendamento. Parâmetros: `schedule` (obrigatório), `prompt` ou `script`, `no_agent`, `deliver`, `skills`.
* **`list`**: Retorna a lista de tarefas agendadas com IDs, status, próximo disparo e destino de entrega.
* **`update`**: Atualização parcial de configurações existentes (`id`, `schedule`, `prompt`, `script`, `deliver`, `skills`).
* **`pause`**: Pausa temporariamente a execução de um agendamento (`id`).
* **`resume`**: Reativa um agendamento pausado ou rearma uma execução única concluída (`id`).
* **`run`**: Força a execução assíncrona imediata fora da janela agendada (`id`).
* **`remove`**: Exclui permanentemente o agendamento (`id`).

### 3.3 Sintaxe de Agendamento (`schedule`)
O parser suporta quatro formatos determinísticos:
1. **Atraso Relativo (*Relative Delay*)**: `30s`, `15m`, `2h`, `1d` (disparos únicos no futuro).
2. **Intervalo Recorrente (*Interval*)**: `every 30m`, `every 2h`, `every 1d`.
3. **Cron UNIX Padrão (*Cron Expression*)**: Formato de 5 campos (ex.: `0 9 * * *`, `*/10 * * * *`).
4. **Data/Hora ISO 8601**: Timestamp exato (ex.: `2026-10-11T12:00:00Z`).

### 3.4 Integração em `src/core/api/prompts.ts`
* **Schema no Coordenador (`COORDINATOR_ACTION_SCHEMAS`)**:
  ```typescript
  defineAction("cronjob", {
    action: { type: "string", enum: ["create", "list", "update", "pause", "resume", "run", "remove"] },
    id: { type: ["string", "null"] },
    schedule: { type: ["string", "null"] },
    prompt: { type: ["string", "null"] },
    script: { type: ["string", "null"] },
    no_agent: { type: ["boolean", "null"] },
    skills: { type: ["array", "null"], items: { type: "string" } },
    deliver: { type: ["string", "null"] }
  })
  ```
* **System Prompt do Coordenador**: Adição de uma seção dedicada descrevendo as capacidades da ferramenta, sintaxes e o token `[SILENT]`.
* **Trava Antirrecursiva nos Subagentes**: A action `cronjob` **não** é registrada em `SUBAGENT_ACTION_SCHEMAS`.

---

## 4. Motor de Execução e Ciclo do Scheduler

### 4.1 Ticker em Segundo Plano (`CronScheduler`)
1. O agendador inicializa junto com a sessão ativa (`shark dev` ou bot de mensagens) rodando com `.unref()`.
2. A cada 60s (ou no tempo da próxima tarefa agendada iminente):
   * Adquire o arquivo `.tick.lock`.
   * Identifica jobs com `status === 'scheduled'` e `next_run_at <= Date.now()`.
   * Atualiza `status = 'running'` e grava no banco atômico.
   * Calcula o próximo horário de disparo para jobs recorrentes (`run_count++`). Para tarefas únicas, define `status = 'completed'` após o disparo.
   * Libera a trava `.tick.lock`.

### 4.2 Executor de Tarefas (`CronExecutor`)

#### Modo Agente (`agent-backed`, padrão)
* Cria o arquivo com a instrução isolada da tarefa em `.shark/cron/tasks/task-<jobId>.md`.
* Se houver `skills` declaradas no job, injeta o conteúdo das skills como instruções iniciais.
* Spawna um subprocesso Node.js com o binário do Shark:
  ```typescript
  const args = [
    'dev',
    '--task-file', taskBriefPath,
    '--taskId', `cron-${job.id}`,
    '--auto',
    '--skip-memory'
  ];
  const child = fork(pathToSharkJs, args, { cwd: projectRoot, silent: true });
  ```
* Coleta o resultado ao término do processo.

#### Modo Script sem Tokens (`no_agent: true`)
* Executa o comando ou script local via `child_process.execFile` ou `child_process.exec`.
* Não aciona a LLM e não gasta tokens.
* Captura o `stdout` e o código de saída.

### 4.3 Roteador de Entrega (`deliver`) e Token `[SILENT]`
* Todo resultado é gravado em `.shark/cron/output/<jobId>-<timestamp>.md`.
* **Supressão por `[SILENT]`**: Se o relatório ou `stdout` for ou contiver o marcador `[SILENT]`, nenhuma notificação externa é emitida.
* **Destino do Relatório**:
  * `local`: Nenhuma notificação externa é enviada além da gravação em disco.
  * `origin`:
    * Se no CLI (`shark dev`): exibe um aviso não intrusivo de uma linha no terminal (`ℹ️ [Cron: <id>] Concluído. Relatório em .shark/cron/output/...`).
    * Se no WhatsApp: despacha a mensagem de retorno no chat de origem.
  * `whatsapp`: Envia diretamente através do canal configurado.

---

## 5. Regras de Segurança, Travas e Limites

1. **Watchdog de Inatividade e Hard Kill**:
   * O subprocesso é monitorado pelo Watchdog (mesmo mecanismo do `SubagentManager`).
   * Se ficar inativo por mais de 600 segundos (sem emitir ações ou logs), o processo é encerrado.
   * Hard timeout de segurança para scripts de no máximo 3 a 5 minutos, finalizando com `kill('SIGKILL')` e `tree-kill`.
2. **Trava Antirrecursiva (*Recursion Guard*)**:
   * Desativado a nível de prompt/schema para subagentes e cronjobs.
   * Desativado em runtime: se o processo possuir a variável de ambiente `SHARK_CRON_EXECUTION=true`, o `AgentActionExecutor` rejeita chamadas de criação de cronjob.
3. **Trava de Ciclo de Vida (*Lifecycle Guard*)**:
   * Rejeita prompts ou comandos que tentem parar ou reiniciar o próprio processo hospedeiro (`shark dev`, `pkill shark`, etc.).
4. **Isolamento de Memória Durável (`--skip-memory`)**:
   * Sessões de cronjob rodam com a flag `--skip-memory`.
   * Tentativas de invocar a ação `memory` para gravar no perfil do usuário ou na memória do repositório são bloqueadas.
5. **Bloqueio de Ferramentas Interativas**:
   * Ações que exigem interação humana no terminal (como `talk_with_user`) são desativadas ou respondem com erro informando a ausência de operador humano.

---

## 6. Estratégia de Testes

Os testes serão implementados utilizando **Vitest**:

| Arquivo de Teste | Foco de Cobertura |
| :--- | :--- |
| `src/core/cron/cron-storage.test.ts` | Gravação atômica, aquisição/liberação de `.tick.lock`, tratamento de locks órfãos e persistência em `jobs.json`. |
| `src/core/cron/cron-scheduler.test.ts` | Parsing de formatos (`30m`, `every 2h`, `0 9 * * *`, ISO), cálculo de `next_run_at`, transições de status (`scheduled`, `running`, `completed`). |
| `src/core/cron/cron-executor.test.ts` | Execução de scripts com `no_agent: true`, supressão com `[SILENT]`, gravação em `.shark/cron/output/` e atuação do Watchdog em timeouts. |
| `src/core/cron/cron-tool-handler.test.ts` | Ações `create`, `list`, `update`, `pause`, `resume`, `run`, `remove`, validação de erros e travas de segurança. |
| `src/core/engine/agent-action-executor.test.ts` | Integração ponta a ponta da action `cronjob` através do JSON do modelo. |
