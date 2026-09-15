# Especificação de Design: Revelação Progressiva de Ferramentas e Otimização de Schema

**Data:** 2026-09-15  
**Status:** Aprovado  
**Contexto:** Otimização do consumo de contexto e tokens no Shark AI para provedores sem *Native Function Calling* (StackSpot AI e modelos OpenRouter), integrando o padrão de Revelação Progressiva (*Progressive Disclosure*), Degradação em Camadas (*Tiered Disclosure*) e Busca Léxica (BM25).

---

## 1. Contexto e Problema

Atualmente, o Shark AI define suas ações através de um schema JSON único e "flat" (`COORDINATOR_RESPONSE_JSON_SCHEMA`). Como a StackSpot e diversos modelos open-source no OpenRouter não suportam *Native Function Calling*, o schema completo precisa ser transmitido como JSON Schema estrito ou injetado no System Prompt em todo único turno.

### Sintomas do Modelo Atual:
1. **Context Bloat:** Dezenas de parâmetros opcionais declarados como `["string", "null"]` na raiz do schema coexistem a cada turno (`start_anchor`, `end_anchor`, `command`, `query`, `tool_name`, `tool_args`, `duration_seconds`, etc.).
2. **Poluição do Payload de Resposta:** O modelo gera chaves com valores nulos para ferramentas que não foram chamadas.
3. **Erros Crípticos de Validação:** Quando a LLM erra um parâmetro, mensagens puramente sintáticas de Zod não ensinam o modelo a se auto-corrigir (ex: o modelo alucina quando não sabe o que é `start_anchor`).
4. **Falta de Escalabilidade para MCPs:** Adicionar novos servidores MCP infla o prompt com dezenas de tabelas de parâmetros antes mesmo de saber se serão utilizados.

---

## 2. Decisões de Design

### 2.1. Envelope Uniforme de Ação (`{ type, args }`)
Todas as ações do Shark AI (tanto Core quanto Estendidas) passam a adotar uma assinatura única, estável e minimalista na raiz:

```json
{
  "thought": "string | null",
  "action": {
    "type": "nome_da_ferramenta",
    "args": {
      /* parâmetros específicos da ferramenta */
    }
  },
  "summary": "string"
}
```

#### Raiz do Schema Global:
```json
{
  "type": "object",
  "properties": {
    "thought": {
      "type": ["string", "null"],
      "description": "Raciocínio e intenção da ação."
    },
    "action": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "read_file",
            "modify_file",
            "create_file",
            "delete_file",
            "list_files",
            "search_file",
            "search_code",
            "run_command",
            "tool_search",
            "tool_describe",
            "tool_call",
            "talk_with_user",
            "invoke_subagent",
            "complete_task"
          ]
        },
        "args": {
          "type": "object",
          "description": "Objeto com os parâmetros da ferramenta selecionada."
        }
      },
      "required": ["type", "args"],
      "additionalProperties": false
    },
    "summary": {
      "type": "string",
      "description": "Resumo de 1 frase sucinta do que foi realizado."
    }
  },
  "required": ["action"]
}
```

---

### 2.2. Tríade de Revelação Progressiva (Bridge Tools para MCPs)
Para ferramentas externas e servidores MCP, o schema detalhado de parâmetros é retirado do System Prompt inicial e operado através de 3 ferramentas de ponte:

1. **`tool_search` (com suporte a Lote)**:
   - **Objetivo:** Localizar ferramentas no catálogo por intenção/palavras-chave em linguagem natural.
   - **Args:** `{ "queries": ["query 1", "query 2"], "limit": 5 }`
   - **Retorno:** Lista de ferramentas encontradas com nomes e descrições curtas. Se nada for encontrado, retorna `available_sources` (lista de servidores MCP ativos) para diagnóstico do modelo.

2. **`tool_describe` (com suporte a Lote)**:
   - **Objetivo:** Injetar o schema detalhado de parâmetros apenas das ferramentas que o agente pretende executar, suportando múltiplas ferramentas num único turno.
   - **Args:** `{ "names": ["mcp_github_create_issue", "mcp_slack_post_message"] }`
   - **Retorno:** Schemas JSON dos parâmetros aceitos para cada uma das ferramentas listadas.

