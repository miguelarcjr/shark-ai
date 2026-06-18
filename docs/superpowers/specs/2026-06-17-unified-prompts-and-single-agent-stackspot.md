# Technical Spec: Unified Prompts, Single Agent Config, and Hash Anchor Edits for Shark AI

## Goal
Standardize LLM prompts and provider interfaces across StackSpot AI and OpenAI-compatible models, simplify configuration via a single universal Agent ID (Joker Agent), transition to a single-action execution loop, and replace complex AST editing tools with a highly token-efficient, robust **Hash Anchor Edit** system powered by the Myers Diff algorithm.

---

## 1. Simplified Configuration
The user will configure a single universal `agentId` (with a default fallback) under the `stackspot` provider configuration.

### Config Schema (`.sharkrc` / `shark.json` / `src/core/config/schema.ts`)
```json
{
  "provider": "stackspot",
  "stackspot": {
    "agentId": "01KEQCGJ65YENRA4QBXVN1YFFX"
  }
}
```

---

## 2. Hybrid Prompt Injection (StackSpot)
To avoid excessive token usage in conversational threads, the system prompt instructions are only sent in the first turn:

- **First Turn** (`conversationId` is empty/undefined):
  The payload prepends the complete system instructions and schema definition to the actual user prompt:
  ```
  SYSTEM INSTRUCTIONS:
  [Base System Prompt]
  
  USER REQUEST:
  [Actual User Prompt]
  ```
- **Subsequent Turns** (`conversationId` is defined):
  Only the user reply/feedback or action execution result is sent. The remote thread history preserves the original instruction context.

---

## 3. The Unified System Prompt & Output JSON Schema
Both StackSpot and OpenAI/OpenRouter providers will use the same system prompt instructions.

### The System Prompt (Portuguese)
```markdown
Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.
Seu objetivo é ajudar o usuário a analisar, especificar e implementar código de forma estruturada.

🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
- Você DEVE responder APENAS com um objeto JSON válido.
- Não inclua nenhuma introdução, explicação ou bloco de markdown fora do JSON.
- Se precisar falar com o usuário, use a action com type 'talk_with_user'.

SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:
{
  "action": {
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool",
    "path": "caminho/relativo/do/arquivo (opcional)",
    "content": "conteúdo do arquivo ou mensagem para o usuário (opcional)",
    "start_anchor": "âncora de início de substituição (modify_file apenas)",
    "end_anchor": "âncora de fim de substituição (modify_file apenas)",
    "command": "comando bash a ser executado (run_command apenas)",
    "query": "termo de busca (search_code apenas)",
    "tool_name": "nome da ferramenta MCP (use_mcp_tool apenas)",
    "tool_args": "argumentos em string JSON para MCP (use_mcp_tool apenas)"
  },
  "summary": "Resumo de 1 frase do que você realizou nesta rodada."
}
```

### Structured Output JSON Schema for StackSpot & OpenAI
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentResponse",
  "type": "object",
  "properties": {
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
            "talk_with_user",
            "use_mcp_tool"
          ]
        },
        "path": { "type": ["string", "null"] },
        "content": { "type": ["string", "null"] },
        "start_anchor": { "type": ["string", "null"] },
        "end_anchor": { "type": ["string", "null"] },
        "command": { "type": ["string", "null"] },
        "query": { "type": ["string", "null"] },
        "tool_name": { "type": ["string", "null"] },
        "tool_args": { "type": ["string", "null"] }
      },
      "required": ["type"]
    },
    "summary": { "type": "string" }
  },
  "required": ["action"]
}
```

---

## 4. Hash Anchor Edits
We replace complex AST tree editing with a single-token word anchor system.

### How Anchors Work
1. We define a pool of 1,000+ short, distinct English nouns and adjectives (each representing a single token in typical LLM encoders).
2. When the LLM calls `read_file`, each line returned is prefixed with an anchor word and the `§` delimiter:
   ```text
   Moderator§def complex_payment_processor(transaction_data):
   Qualifier§    logger.info("Starting processing")
   Ripple§    logger.info("Payment successful")
   Corona§    return {"status": "success"}
   ```
3. To modify a file, the LLM calls `modify_file` specifying `start_anchor` and `end_anchor` (inclusive) of the lines to be replaced, along with the replacement `content`.
4. The `AnchorStateManager` updates the file, then runs the `diff` package (Myers Diff) between the old cached lines and the new file lines:
   - **Unchanged lines** preserve their existing anchor words.
   - **Deleted lines** release their anchors back to the pool.
   - **New/modified lines** are allocated fresh anchor words from the pool.
5. This local stateful anchor map guarantees that editing one part of the file does not alter or shift the anchors of unchanged lines elsewhere in the file.

---

## 5. CLI Reorganization & Deprecations
To streamline the project:

- **New `shark dev` (`src/commands/dev.ts`):** 
  Executes the new flexible `src/core/agents/developer-agent.ts` running the single-action loop. 
  - Standard behavior prompts the user to confirm all write and execute operations (`create_file`, `modify_file`, `delete_file`, `run_command`).
  - Accepts a `--auto` (or `-y`) flag to execute actions autonomously without prompts.
- **`shark legacy` (`src/commands/legacy.ts`):**
  Runs the old spec-based orchestrator and `TaskManager` (which remains in `src/core/agents/legacy-developer-agent.ts`).
- **CLI Cleanups (`src/bin/shark.ts`):**
  Commands `ba`, `spec`, `qa`, and `scan` are removed from CLI registration. Their source agent files are left in the repository for history/reference but deprecated.

---

## 6. Schema Export Command
To make it easy to configure StackSpot portal's structured output, we will add a schema export CLI command:

*   **Command:** `shark export-schema` (or `shark dev --export-schema`)
*   **Behavior:** Prints the exact JSON Schema defined in Section 3 to `stdout`. Users can run `shark export-schema > schema.json` to export it directly to a file for uploading to the StackSpot portal when configuring their Joker/universal agent.
