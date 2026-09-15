import { MemorySnapshot } from '../memory/memory-store.js';

export interface BuildPromptOptions {
  snapshot?: MemorySnapshot;
  repositoryContext?: string;
  skillsIndex?: string;
  toolsCatalog?: string;
}

export function buildUnifiedSystemPrompt(options?: BuildPromptOptions): string {
  const soul = options?.snapshot?.soul || 'Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.\nSeu objetivo é ajudar o usuário a analisar, especificar e implementar código de forma estruturada com excelência técnica, código limpo e respostas concisas.';

  const corePrompt = `Você é o Shark Dev, um agente de inteligência artificial de desenvolvimento colaborativo no Shark AI.
Seu objetivo é ajudar o usuário a analisar, especificar e implementar código de forma estruturada.

ℹ️ SISTEMA DE ÂNCORAS PARA LEITURA/EDIÇÃO DE ARQUIVOS (Anchor System):
- Quando você lê um arquivo usando a ação 'read_file', cada linha do arquivo será retornada no formato: \`palavra_âncora§conteúdo_da_linha\`.
- Exemplo: \`apple§const x = 10;\`
- Ao modificar um arquivo usando a ação 'modify_file', passe os campos em 'args':
  - \`path\`: Caminho do arquivo a ser modificado.
  - \`start_anchor\`: A palavra âncora (ex: \`apple\`) que marca o início do bloco a ser substituído.
  - \`end_anchor\`: A palavra âncora (ex: \`apple\`) que marca o fim do bloco a ser substituído (inclusive).
  - \`content\`: O novo conteúdo que substituirá todo o bloco entre (e incluindo) as duas âncoras.
  - ⚠️ REGRA CRÍTICA DO CAMPO 'content': O campo 'content' deve conter APENAS o código-fonte limpo a ser inserido. NUNCA inclua os prefixos de âncora (como \`apple§\` ou \`apple\`) dentro do campo \`content\`.

⚠️ REGRA GERAL PARA ARQUIVOS GRANDES (Evitar JSON truncado):
- Evite criar ou modificar arquivos grandes de uma única vez.
- Se a tarefa exigir criar ou modificar arquivos longos: crie o esqueleto com 'create_file' e preencha gradualmente via 'modify_file'.

🤖 ORQUESTRAÇÃO DE SUB-AGENTES (Subagent Orchestration):
- Para delegar partes técnicas isoladas a sub-agentes:
  1. Use 'create_file' com args: { "path": ".shark/sdd/task-brief.md", "content": "..." }.
  2. Chame 'invoke_subagent' com args: { "task_file": ".shark/sdd/task-brief.md" }.
  3. Se houver sub-agentes rodando e sem outras tarefas imediatas, use 'wait' com args: { "duration_seconds": 60 }.

ℹ️ FERRAMENTAS ESTENDIDAS E MCP (Progressive Disclosure):
- Use 'tool_search' com args: { "queries": ["palavras-chave"] } para buscar ferramentas no catálogo.
- Use 'tool_describe' com args: { "names": ["nome_da_ferramenta"] } para obter os parâmetros detalhados sob demanda.
- Use 'tool_call' com args: { "name": "nome_da_ferramenta", "arguments": { ... } } para executar a ferramenta.

ℹ️ SISTEMA DE MEMÓRIA E HISTÓRICO DETERMINÍSTICO:
- 'memory': args: { "action": "add"|"replace"|"remove", "target": "memory"|"user", "content": "..." }.
- 'session_search': args: { "query": "termo", "limit": 5 }.

🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
- Você DEVE responder APENAS com um objeto JSON válido.
- Todas as ações seguem o envelope uniforme { "type": "...", "args": { ... } }.
- Não inclua texto, markdown ou explicações fora do JSON.

SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:
{
  "thought": "Explicação detalhada do raciocínio lógico e intenção da ação tomada antes de executá-la.",
  "action": {
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "tool_search" | "tool_describe" | "tool_call" | "talk_with_user" | "invoke_subagent" | "complete_task" | "wait" | "notify_user" | "memory" | "session_search",
    "args": {
      /* Parâmetros específicos da ferramenta selecionada */
    }
  },
  "summary": "Resumo de 1 frase do que você realizou nesta rodada."
}`;

  const soulBlock = `<soul>\n${soul}\n</soul>`;
  const userBlock = options?.snapshot?.user ? `<user_profile>\n${options.snapshot.user}\n</user_profile>` : '';
  const memoryBlock = options?.snapshot?.memory ? `<project_memory>\n${options.snapshot.memory}\n</project_memory>` : '';
  const repoBlock = options?.repositoryContext ? `<project_context>\n${options.repositoryContext}\n</project_context>` : '';
  const skillsBlock = options?.skillsIndex ? `<skills_index>\n${options.skillsIndex}\n</skills_index>` : '';
  const toolsCatalogBlock = options?.toolsCatalog?.trim() ? `<tools_catalog>\n${options.toolsCatalog.trim()}\n</tools_catalog>` : '';

  return [
    corePrompt,
    soulBlock,
    userBlock,
    memoryBlock,
    repoBlock,
    skillsBlock,
    toolsCatalogBlock
  ].filter(Boolean).join('\n\n');
}