3. **`tool_call` ("Desembrulho da Ponte" / Unwrapping):**
   - **Objetivo:** Executar a ferramenta diferida com os parâmetros validados.
   - **Args:** `{ "name": "mcp_nome_da_ferramenta", "arguments": { ... } }`
   - **Comportamento do Runtime:** O Shark AI desembrulha o payload e despacha para a ferramenta real aplicando:
     - **Ganchos de Segurança e Aprovação:** Confirmação do usuário para ações de escrita/destrutivas antes do disparo ao MCP.
     - **Auditoria e Logs:** Registro no `shark-debug.log` especificando `[tool_call -> mcp_nome_da_ferramenta]`.

---

### 2.3. Degradação em Camadas do Catálogo (*Tiered Disclosure*)
O Shark AI reserva um orçamento estrito de tokens para o manifesto no System Prompt (`listing_max_tokens`, correspondendo a no máximo 5% da janela de contexto ou teto de 4.000 tokens):

1. **Tier 1 (Padrão - Truncamento a 60 caracteres):**
   - Exibe no manifesto o nome e a primeira frase da descrição (truncada em até 60 caracteres) de cada ferramenta secundária.
2. **Fallback "Apenas Nomes" (*Names-Only*):**
   - Se o índice ultrapassar o orçamento, remove completamente as descrições e exibe apenas os nomes das ferramentas.
3. **Degradação Isolada por Servidor:**
   - Se a inflação for causada por um servidor específico (ex: um servidor com centenas de rotas), apenas esse servidor é reduzido a uma linha de resumo, preservando as descrições dos demais servidores menores.
4. **Tier 2 (Resumo do Servidor - Catálogos Massivos):**
   - Se mesmo os nomes estourarem o teto de tokens, oculta as ferramentas individuais e exibe apenas o resumo por servidor (ex: `cloudflare: 3,300 tools`).
5. **Transição para Busca Obrigatória:**
   - No Tier 2, como os nomes individuais não constam no prompt, o modelo é obrigado a usar `tool_search` antes de `tool_describe`.

---

### 2.4. Mecânica do Motor de Busca do `tool_search`

O motor de busca de ferramentas secundárias é determinístico e local:

1. **Algoritmo de Pontuação (BM25):** Pondera a frequência dos termos da busca em relação à raridade das palavras no catálogo.
2. **Campos Indexados:**
   - Nome da ferramenta (`name`)
   - Nome do servidor MCP / fonte (`source`)
   - Descrição funcional (`description`)
   - Nomes dos parâmetros de entrada (`parameters`)
3. **Normalização e Stemming:** Aplica radicalização de termos (Snowball para inglês) para que buscas plurais/verbais encontrem termos canônicos (ex: *"issues"* -> *"issue"*).
4. **Fallback Literal por Substring:** Se a pontuação BM25 for zero (ex: acrônimos ou termos curtos), realiza correspondência literal por substring no nome da ferramenta.
5. **Diagnóstico de Ausência (`available_sources`):** Caso nenhum resultado seja encontrado, a resposta inclui a lista de fontes/servidores conectados, permitindo que a LLM saiba se errou os termos de busca ou se o serviço não está instalado.
6. **Stateless:** O catálogo léxico é reconstruído sob demanda a partir do registro ativo de MCPs da sessão.

---

### 2.5. Sistema de Erros Auto-Instrucionais (Self-Teaching Errors)
Erros de validação Zod e falhas semânticas não devem encerrar a sessão nem emitir logs genéricos. Eles devem retornar prompts instrucionais de recuperação:

* **Exemplo para `modify_file` sem âncoras:**
  ```text
  [Action modify_file Failed]: Parâmetros inválidos em 'args'.
  Campos obrigatórios: { "path": string, "start_anchor": string, "end_anchor": string, "content": string }
  
  💡 INSTRUÇÃO DE RECUPERAÇÃO:
  - Se você ainda não inspecionou este arquivo, execute 'read_file' primeiro.
  - O 'read_file' retorna linhas no formato 'palavra_ancora§conteúdo'.
  - Preencha 'start_anchor' e 'end_anchor' com as palavras-âncora exatas e envie apenas o código de substituição limpo em 'content'.
  ```

