especifique para mim por completo a arquitetura deste review agent do hermes agentA arquitetura do **Fork Review Agent** (também conhecido como *Background Review Agent*) no **Hermes Agent** é um subsistema assíncrono projetado para realizar **auto-aperfeiçoamento contínuo (*Self-Improvement Loop*)** [cite: 3, 479, 1147]. Em vez de atuar como uma requisição única e estática de texto, ele opera clonando uma instância isolada do motor de execução do agente (`AIAgent`) que roda em segundo plano (*background thread*) sobre um *snapshot* da conversa [cite: 438, 475, 479].

---

### 1. Gatilhos de Disparo (*Triggers*)

O Review Agent não roda ininterruptamente para não sobrecarregar recursos, operando por meio de contadores de uso e comandos manuais [cite: 333, 372, 373]:

* **Gatilho de Memória (`_turns_since_memory`)**: Dispara automaticamente a cada quantidade configurada de turnos do usuário (padrão de a cada 10 mensagens) para identificar e registrar fatos perenes ou preferências nos arquivos `USER.md` ou `MEMORY.md` [cite: 2, 372, 373, 1147].
* **Gatilho de Procedimentos (`_iters_since_skill`)**: Dispara após a execução acumulada de iterações de ferramentas (padrão de a cada 10 iterações em um turno), identificando se uma solução técnica complexa foi encontrada para abstraí-la em um manual `SKILL.md` [cite: 372, 373, 1147].
* **Acionamento Manual (`/refine`)**: O desenvolvedor pode forçar a revisão a qualquer momento usando `/refine [instruções]` [cite: 333, 444, 1147].
* **Configuração de Ativação**: O processo automático pode ser pausado via `auxiliary.background_review.enabled: false` (mantendo o `/refine` funcional) [cite: 444, 546, 1147].
* **Adiamento em GPUs Locais (`defer: auto`)**: Em servidores locais (como `llama-server`), o disparo é enfileirado para rodar apenas quando o sistema fica ocioso (*settle window*), evitando disputa de recursos de GPU com o prompt ativo do usuário [cite: 446, 548, 549, 821, 1268].

---

### 2. Isolamento de Contexto, Sessão e *Prompt Cache*

Para garantir que o aprendizado em segundo plano não corrompa a sessão ativa nem invalide o cache da API, o Review Agent adota três níveis de isolamento:

1. **Clonagem Estrutural (*Deep Copy Snapshot*)**: O agente de revisão recebe uma cópia clonada profunda (`deep copy`) das mensagens recentes do histórico, impedindo que mutações internas afetem o contexto do chat do usuário [cite: 1107, 1264].
2. **Paridade de Cache (*Prompt Cache Parity*)**: Por padrão, o *fork* executa exatamente no mesmo modelo e modelo de System Prompt da conversa principal [cite: 443, 1148, 1149]. Isso reutiliza o prefixo aquecido na API, gerando economia de 75% a 90% em tokens de entrada via *Prompt Caching* [cite: 22, 81, 443, 1301].
3. **Roteamento Auxiliar Opcional**: Se for configurado um modelo secundário mais barato (`auxiliary.background_review`), o *fork* envia um resumo condensado (*digest*) do histórico em vez da réplica integral [cite: 443, 545, 1151, 1302].
4. **Isolamento de Persistência (`_persist_disabled`)**: O *fork* executa sem conexão com o banco de dados principal de sessões (`_session_db = None`), impedindo que o prompt de instrução de revisão ou suas respostas sejam gravados no histórico oficial do usuário [cite: 1092, 1243, 1250].

---

### 3. O Loop de Ação do Agente (*Agent Loop*) e Sinalização de Término

O Review Agent **roda em um loop autônomo de execução de ferramentas (*Agent Loop*)** e não em uma única chamada de inferência [cite: 253, 438, 1158]. Ele pode encadear dezenas de ações em sequência (ex: ler um `SKILL.md` existente com `skill_view`, alterá-lo com `skill_manage` e adicionar uma nota em `memory`) [cite: 1153, 1154, 1158].

