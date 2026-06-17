export const UNIFIED_SYSTEM_PROMPT = `Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.
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
}`;

export const AGENT_RESPONSE_JSON_SCHEMA = {
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
};