* **Exemplo para `tool_call` com argumentos inválidos:**
  ```text
  [Action tool_call Failed]: Argumentos inválidos para 'mcp_ferramenta'.
  Campo obrigatório 'title' ausente.
  Schema esperado: { "title": "string", "body": "string" }
  
  💡 INSTRUÇÃO DE RECUPERAÇÃO:
  Reenvie 'tool_call' incluindo todos os campos obrigatórios em 'args.arguments'.
  ```

* **Erro de Truncamento/Sintaxe (`[SYSTEM ERROR]`):**
  Mensagem sintética alimentada de volta ao loop do agente solicitando que reenvie apenas o JSON válido.

---

### 2.6. Poda Conservadora de Schemas e Segregação de Papéis

1. **Poda de MCPs:**
   - Se **nenhum** servidor MCP estiver configurado/conectado na sessão, as ações `tool_search`, `tool_describe` e `tool_call` são removidas do enum de `type` e a seção de catálogo é omitida do System Prompt.
2. **Subagentes:**
   - Mantidos de forma estável no Coordenador (`invoke_subagent`, `complete_task`). Sem desativação dinâmica para evitar inconsistências.
3. **Segregação Coordenador vs Subagente:**
   - **`COORDINATOR_SCHEMA`:** Contém orquestração (`talk_with_user`, `invoke_subagent`, `complete_task`), ferramentas de arquivo/terminal e bridge tools.
   - **`SUBAGENT_SCHEMA`:** Estritamente técnico. Não contém `talk_with_user` nem `invoke_subagent`. Apenas ferramentas de execução técnica (`read_file`, `modify_file`, `create_file`, `delete_file`, `list_files`, `search_code`, `run_command`, `complete_task`).

---

## 3. Arquitetura de Componentes Afetados

1. **`src/core/api/prompts.ts`:**
   - Atualização do `COORDINATOR_RESPONSE_JSON_SCHEMA` e `SUBAGENT_RESPONSE_JSON_SCHEMA` para o contrato `{ type, args }`.
   - Adição do bloco de instruções de Progressive Disclosure e do catálogo dinâmico de MCPs com suporte a *Tiered Disclosure*.
2. **`src/core/agents/agent-response-parser.ts`:**
   - Atualização do `AgentActionSchema` do Zod para aceitar `{ type, args }`.
   - Despacho de validação específica por ferramenta com tratamento de mensagens auto-instrucionais em caso de erro.
3. **`src/core/tools/bridge/`:**
   - Módulo de busca léxica e BM25 (`tool-catalog-search.ts`).
   - Handlers para `tool_search`, `tool_describe` e `tool_call`.
   - Integração com ganchos de segurança e confirmação antes do despacho para ferramentas MCP reais.
4. **`src/core/api/openai-compatible-provider.ts`:**
   - Aplicação da higienização do schema no payload da requisição antes do envio à API.

---

## 4. Plano de Verificação

### Testes Automatizados (Vitest)
1. **Validação de Schema:** Testar parsing com JSONs válidos de cada ferramenta sob o formato `{ type, args }`.
2. **Testes de Auto-Recuperação (Self-Teaching Errors):** Simular respostas com campos ausentes em `modify_file`, `read_file` e `tool_call` e verificar se a mensagem instrucional correta é gerada.
3. **Mecanismo de Busca BM25:** Testar busca por termos, suporte a batching (`queries`), stemming (plural/singular) e fallback literal.
4. **Degradação em Camadas (Tiered Disclosure):** Testar geração de manifesto sob diferentes tamanhos de catálogo (Tier 1 normal, fallback Names-Only e Tier 2 resumo por servidor).
5. **Higienização de Schema:** Testar com e sem MCPs configurados, verificando se o schema gerado reflete a presença ou ausência da ponte.