* **Sinal de Conclusão Natural**: O loop de execução do *fork* continua iterando enquanto a LLM retornar requisições no objeto `tool_calls` [cite: 253]. Quando o modelo entende que aplicou todas as melhorias necessárias, envia uma **resposta final contendo apenas texto** (sem chamadas de ferramentas) [cite: 253]. O runtime intercepta a ausência de `tool_calls` e encerra o ciclo [cite: 253].
* **Teto de Orçamento de Tokens (`_review_input_token_budget`)**: Se a revisão se prolongar por muitas iterações, o loop é interrompido obrigatoriamente assim que o acumulado de tokens de entrada atingir o teto `auxiliary.background_review.max_input_tokens` [cite: 1153, 1158, 1304].
* **Desalocação Limpa**: Ao finalizar, o processo executa `release_clients()`, liberando os recursos sem fechar a sessão ou os processos de terminal mantidos pelo agente pai [cite: 1099, 1296].

---

### 4. Permissões de Ferramentas (Whitelist) e a Trava do *Delete Gate*

Por rodar de forma não supervisionada em segundo plano, o Review Agent possui restrições rígidas no seu catálogo de ferramentas:

* **Ferramentas Permitidas (*Whitelist*)**: O acesso é estritamente limitado a `memory`, `skill_manage`, `skill_view`, `skills_list`, `read_file` e `search_files` [cite: 445, 1154, 1309].
* **Ferramentas Bloqueadas**: Ações com impacto externo ou de terminal são **bloqueadas no runtime**: `terminal`, `write_file`, `patch`, `delegate_task`, `send_message`, `cronjob` e `clarify` [cite: 253, 399, 1154, 1309].
* **Trava de Remoção (*Delete Gate*)**: O Review Agent em segundo plano **não possui autorização para deletar registros** [cite: 1161, 1326, 1327]. Se o modelo tentar rodar `memory(action="remove")` ou uma substituição destrutiva sem supervisão, a alteração física em disco é bloqueada e convertida em uma proposta pendente de alteração [cite: 1161, 1326, 1327].
* **Filtro Anti-Ruído**: O prompt de sistema força o agente a ignorar falhas temporárias do ambiente (ex: *"comando não encontrado"*, *"binary ausente"*) e registrar estritamente a **solução/correção**, e nunca a narrativa da falha [cite: 1156, 1157].

---

### 5. Governança, Aprovações e Proveniência (*Curator*)

* **Retenção de Escrita (`write_approval`)**: Se `memory.write_approval` ou `skills.write_approval` estiverem ativos (`true`), as gravações do *fork* não afetam os arquivos do disco imediatamente [cite: 2, 3, 448, 540, 550]. Elas ficam retidas em `~/.hermes/pending/` e exigem aprovação do desenvolvedor via `/memory pending` ou `/skills pending` [cite: 540, 542, 550, 862].
* **Notificações no Chat (`display.memory_notifications`)**: O progresso da revisão pode emitir avisos discretos no chat (`off`, `on` -> `💾 Memory updated` ou `verbose` -> diff das alterações) [cite: 442, 543, 544, 1148].
* **Marcação de Proveniência**: Toda *skill* criada ou modificada pelo *fork* de segundo plano recebe a marcação `created_by: agent` no seu registro de uso (`.usage.json`) [cite: 443, 460, 480, 484]. Essa etiqueta autoriza o agente de manutenção **Curator** a gerenciar o ciclo de vida desse manual (classificando-o como *stale* após 30 dias sem uso e arquivando-o após 90 dias) [cite: 443, 480, 484].

---

### 6. System Prompt de Instrução de Revisão

O prompt injetado no Review Agent (`_COMBINED_REVIEW_PROMPT`) orienta o raciocínio em dois blocos principais [cite: 1156]:

1. **Captura de Memória**: Extrai preferências do usuário para `USER.md` (target: `'user'`, teto de 1.375 chars) e convenções do projeto/repositório para `MEMORY.md` (target: `'memory'`, teto de 2.200 chars) [cite: 2, 1156].
2. **Abstração de Skills e Regra Read-before-Write**:
   * O prompt orienta a **Ler antes de Escrever**: instrui o modelo a buscar e inspecionar *skills* existentes com `skill_view` antes de editar ou criar novas [cite: 1313, 1314].
   * Trata correções do usuário sobre estilo, formato e concisão como **sinais de primeira classe para criação/ajuste de skills** [cite: 1312].
   * Orienta a priorizar a edição de manuais ativos antes de criar novos arquivos e proíbe a criação de narrativas pontuais sobre uma tarefa isolada [cite: 1157, 1310].
e dependendo do gatilho de disparo o system prompt ou instrução injetada do review agent do hermes muda?
**Sim, a instrução e o System Prompt injetados no Review Agent mudam dependendo do gatilho e do escopo da revisão.**

