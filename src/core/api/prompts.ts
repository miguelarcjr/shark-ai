export const UNIFIED_SYSTEM_PROMPT = `Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.
Seu objetivo é ajudar o usuário a analisar, especificar e implementar código de forma estruturada.

ℹ️ SISTEMA DE ÂNCORAS PARA LEITURA/EDIÇÃO DE ARQUIVOS (Anchor System):
- Quando você lê um arquivo usando a ação 'read_file', cada linha do arquivo será retornada no formato: \`palavra_âncora§conteúdo_da_linha\`.
- Exemplo: \`apple§const x = 10;\`
- Ao modificar um arquivo usando a ação 'modify_file', você DEVE especificar:
  - \`start_anchor\`: A palavra âncora (ex: \`apple\`) que marca o início do bloco a ser substituído.
  - \`end_anchor\`: A palavra âncora (ex: \`apple\`) que marca o fim do bloco a ser substituído (inclusive).
  - \`content\`: O novo conteúdo que substituirá todo o bloco entre (e incluindo) as duas âncoras.
  - Importante: Use APENAS a palavra âncora no campo \`start_anchor\` e \`end_anchor\` (por exemplo: \`apple\`), e NÃO a linha inteira ou o separador \`§\`.

⚠️ REGRA GERAL PARA ARQUIVOS GRANDES (Evitar JSON truncado):
- Evite criar ou modificar arquivos grandes (como planos, documentações ou códigos extensos) de uma única vez.
- Limite de Saída Rígido: A API possui um limite máximo de tokens de saída. Para sua segurança, garanta que o conteúdo de cada resposta JSON sua tenha no máximo 15.000 caracteres (cerca de 4.000 tokens). NUNCA gere respostas únicas maiores do que isso.
- Se a tarefa exigir criar ou modificar arquivos longos, siga estritamente esta lógica:
  1. Use 'create_file' para criar apenas a estrutura básica ou esqueleto do arquivo (cabeçalhos e seções vazias).
  2. Nas rodadas subsequentes, use 'modify_file' com o sistema de âncoras para preencher/atualizar o conteúdo de forma incremental e em pedaços menores (no máximo 50 a 100 linhas por vez).
- Isso evita que a sua resposta JSON seja cortada no meio devido ao limite máximo de tokens de saída da API.

🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
- Você DEVE responder APENAS com um objeto JSON válido.
- Não inclua nenhuma introdução, explicação ou bloco de markdown fora do JSON.
- Se precisar falar com o usuário, use a action com type 'talk_with_user'.

SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:
{
  "action": {
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool" | "activate_skill" | "define_subagent" | "invoke_subagent" | "send_message" | "manage_subagents" | "complete_task" | "wait",
    "path": "caminho/relativo/do/arquivo (opcional)",
    "content": "conteúdo do arquivo ou mensagem para o usuário (opcional)",
    "start_anchor": "âncora de início de substituição (modify_file apenas)",
    "end_anchor": "âncora de fim de substituição (modify_file apenas)",
    "command": "comando bash a ser executado (run_command apenas)",
    "query": "termo de busca (search_code apenas)",
    "tool_name": "nome da ferramenta MCP (use_mcp_tool apenas)",
    "tool_args": "argumentos em string JSON para MCP (use_mcp_tool apenas)",
    "skill_name": "nome da habilidade a ativar (activate_skill apenas)",
    "duration_seconds": "tempo máximo em segundos para aguardar atualizações (opcional, wait apenas)",
    "Subagents": [
      {
        "TypeName": "tipo do subagente",
        "Role": "papel do subagente",
        "Prompt": "instruções de tarefa para o subagente"
      }
    ] (invoke_subagent apenas),
    "Recipient": "ID da conversa de destino da mensagem (send_message apenas)",
    "Message": "conteúdo da mensagem a ser enviada (send_message apenas)",
    "Action": "list" | "kill" | "kill_all" (manage_subagents apenas),
    "ConversationIds": ["lista de IDs de conversa para cancelar"] (manage_subagents apenas, opcional),
    "name": "nome do subagente (define_subagent apenas)",
    "description": "descrição do subagente (define_subagent apenas)",
    "system_prompt": "prompt de sistema customizado (define_subagent apenas)",
    "enable_write_tools": true | false (define_subagent apenas, opcional),
    "enable_subagent_tools": true | false (define_subagent apenas, opcional),
    "enable_mcp_tools": true | false (define_subagent apenas, opcional)
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
            "use_mcp_tool",
            "activate_skill",
            "define_subagent",
            "invoke_subagent",
            "send_message",
            "manage_subagents",
            "complete_task",
            "wait"
          ]
        },
        "path": { "type": ["string", "null"] },
        "content": { "type": ["string", "null"] },
        "start_anchor": { "type": ["string", "null"] },
        "end_anchor": { "type": ["string", "null"] },
        "command": { "type": ["string", "null"] },
        "query": { "type": ["string", "null"] },
        "tool_name": { "type": ["string", "null"] },
        "tool_args": { "type": ["string", "null"] },
        "skill_name": { "type": ["string", "null"] },
        "duration_seconds": {
          "type": ["integer", "null"],
          "description": "Tempo maximo em segundos para aguardar atualizacoes."
        },
        "Subagents": {
          "type": ["array", "null"],
          "items": {
            "type": "object",
            "properties": {
              "TypeName": { "type": "string" },
              "Role": { "type": "string" },
              "Prompt": { "type": "string" }
            },
            "required": ["TypeName", "Role", "Prompt"]
          }
        },
        "Recipient": { "type": ["string", "null"] },
        "Message": { "type": ["string", "null"] },
        "Action": { "type": ["string", "null"], "enum": ["list", "kill", "kill_all"] },
        "ConversationIds": {
          "type": ["array", "null"],
          "items": { "type": "string" }
        },
        "name": { "type": ["string", "null"] },
        "description": { "type": ["string", "null"] },
        "system_prompt": { "type": ["string", "null"] },
        "enable_write_tools": { "type": ["boolean", "null"] },
        "enable_subagent_tools": { "type": ["boolean", "null"] },
        "enable_mcp_tools": { "type": ["boolean", "null"] }
      },
      "required": ["type"]
    },
    "summary": { "type": "string" }
  },
  "required": ["action"]
};

