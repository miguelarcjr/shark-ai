### Arquitetura do Motor de Planejamento (`planning-engine.ts`)

O `planning-engine.ts` atua como uma Máquina de Estados Finitos (FSM) determinística e órgão regulador ("cartório") do ciclo de vida de planejamento. O script não tenta realizar interpretações semânticas por meio de regras sintáticas frágeis (como regex ou análise morfológica/POS-tagging); em vez disso, delega o raciocínio divergente aos modelos de linguagem (LLM) enquanto valida rigorosamente dados estruturados, fatos físicos no disco e propriedades topológicas.

---

### Arquivo de Estado Central (`planning-workflow.json`)

O estado do planejamento é mantido em um documento JSON versionado e auditável, eliminando o inchaço desnecessário da janela de contexto da LLM:

```json
{
  "planning_id": "plan-2026-09-16-card-cartoes",
  "status": "in_progress",
  "current_stage": "impact_mapping",
  "stages": {
    "intake": {
      "status": "completed",
      "timestamp": "2026-09-16T14:30:00Z",
      "raw_intent": "Criar o card de cartões na home do Itaú e gerenciar fatura"
    },
    "impact_mapping": {
      "status": "running",
      "targets": [
        { "path": "apps/home/src/cards", "type": "existing", "verified_on_disk": true },
        { "path": "services/cards-api", "type": "existing", "verified_on_disk": true },
        { "path": "services/invoice-aggregator", "type": "new", "parent_exists": true }
      ]
    },
    "spec_generation": {
      "status": "pending",
      "artifact_path": "_bmad-output/card-cartoes-spec.md",
      "open_questions": []
    },
    "task_decomposition": {
      "status": "pending",
      "dag_cycles_detected": false,
      "task_count": 0
    }
  }
}

```

---

### Fluxo de Execução e Portões Determinísticos (Gates)

```
[Entrada do Usuário]
         │
         ▼
┌──────────────────┐
│ Etapa 1: Intake  ├──────► [Gate 1: Validação Estruturada com Schema Zod]
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Etapa 2: Impact  ├──────► [Gate 2: Ancoragem Física (Existing vs New)]
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Etapa 3: Spec    ├──────► [Gate 3: Quality Gate (Seções, Placeholders e Dúvidas)]
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Etapa 4: Tasks   ├──────► [Gate 4: DAG e Algoritmo de Kahn (Sem Ciclos)]
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Etapa 5: Handoff ├──────► [Gate 5: Transição Atômica & Confirmação Humana]
└──────────────────┘

```

#### Etapa 1: Ingestão e Escopo Inicial (Intake)

* **Execução:** O usuário executa `npx shark plan "<intenção>"`. O script inicializa o `planning-workflow.json` e prepara a pasta temporária de rascunhos (`_bmad-output/`).
* **Validação Determinística & Semântica (Gate de Intake):**
* O script valida se o input bruto atende a um comprimento mínimo (`raw_intent.trim().length >= 10`).
* Uma chamada atômica e rápida a uma LLM avalia a acionabilidade da intenção por meio de um schema estruturado estrito (ex.: Zod/JSON Schema):
```typescript
interface IntakeEvaluation {
  is_actionable: boolean;
  missing_context: string[];
  suggested_clarifications: string[];
}

```


* Se `is_actionable` for falso, o script interrompe o avanço, registra as pendências e solicita esclarecimentos ao usuário no terminal, prevenindo o início de planos com escopos inviáveis.





#### Etapa 2: Mapeamento de Impacto (Impact Mapping)

* **Execução:** O subagente de descoberta varre o repositório, cruzando o objetivo com convenções estruturais, documentação (`MEMORY.md`, `AGENTS.md`) e árvores de diretórios. O agente retorna uma lista tipada de módulos e arquivos afetados.


* **Validação Determinística (Gate de Ancoragem Física):**
* O script não permite arquivos alucinados. Os alvos são classificados em `existing` ou `new`.
* Para alvos `existing`: o script executa `fs.existsSync(alvo.path)` para garantir ancoragem física real no disco.
* Para alvos `new` (cenários *greenfield* ou novos módulos): o script valida se o diretório pai existe (`fs.existsSync(path.dirname(alvo.path))`) e se o caminho respeita os padrões de arquitetura do projeto (ex.: dentro de `apps/` ou `packages/`).