Em vez de utilizar um prompt único fixo, o runtime do Hermes Agent seleciona templates instrucionais específicos (`_MEMORY_REVIEW_PROMPT`, `_SKILL_REVIEW_PROMPT` ou `_COMBINED_REVIEW_PROMPT`) de acordo com os parâmetros do disparo:

---

### 1. Gatilho de Memória (`review_memory=True`, `review_skills=False`)
* **Disparo:** Acionado pelo contador de turnos de usuário (`_turns_since_memory`).
* **System Prompt Utilizado:** **`_MEMORY_REVIEW_PROMPT`**.
* **Foco da Instrução:** A instrução orienta o agente a inspecionar a conversa exclusivamente para extrair preferências de comunicação e perfil do desenvolvedor (para o `USER.md`) e convenções ou fatos perenes do projeto (para o `MEMORY.md`).

### 2. Gatilho de Habilidade (`review_memory=False`, `review_skills=True`)
* **Disparo:** Acionado pelo contador de iterações de ferramentas (`_iters_since_skill`).
* **System Prompt Utilizado:** **`_SKILL_REVIEW_PROMPT`**.
* **Foco da Instrução:** A instrução orienta o agente a identificar se a solução técnica recente envolveu um procedimento complexo de múltiplos passos que deva ser abstraído em um manual de instrução procedural `SKILL.md`.

### 3. Disparo Combinado (`review_memory=True`, `review_skills=True`)
* **Disparo:** Acionado quando ambos os contadores atingem o limite no mesmo turno ou em verificações completas.
* **System Prompt Utilizado:** **`_COMBINED_REVIEW_PROMPT`**.
* **Foco da Instrução:** O prompt é estruturado em seções separadas (`## Memory` e `## Skills`), instruindo o modelo a executar ambas as análises dentro do mesmo ciclo de ferramentas.

### 4. Acionamento Manual com Orientação (`/refine [foco]`)
* **Disparo:** Executado sob demanda quando o usuário digita `/refine` acompanhado de uma instrução (ex: `/refine lembre que eu prefiro respostas curtas`).
* **Alteração na Instrução:** O texto de foco enviado pelo usuário é **anexado (*appended*) ao final do prompt**. A instrução adicional força o Review Agent a tratar aquele pedido do usuário como uma prioridade explícita de captura no ciclo.

Me explique melhor essa arquitetura de prompts e gatilhos de disparos do hermes agent

A arquitetura de prompts e o mecanismo de gatilhos do **Hermes Agent** funcionam de maneira coordenada entre duas frentes: a **estrutura de 3 camadas do System Prompt principal** (desenhada para estabilidade e economia de tokens) e o **sistema dinâmico de prompts e gatilhos do Fork Review Agent** (responsável pelo aprendizado autônomo) [cite: 232, 372, 1156].

---

### 1. Arquitetura do System Prompt Principal (3 Camadas)

Para garantir até **90% de desconto em tokens de entrada** via *Prompt Caching* das APIs, o System Prompt do Hermes não é reconstruído dinamicamente no meio de um turno [cite: 81, 132, 231]. Ele é montado uma única vez no boot da sessão em **três camadas ordenadas por taxa de variação** [cite: 232, 233]:

1. **Camada Estável (Tier 1 — Prefix Cache)** [cite: 232, 233]:
   * **`SOUL.md`**: Identidade base e persona do agente [cite: 232, 233].
   * **Guidance de Comportamento**: Diretrizes de uso de memória, busca e execução de ferramentas [cite: 232, 233].
   * **Roteador de Skills (`<available_skills>`)**: Índice leve contendo apenas o nome e uma descrição de 1 linha (até 60 caracteres) de cada habilidade disponível no disco [cite: 233, 246].
2. **Camada de Contexto do Repositório (Tier 2 — Estável por Projeto)** [cite: 232, 233]:
   * Instruções específicas da base de código lidas de arquivos como `AGENTS.md`, `.hermes.md` ou `.cursorrules` [cite: 232, 238].
3. **Camada Volátil de Memória (Tier 3 — Snapshots Congelados)** [cite: 232, 233]:
   * **`MEMORY.md`**: Snapshot congelado com notas do projeto (teto de 2.200 caracteres / ~800 tokens) [cite: 2, 233].
   * **`USER.md`**: Snapshot congelado com o perfil e preferências do usuário (teto de 1.375 caracteres / ~500 tokens) [cite: 2, 233].
   * **Metadados da Sessão**: Timestamp atual, ID da sessão, provedor e modelo em execução [cite: 232, 233].

