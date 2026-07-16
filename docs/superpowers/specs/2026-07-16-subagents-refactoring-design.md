# Design Spec: Refatoração da Orquestração e Comunicação de Subagentes

Este documento especifica a arquitetura e o design para a resolução dos problemas críticos identificados na orquestração e fluxo de comunicação dos subagentes no Shark AI. 

As modificações visam eliminar deadlocks de espera, vazamento de processos zumbis, incompatibilidades de schema de ações e o tratamento indevido de respostas inválidas (fallbacks) dos subagentes.

---

## User Review Required

Nenhuma decisão crítica adicional está pendente. Todas as abordagens propostas foram pré-aprovadas pelo usuário durante a rodada de brainstorming.

---

## Proposed Changes

As alterações estão divididas em 4 componentes principais do ecossistema de agentes:

---

### Componente 1: Orquestração e Gerenciamento de Subprocessos (`workflow`)

#### [MODIFY] [subagent-manager.ts](file:///d:/projetos/bmadspot/src/core/workflow/subagent-manager.ts)
- **Parser de Briefing (YAML Frontmatter):**
  - Adicionar a função `parseTaskBrief(filePath: string): { type: string, role: string, prompt: string }`.
  - Ela usará regex para ler e validar o frontmatter delimitado por `---` (campos `type` e `role` obrigatórios) e extrairá o restante do corpo do arquivo como o prompt.
  - Lançará erro se o formato for inválido.
- **Ciclo de Vida Resiliente e Fallbacks:**
  - Adicionar manipulação para `child.on('error')` a fim de reportar falha imediata caso o subprocesso não inicialize.
  - No evento `child.on('exit')`:
    - Se o código de saída for `0` mas nenhuma mensagem foi enviada à mailbox, gravar uma notificação sintética de sucesso silencioso na mailbox do pai.
    - Se o código for diferente de `0`, ler as últimas 15 linhas de `subagent-${id}-console.log` e enviar para a mailbox do pai contendo os detalhes do erro técnico (stderr).
- **Resolução de Caminhos do CLI:**
  - Ajustar a busca de `dist/bin/shark.js` para usar caminhos estáticos ou caminhos relativos ao pacote instalado se a escalada dinâmica falhar na raiz.
- **Controle de Confirmação (Ack) na Mailbox:**
  - Alterar o método `retrieveMessages` para renomear os arquivos JSON processados para `.json.processed` (ou movê-los para o subdiretório `processed/`) em vez de deletá-los imediatamente.
  - Adicionar uma rotina de expiração periódica de arquivos `.processed` antigos (ex: maiores de 24 horas).

---

### Componente 2: Execução de Loop e Eventos do Agente (`agents`)

#### [MODIFY] [developer-agent.ts](file:///d:/projetos/bmadspot/src/core/agents/developer-agent.ts)
- **Ação `invoke_subagent` baseada em `task_file`:**
  - Modificar a ação para ler e validar `action.task_file`.
  - Chamar `parseTaskBrief` e disparar o subagente.
  - Remover qualquer leitura ou processamento do array `action.Subagents`.
- **Prevenção de Zumbis (Process Disconnect):**
  - Se `isSubagent === true` (detectado pela flag ou variáveis de ambiente), adicionar um listener para `process.on('disconnect')` que chama `process.exit(1)` imediatamente caso a conexão IPC com o pai seja interrompida.
- **Timer de Polling da Mailbox (Prevenção de Deadlock):**
  - No início de `interactiveDeveloperAgent`, inicializar um `setInterval` (a cada 2 segundos) que chama `subagentManager.retrieveMessages(myId)`.
  - Para cada mensagem recebida, fazer o `.push()` direto na instância de `messageQueue` do pai.
  - Limpar esse timer no bloco `finally` de `interactiveDeveloperAgent`.
- **Tratamento Rígido de Respostas Inválidas (Fallbacks):**
  - Se o parser retornar a ação `talk_with_user` (fallback sintético) e for um subagente, **não** tratar como conclusão bem-sucedida da tarefa.
  - Tratar como erro de validação (`FAILED`) e notificar o pai com os detalhes da resposta malformada, encerrando o subprocesso.
- **Ajuste de Prompt de Identidade:**
  - Não injetar a frase `"You are a highly skilled Developer Agent."` quando `isSubagent` for verdadeiro, mantendo a identidade isolada do subagente.

#### [MODIFY] [agent-response-parser.ts](file:///d:/projetos/bmadspot/src/core/agents/agent-response-parser.ts)
- Adicionar metadados ou propriedades na resposta indicando se a ação `talk_with_user` foi originada por um fallback de parse de texto puro ou se foi uma chamada direta da IA, para que o executor diferencie.

---

### Componente 3: Protocolo e Definições de Prompts (`api`)

#### [MODIFY] [prompts.ts](file:///d:/projetos/bmadspot/src/core/api/prompts.ts)
- **`COORDINATOR_RESPONSE_JSON_SCHEMA`:**
  - Remover a propriedade `Subagents` ou `subagents` do schema (garantindo conformidade e evitando rejeição em APIs estritas).
  - Atualizar a documentação da ação `invoke_subagent` para descrever apenas o uso de `task_file` e o formato do markdown com YAML Frontmatter.
- **`SUBAGENT_RESPONSE_JSON_SCHEMA`:**
  - Adicionar a propriedade `summary` dentro do objeto `action` (ou ajustar o código de leitura para aceitar na raiz e dentro de `action`).
- **`SUBAGENT_SYSTEM_PROMPT`:**
  - Alinhar a autopercepção do subagente para esclarecer que ele opera de forma stateful no nível de turnos de sua tarefa atribuída, mas stateless em relação a sessões globais.
- **Formatação de Mensagens de Mailbox:**
  - Mudar o template de injeção de mensagens de mailbox no prompt do pai para usar blocos XML (`<mailbox><message>...</message></mailbox>`) bem definidos.

---

## Verification Plan

### Automated Tests
- Criar e rodar testes de unidade focados em `subagent-manager.test.ts` e `developer-agent.test.ts`:
  - Verificar se a desconexão do processo encerra o subagente.
  - Verificar se o parser de YAML Frontmatter extrai corretamente `type`, `role` e o corpo do prompt.
  - Verificar se a ação `wait` acorda imediatamente com uma nova mensagem de mailbox em background antes do término do subprocesso.
  - Verificar se o subagente falha apropriadamente ao tentar retornar texto puro ou ações fora do schema.
- Comando para rodar os testes:
  ```powershell
  npm test
  ```

### Manual Verification
- Criar um caso de teste local em um script scratch (ex: `.gemini/antigravity-ide/brain/5441177b-1b05-4011-9510-860f669c3972/scratch/test-subagent.ts`):
  - Inicializar um agente coordenador que cria um briefing e invoca um subagente de teste.
  - Garantir que o subagente roda, o pai aguarda via `wait` e é acordado pela notificação no meio da execução.
  - Verificar se nenhum processo zumbi resta na tabela de processos do Windows após encerrar a execução de testes abruptamente com Ctrl+C.