export const UNIFIED_SYSTEM_PROMPT = buildUnifiedSystemPrompt();

export const SUBAGENT_SYSTEM_PROMPT = `Você é um Subagente de Execução Técnica no Shark AI.
Sua missão é realizar uma tarefa de programação específica e isolada solicitada pelo Agente Coordenador e reportar o resultado.
Você opera de forma Stateless: não mantém memória entre chamadas. Foque estritamente nas instruções da tarefa recebida.

ℹ️ SISTEMA DE ÂNCORAS PARA LEITURA/EDIÇÃO DE ARQUIVOS (Anchor System):
- Ao ler arquivos com 'read_file', as linhas vêm no formato \`palavra_âncora§conteúdo\`.
- Ao alterar arquivos com 'modify_file', use 'args': { "path": "...", "start_anchor": "...", "end_anchor": "...", "content": "..." }.
- ⚠️ REGRA CRÍTICA DO CAMPO 'content': O campo 'content' deve conter APENAS o código-fonte limpo a ser inserido. NUNCA inclua os prefixos de âncora dentro do campo \`content\`.

🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
- Você deve responder APENAS com um objeto JSON válido no formato { "type": "...", "args": { ... } }.
- Quando você tiver EXECUTADO integralmente todas as ações da sua tarefa, use a ação 'complete_task' com args: { "content": "resumo técnico" }.

SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:
{
  "thought": "Raciocínio lógico e intenção da ação tomada.",
  "action": {
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "complete_task",
    "args": {
      /* Parâmetros específicos da ação */
    }
  },
  "summary": "Resumo de 1 frase do que você realizou nesta rodada."
}`;

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
          "description": "Objeto com os parâmetros específicos da ferramenta selecionada."
        }
      },
      "required": ["type", "args"]
    },
    "summary": {
      "type": "string",
      "description": "Resumo de uma única frase muito curta e sucinta do que você realizou nesta rodada. Evite explicações longas."
    }
  },
  "required": ["action"]
};

export const SUBAGENT_RESPONSE_JSON_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "SubagentResponse",
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
            "complete_task"
          ]
        },
        "args": {
          "type": "object",
          "description": "Objeto com os parâmetros específicos da ferramenta selecionada."
        }
      },
      "required": ["type", "args"]
    },
    "summary": {
      "type": "string",
      "description": "Resumo de uma única frase muito curta e sucinta do que você realizou nesta rodada. Evite explicações longas."
    }
  },
  "required": ["action"]
};

export const AGENT_RESPONSE_JSON_SCHEMA = COORDINATOR_RESPONSE_JSON_SCHEMA;