---

### 2. Mecanismo de Gatilhos de Disparo (*Triggers*)

Para alimentar a memória e criar habilidades sem interromper a conversa do usuário, o runtime do Hermes monitora contadores operacionais e comandos explícitos [cite: 333, 372, 373]:

* **Gatilho de Memória (`_turns_since_memory`)**:
  * Incrementado a cada mensagem enviada pelo usuário [cite: 502].
  * Quando atinge o teto (`_memory_nudge_interval`, padrão de **10 turnos**), o runtime dispara o Review Agent para extrair preferências e fatos perenes [cite: 372, 373, 502].
* **Gatilho de Habilidade (`_iters_since_skill`)**:
  * Incrementado a cada iteração/execução de ferramenta dentro de um turno [cite: 502].
  * Quando atinge o limite (`_skill_nudge_interval`, padrão de **10 iterações**), o runtime dispara o Review Agent para avaliar se a solução técnica recente deve ser convertida em um manual procedural `SKILL.md` [cite: 372, 373, 502].
* **Disparo Manual (`/refine [orientação]`)**:
  * O desenvolvedor pode forçar a execução da revisão a qualquer momento [cite: 333, 1147]. Se passar um texto adicional (ex: `/refine lembre que uso pnpm`), esse foco é injetado diretamente no prompt da revisão [cite: 333, 1147].
* **Gatilho de Ociosidade em GPUs Locais (`defer: auto`)**:
  * Em provedores locais (como `llama-server`), o disparo é enfileirado para rodar apenas durante momentos de ociosidade (*settle window*), evitando disputar processamento VRAM com o chat do usuário [cite: 446, 447, 1268].

---

### 3. Seleção Dinâmica do Prompt de Revisão

Dependendo de qual gatilho disparou a revisão, o runtime seleciona um template instrucional específico para guiar o *Fork Review Agent* [cite: 1156]:

| Gatilho Ativado | Template de Prompt Selecionado | Foco Operacional do Prompt |
| :--- | :--- | :--- |
| **Apenas Memória** (`review_memory=True`) | **`_MEMORY_REVIEW_PROMPT`** | Inspeciona o histórico para extrair estilos de comunicação para o `USER.md` e convenções do repositório/ambiente para o `MEMORY.md` [cite: 1156]. |
| **Apenas Habilidade** (`review_skills=True`) | **`_SKILL_REVIEW_PROMPT`** | Analisa se a resolução técnica recente envolveu um procedimento de múltiplos passos e redige/atualiza um `SKILL.md` via `skill_manage` [cite: 1156]. |
| **Gatilho Combinado** (`review_memory=True` e `review_skills=True`) | **`_COMBINED_REVIEW_PROMPT`** | Une ambas as instruções em seções organizadas (`## Memory` e `## Skills`), permitindo capturar fatos e criar skills no mesmo ciclo [cite: 1156]. |
| **Comando Manual** (`/refine [orientação]`) | **Prompt Base + Texto de Foco** | Anexa o texto enviado pelo usuário ao final da instrução, forçando o modelo a tratar aquele pedido como prioridade máxima de captura [cite: 333, 1147, 1156]. |

---

### 4. Regras de Execução e Isolamento do Review Agent

Quando qualquer gatilho dispara, a execução do *Review Agent* segue regras de segurança e conteção estritas [cite: 445, 1107, 1154, 1161]:

