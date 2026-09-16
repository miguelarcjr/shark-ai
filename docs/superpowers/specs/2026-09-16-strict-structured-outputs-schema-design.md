# Design Spec: Alinhamento Estrito do Schema do Coordinator para OpenAI Structured Outputs (StackSpot & OpenAI-Compatible)

- **Data**: 2026-09-16
- **Autor**: Miguel Arcangelo / Shark Dev
- **Status**: Aprovado

## 1. Contexto e Motivação

O StackSpot AI utiliza o validador e compilador de gramática de Context-Free Grammar (CFG) da OpenAI (`response_format: { type: "json_schema", json_schema: { strict: true, ... } }`).
Com a recente migração do Shark para o envelope uniforme `{ type, args }`, o schema exportado (`COORDINATOR_RESPONSE_JSON_SCHEMA`) passou a ser rejeitado pelo StackSpot pelos seguintes motivos técnicos:
1. `arguments` dentro de `args` foi definido como `type: "object"` genérico sem propriedades, o que é proibido na especificação Strict da OpenAI.
2. `additionalProperties: false` não estava presente no objeto raiz, no objeto `action` e no objeto `args`.
3. O array `required` do objeto `args` estava ausente, violando a regra de que todo objeto com `properties` deve listar todas as suas propriedades em `required`.
4. Os campos opcionais em `TOOL_ARGS_PROPERTIES` não declaravam aceitação explícita de `null` (`type: ["string", "null"]`).
5. O array `required` da raiz continha apenas `["action"]`, omitindo `thought` e `summary`.

O modelo DeepSeek configurado via OpenRouter no `.sharkrc` roda com `useStructuredOutputs: false` (utilizando apenas `response_format: { type: "json_object" }`), portanto não é impactado por esta mudança de schema e continuará funcionando normalmente.

## 2. Objetivos

- Tornar o `COORDINATOR_RESPONSE_JSON_SCHEMA` e o `SUBAGENT_RESPONSE_JSON_SCHEMA` 100% aderentes à especificação do **OpenAI Structured Outputs** (`strict: true`).
- Permitir que o schema gerado por `shark export-schema coordinator` e `shark export-schema subagent` seja aceito diretamente no portal e backend do StackSpot sem erros de validação.
- Manter total retrocompatibilidade no `agent-response-parser.ts` para desempacotar `args`, suportando tanto `arguments` como objeto quanto como string JSON serializada.

## 3. Especificação Técnica das Mudanças

### 3.1. `TOOL_ARGS_PROPERTIES` (`src/core/api/prompts.ts`)

Todos os campos de ferramentas declarados em `TOOL_ARGS_PROPERTIES` devem ser estritamente tipados como anuláveis para que possam pertencer ao array `required` de `args`:

```typescript
export const TOOL_ARGS_PROPERTIES = {
  path: {
    type: ["string", "null"],
    description: "Caminho do arquivo ou diretório."
  },
  content: {
    type: ["string", "null"],
    description: "Conteúdo a ser escrito em create_file ou novo código para modify_file."
  },
  start_anchor: {
    type: ["string", "null"],
    description: "Palavra âncora de início para modify_file."
  },
  end_anchor: {
    type: ["string", "null"],
    description: "Palavra âncora de fim para modify_file."
  },
  command: {
    type: ["string", "null"],
    description: "Comando de terminal a ser executado via run_command."
  },
  query: {
    type: ["string", "null"],
    description: "Termo ou padrão de busca para search_code ou session_search."
  },
  is_regex: {
    type: ["boolean", "null"],
    description: "Indica se query em search_code é regex."
  },
  queries: {
    type: ["array", "null"],
    items: { type: "string" },
    description: "Lista de consultas textuais para tool_search."
  },
  names: {
    type: ["array", "null"],
    items: { type: "string" },
    description: "Lista de nomes de ferramentas para tool_describe."
  },
  name: {
    type: ["string", "null"],
    description: "Nome da ferramenta para tool_call."
  },
  arguments: {
    type: ["string", "null"],
    description: "Argumentos da ferramenta chamada via tool_call formatados em string JSON."
  },
  action: {
    type: ["string", "null"],
    description: "Ação a executar em memory (add, replace, remove, read)."
  },
  target: {
    type: ["string", "null"],
    description: "Alvo da memória (memory ou user)."
  },
  old_str: {
    type: ["string", "null"],
    description: "Trecho exato a ser substituído em 'replace' ou excluído em 'remove' na ação de memory."
  },
  limit: {
    type: ["number", "null"],
    description: "Limite máximo de resultados retornados."
  },
  task_file: {
    type: ["string", "null"],
    description: "Caminho do arquivo com briefing da tarefa para invoke_subagent."
  },
  duration_seconds: {
    type: ["number", "null"],
    description: "Duração em segundos para a ação wait."
  },
  file_path: {
    type: ["string", "null"],
    description: "Caminho relativo do arquivo dentro do pacote da skill em skill_view ou skill_manage."
  },
  old_string: {
    type: ["string", "null"],
    description: "Trecho exato de texto a ser substituído na ação patch de skill_manage."
  },
  new_string: {
    type: ["string", "null"],
    description: "Novo trecho de texto a ser inserido na ação patch de skill_manage."
  },
  scope: {
    type: ["string", "null"],
    description: "Escopo da skill: local (projeto) ou global (~/.shark/skills)."
  }
};
```

### 3.2. Estrutura dos Schemas do Agente e Subagente

```typescript
export const COORDINATOR_RESPONSE_JSON_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentResponse",
  "type": "object",
  "properties": {
    "thought": {
      "type": ["string", "null"],
      "description": "Explicação detalhada do raciocínio lógico e intenção da ação tomada."
    },
    "action": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "create_file",
            "modify_file",
            "read_file",
            "list_files",
            "search_file",
            "search_code",
            "delete_file",
            "run_command",
            "tool_search",
            "tool_describe",
            "tool_call",
            "skills_list",
            "skill_view",
            "skill_manage",
            "talk_with_user",
            "activate_skill",
            "invoke_subagent",
            "complete_task",
            "wait",
            "notify_user",
            "memory",
            "session_search"
          ]
        },
        "args": {
          "type": "object",
          "description": "Objeto com os parâmetros específicos da ferramenta selecionada.",
          "properties": TOOL_ARGS_PROPERTIES,
          "required": Object.keys(TOOL_ARGS_PROPERTIES),
          "additionalProperties": false
        }
      },
      "required": ["type", "args"],
      "additionalProperties": false
    },
    "summary": {
      "type": "string",
      "description": "Resumo de uma única frase muito curta e sucinta do que você realizou nesta rodada. Evite explicações longas."
    }
  },
  "required": ["thought", "action", "summary"],
  "additionalProperties": false
};
```

O mesmo padrão se aplica a `SUBAGENT_RESPONSE_JSON_SCHEMA`, garantindo simetria.

### 3.3. Tolerância no Parser (`src/core/agents/agent-response-parser.ts`)

O parser já recebe `val.args`. Garantir que se `args.arguments` vier como string JSON ou objeto parseado, ele seja aceito transparentemente pelo Zod sem erros em ambos os formatos.

## 4. Plano de Testes e Validação

1. Atualizar testes unitários em `src/core/api/prompts.test.ts` e `src/commands/export-schema.test.ts`.
2. Executar `npx vitest run` para garantir que toda a suíte de testes passa.
3. Testar a saída de `npx tsx src/bin/shark.ts export-schema coordinator` e validar sintaticamente que satisfaz todas as regras do OpenAI Structured Outputs.