#### Etapa 3: Redação da Especificação Técnica (Spec Generation)

* **Execução:** O subagente redator gera a especificação técnica formal em Markdown (`-spec.md`) com base nos módulos mapeados, definindo escopo, contratos e critérios de aceite.


* **Validação Determinística (Spec Quality Gate):**
* **Estrutura Obrigatória:** O script realiza o parsing AST/Markdown do arquivo gerado para verificar a presença de seções indispensáveis (`## Critérios de Aceite`, `## Contratos de API`).
* **Completude Real:** O validador rejeita textos vazios ou mockados, exigindo uma quantidade mínima de critérios de aceite no formato de checklist (`- [ ]`).


* **Detecção de Placeholders:** O script bloqueia a spec caso encontre marcadores de incompletude como `TODO`, `TBD` ou `N/A`.
* **Fechamento de Incertezas:** O array `open_questions` dentro do estado deve estar vazio ou com todos os itens marcados como `status: "resolved"`. Se houver perguntas pendentes, a spec não pode ser aprovada.



#### Etapa 4: Decomposição em Tarefas e Validação de Grafo (Task Decomposition)

* **Execução:** O subagente decompõe a especificação validada em tarefas atômicas. Cada tarefa declara formalmente seu `id`, o `target_module` afetado, os artefatos de entrada (`inputs`), as saídas esperadas (`outputs`) e a lista de `dependencies` (IDs de tarefas precedentes).


* **Validação Determinística (Gate Topológico - DAG):**
* O script processa a lista de tarefas e constrói um Grafo Acíclico Dirigido (DAG).
* Executa o **Algoritmo de Kahn** em TypeScript para calcular a ordenação topológica de execução e garantir a ausência de dependências circulares ($A \rightarrow B \rightarrow A$).
* Valida a consistência de dados: se a Tarefa B consome saídas da Tarefa A, a dependência direta entre elas deve constar explicitamente no grafo.



#### Etapa 5: Aprovação Final e Transição Atômica (Handoff to Dev)

* **Execução:** O plano encontra-se validado por regras matemáticas e físicas.


* **Validação Determinística (Gate Transacional):**
* O script realiza a migração dos arquivos da pasta temporária (`_bmad-output/`) para os diretórios definitivos de especificações (`docs/specs/`) de forma transacional e atômica. Se qualquer operação de E/S falhar, o script executa rollback imediato para não deixar artefatos corrompidos.
* O estado final é transformado em comandos prontos para consumo pelo motor de desenvolvimento (`workflow-engine.ts`).
* Uma interface no terminal exibe o resumo completo da spec e do grafo gerado, solicitando a autorização humana explícita antes de acionar a execução de código (`shark dev`).



---

### Tratamento de Falhas e Bounded Feedback Loop

Para evitar travamentos abruptos ou loops infinitos de agentes que esgotem recursos de computação, as rejeições dos gates determinísticos seguem o protocolo **Report & Re-prompt**:

1. **Rejeição Estruturada:** Se um gate determinístico falhar (por exemplo, ausência de um arquivo declarado como existente), o script gera um erro estruturado detalhado no arquivo de estado:
```json
{
  "stage": "impact_mapping",
  "error_code": "FILE_NOT_FOUND",
  "message": "O arquivo 'src/services/billing.ts' não foi encontrado no disco."
}

```


2. **Re-prompt Orientado:** O script reexecuta o subagente correspondente, injetando o erro determinístico diretamente no prompt de contexto:
> *"A execução anterior foi rejeitada pelo validador físico: o arquivo `src/services/billing.ts` não existe no repositório. Corrija o plano consultando a estrutura física dos diretórios."*


3. **Limite de Tentativas (Circuit Breaker):** O fluxo permite no máximo **3 tentativas consecutivas** de autocorreção por etapa. Caso o agente não consiga convergir para uma solução válida dentro do limite, o script encerra a execução com código de saída de erro e devolve o diagnóstico ao desenvolvedor humano no terminal, prevenindo loops infinitos.