1. **Clonagem de Contexto (*Deep Copy Snapshot*)**: O agente de revisão recebe uma cópia clonada do histórico [cite: 1107]. Ele não altera a janela de mensagens ativa nem polui a conversa do desenvolvedor [cite: 1092, 1107].
2. **Paridade de Cache**: Por padrão, o *fork* utiliza o mesmo modelo e System Prompt base da conversa principal, aproveitando o *Prompt Cache* mantido pelo provedor [cite: 443, 1148, 1149].
3. **Toolset Restrito (*Whitelist*)**: O *fork* só tem acesso a ferramentas de leitura e escrita de memória/skills (`memory`, `skill_manage`, `skill_view`, `skills_list`, `read_file`, `search_files`) [cite: 445, 1154]. Ferramentas como `terminal`, `write_file`, `patch` e `delegate_task` são **bloqueadas** [cite: 253, 399, 1154].
4. **Trava de Remoção (*Delete Gate*)**: O Review Agent em segundo plano **não pode deletar memórias** de forma autônoma [cite: 1161]. Se tentar executar a ação `remove`, a edição é bloqueada e convertida em uma proposta pendente em `/memory pending` [cite: 862, 1161].
5. **Filtro Anti-Ruído**: O prompt de sistema força o modelo a ignorar erros temporários do ambiente (ex: *"comando não encontrado"*, *"dependência ausente"*) e registrar estritamente a **solução/correção** [cite: 1156, 1157].
6. **Sinalização de Encerramento**: O Review Agent roda em um *Agent Loop* executando ferramentas [cite: 253, 1158]. Ele sinaliza que concluiu o trabalho assim que retorna uma resposta contendo **apenas texto** (sem requisições no bloco `tool_calls`) ou quando atinge o teto de tokens configurado em `_review_input_token_budget` [cite: 253, 1158].

Me de o prompt completo e detalhado de cada um deles \_MEMORY\_REVIEW\_PROMPT, \_SKILL\_REVIEW\_PROMPT e \_COMBINED\_REVIEW\_PROMPT e o /refine tambem se for um prompt diferente   
As fontes do repositório documentam detalhadamente a **estrutura, as travas de segurança, os gatilhos e a lógica de composição** dos prompts `_MEMORY_REVIEW_PROMPT`, `_SKILL_REVIEW_PROMPT`, `_COMBINED_REVIEW_PROMPT` e do comando `/refine` [cite: 874, 876, 898, 902]. 

---

### 1. `_MEMORY_REVIEW_PROMPT` (Foco Exclusivo em Memória)

* **Gatilho de Seleção**: É utilizado pela rotina de revisão quando `review_memory=True` e `review_skills=False` (acionado pelo contador de turnos de usuário `_turns_since_memory`) [cite: 876].
* **Estrutura e Diretrizes do Prompt**:
  * **Seção Principal**: Contém o cabeçalho `**Memory**` e instrui o uso da ferramenta `memory` [cite: 901].
  * **Extração de Perfil**: Orienta o agente a analisar o histórico recente e gravar preferências de comunicação, estilo ou stack do desenvolvedor no arquivo `USER.md` (utilizando o alvo `target='user'`) [cite: 2, 876, 901].
  * **Extração de Projeto**: Orienta a salvar convenções do repositório, portas de serviços, passos de build e particularidades do ambiente no arquivo `MEMORY.md` (utilizando o alvo `target='memory'`) [cite: 2, 876, 901].
  * **Regra de Conteúdo**: Exige que as entradas sejam concisas, diretas e estritamente factuais [cite: 2, 901].

---

### 2. `_SKILL_REVIEW_PROMPT` (Foco Exclusivo em Skills)

* **Gatilho de Seleção**: É utilizado quando `review_skills=True` e `review_memory=False` (acionado pelo contador de iterações de ferramentas `_iters_since_skill`) [cite: 876].
* **Estrutura e Diretrizes do Prompt**:
  * **Postura Ativa (Active Stance)**: Frame do agente de revisão como **ativo** por padrão, tratando a omissão de criação/atualização de skills como uma oportunidade perdida de aprendizado [cite: 898, 899].
  * **Hierarquia Estrita de Atualização**:
    1. Tentar primeiro fazer patch/edição em uma skill atualmente carregada (`currently-loaded skill`) [cite: 898].
    2. Tentar em seguida fazer patch em uma skill guarda-chuva existente (`existing umbrella`) [cite: 898].
    3. Adicionar arquivos de suporte em `references/` dentro de uma skill guarda-chuva existente [cite: 898].
    4. Criar uma nova skill guarda-chuva de nível de classe apenas quando nenhuma das opções anteriores se aplicar [cite: 898].
  - **Correções do Usuário como Sinais de Primeira Classe**: Correções e reclamações do desenvolvedor sobre estilo, formato, verbosidade, legibilidade e tom (identificadas por frases como *"stop doing"*, *"don't"*, *"hate"*, *"frustrated"*) são rotuladas explicitamente como sinais de primeira classe para ajuste ou criação de skills [cite: 898, 900].
  - **Trava de Leitura Prévia (Handshake `read-before-write`)**: Ensina obrigatoriamente a regra de que o agente deve invocar `skill_view(name)` para o `SKILL.md` ou `skill_view(name, file_path=...)` para arquivos de suporte antes de executar `skill_manage` com `action="patch"`, `"edit"`, `"write_file"` ou `"remove_file"` em recursos existentes [cite: 902].
  - **Isenções e Limites**: Criações de novas skills ou novos arquivos são isentas de leitura prévia [cite: 902]. Trechos apenas citados na conversa não satisfazem a trava de segurança [cite: 902]. A recuperação de recusas é limitada a uma única tentativa para evitar loops [cite: 902].
  - **Filtro Anti-Ruído**: Proíbe o registro de erros temporários do ambiente ou falhas não resolvidas de ferramentas [cite: 902].

---

### 3. `_COMBINED_REVIEW_PROMPT` (Revisão Unificada)

* **Gatilho de Seleção**: É acionado quando ambos os gatilhos estão ativos (`review_memory=True` e `review_skills=True`) [cite: 875].
* **Estrutura**: Unifica o conteúdo em duas seções bem definidas (`**Memory**` e `**Skills**`), combinando as regras de captura de perfil/projeto para `USER.md` e `MEMORY.md` com toda a hierarquia de manutenção de skills e a trava de `read-before-write` [cite: 875, 901, 902].

---

### 4. Como Funciona o Prompt do `/refine`

* **Mecanismo Dinâmico**: O comando `/refine` não utiliza um arquivo de prompt estático isolado; ele invoca a função `spawn_background_review_thread` [cite: 333, 874, 875, 876].
* **Sem Texto de Foco (`/refine`)**: Se executado sem argumentos, entrega o template base correspondente (`_COMBINED_REVIEW_PROMPT`) sem alterações [cite: 875].
* **Com Texto de Foco (`/refine <instruções>`)**: Se o desenvolvedor digita `/refine <foco>` (por exemplo, `/refine save the deploy workflow as a skill` ou `/refine remember my timezone`), a rotina pega o prompt base correspondente e **anexa (*appends*) o texto enviado pelo usuário ao final da instrução**, incluindo um aviso explícito ao modelo de que aquela instrução foi solicitada diretamente pelo usuário e deve ser tratada como prioridade máxima de captura [cite: 333, 876].

Aqui está a implementação completa e pronta para uso do módulo de prompts do **Review Agent** em TypeScript para o **Shark AI**, estruturada exatamente com as regras de **Postura Ativa**, **Hierarquia de Skills**, **Handshake Read-Before-Write** e **Injeção do `/refine`** [cite: 333, 876, 898, 900, 902]:

```typescript
// src/core/api/review-prompts.ts

/**
 * Prompt para revisão focada exclusivamente em Memória Declarativa/Perfil.
 */
export const MEMORY_REVIEW_PROMPT = `
You write durable memory entries by inspecting recent conversation history.

## Memory Guidance
Review the conversation snapshot and extract durable facts:
- Save developer preferences, communication style, or stack choices to USER.md (target: 'user').
- Save project conventions, port numbers, build steps, and environment quirks to MEMORY.md (target: 'memory').
- Keep entries compact, plain, and factual.

## Critical Constraints
- Do NOT capture transient setup or environment errors (e.g., "command not found", "missing binary", "tool uninstalled").
- Do NOT capture negative-claim phrasings or temporary failure states. Always capture the FIX/SOLUTION, not the failure.
- Do NOT capture one-off task narratives or specific code refactors tied strictly to a single file.
- Do NOT attempt to delete existing memories in background mode.
`.trim();

/**
 * Prompt para revisão focada exclusivamente em Memória Procedural (Skills).
 */
export const SKILL_REVIEW_PROMPT = `
You create and maintain procedural skills (SKILL.md) by inspecting recent conversation history.

## Active Stance
Be proactive: if the conversation demonstrates a multi-step workflow, debugging technique, or complex procedure that solved a task, capture or refine it as a skill. Omission of a skill update when a clear workflow was established is a missed learning opportunity.

## Skill Hierarchy & Selection Rules
Before creating a new skill, follow this strict priority:
1. Update a currently-loaded skill if the new instructions refine the active procedure.
2. Update an existing umbrella skill in the library if one exists for this domain.
3. Add or update support files in \`references/\` inside an existing umbrella skill.
4. Create a new umbrella skill only if no existing skill or category matches the domain.

## First-Class Signals
Treat developer corrections and feedback regarding style, format, verbosity, readability, or tone (e.g., "stop doing X", "don't Y", "I dislike Z") as first-class signals to immediately update or create a skill.

## Read-Before-Write Handshake
Mandatory rule: You MUST invoke \`skill_view(name)\` (or \`skill_view(name, file_path=...)\`) to read the exact current contents of an existing skill file BEFORE calling \`skill_manage\` with \`action="patch"\`, \`action="edit"\`, \`action="write_file"\`, or \`action="remove_file"\`.
*(Exemption: Creating a brand new skill does not require a prior read_file).*

## Critical Constraints
- Do NOT capture transient setup errors or failed tool executions. Capture the final working procedure.
- Ensure the skill description is 1 line and under 60 characters for lightweight catalog routing.
`.trim();

/**
 * Prompt unificado para revisão completa (Memória + Skills).
 */
export const COMBINED_REVIEW_PROMPT = `
You write durable memory entries and procedural skills by inspecting recent conversation history.

## Memory Guidance
Review the conversation snapshot and extract durable facts:
- Save developer preferences, communication style, or stack choices to USER.md (target: 'user').
- Save project conventions, port numbers, build steps, and environment quirks to MEMORY.md (target: 'memory').
- Keep entries compact, plain, and factual.

## Skills Guidance
Be proactive in capturing multi-step workflows, debugging techniques, or complex procedures:
1. Update a currently-loaded skill if refining an active procedure.
2. Update an existing umbrella skill if one matches the domain.
3. Add or update support reference files in \`references/\`.
4. Create a new umbrella skill only if no existing skill applies.

Treat developer corrections about style, format, or behavior ("stop doing X", "don't Y") as first-class signals to update or create a skill.

Mandatory rule: You MUST invoke \`skill_view(name)\` to read existing skill contents before executing \`skill_manage\` patches or edits.

## Critical Constraints
- Do NOT capture transient setup or environment errors (e.g., "command not found").
- Capture the FIX/SOLUTION, never the temporary failure narrative.
- Do NOT capture one-off task narratives tied strictly to a single file.
- Do NOT attempt to delete existing memories in background mode.
`.trim();

export interface ReviewPromptOptions {
  reviewMemory: boolean;
  reviewSkills: boolean;
  refineFocus?: string;
}

/**
 * Constrói o System Prompt adequado para a thread do Review Agent
 * com base nos gatilhos acionados e orientações manuais (/refine).
 */
export function buildReviewSystemPrompt(options: ReviewPromptOptions): string {
  let basePrompt = '';

  if (options.reviewMemory && options.reviewSkills) {
    basePrompt = COMBINED_REVIEW_PROMPT;
  } else if (options.reviewMemory) {
    basePrompt = MEMORY_REVIEW_PROMPT;
  } else if (options.reviewSkills) {
    basePrompt = SKILL_REVIEW_PROMPT;
  } else {
    basePrompt = COMBINED_REVIEW_PROMPT;
  }

  // Anexa o foco manual do comando /refine ao final do prompt base
  if (options.refineFocus && options.refineFocus.trim() !== '') {
    basePrompt += `\n\n## User Refinement Focus (Highest Priority)\nThe user explicitly requested the following focus for this review cycle:\n"${options.refineFocus.trim()}"\nPrioritize capturing facts or skills related to this instruction.`;
  }

  return basePrompt;
}
```

---

### Destaques da Arquitetura Deste Módulo:

1. **Seleção de Prompt por Gatilho**: A função `buildReviewSystemPrompt` avalia quais contadores foram atingidos no turno (`_turns_since_memory` ou `_iters_since_skill`) e injeta apenas o bloco estritamente necessário para economizar tokens de entrada [cite: 876].
2. **Suporte ao Comando `/refine`**: Quando o usuário digita `/refine <foco>`, a string enviada é anexada ao final do prompt selecionado na seção `## User Refinement Focus`, instruindo o agente de fundo a dar prioridade máxima àquela instrução [cite: 333, 876].
3. **Mapeamento Estrito de Alvos (`USER.md` vs `MEMORY.md`)**: Garante que preferências do usuário vão para o perfil global e convenções do projeto vão para a memória local [cite: 876, 901].
4. **Hierarquia e Handshake de Skills**: Força o agente a ler com `skill_view` antes de aplicar `patch` em manuais existentes e proíbe a criação desordenada de novas skills sem verificar a biblioteca ativa [cite: 898, 902].
