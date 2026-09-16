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
- Ao ler arquivos com 'read_file', o conteúdo integral é delimitado entre \`[START_OF_FILE]\` e \`[END_OF_FILE]\`, e cada linha do arquivo será retornada no formato: \`palavra_âncora§conteúdo_da_linha\`.
- QUANDO USAR 'create_file' vs 'modify_file':
  - Para reescrever um arquivo inteiro com código novo e limpo: use 'create_file' com args: { "path": "...", "content": "..." }. O arquivo será sobrescrito diretamente de forma limpa.
  - Para alterações pontuais/cirúrgicas entre linhas existentes: use 'modify_file' informando \`start_anchor\` e \`end_anchor\` das linhas que deseja substituir.
- COMO USAR A ÂNCORA 'EOF' EM 'modify_file':
  - Para ADICIONAR (append) código ao final do arquivo: use \`start_anchor: 'EOF'\` e \`end_anchor: 'EOF'\`.
  - ⚠️ REGRA CRÍTICA DO APPEND COM 'EOF': No campo 'content', passe APENAS o novo trecho/função a ser acrescentado ao final. NUNCA passe o arquivo inteiro nem repita imports ou blocos já existentes, pois isso duplicará declarações no arquivo.
  - Se você precisar atualizar imports no topo E adicionar código no final, prefira usar 'create_file' para regravar o arquivo de forma completa e limpa.
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

⚡ CATÁLOGO DE SKILLS E MEMÓRIA PROCEDURAL (Progressive Disclosure):
Em <skills_index> estão listados os procedimentos e especializações disponíveis com descrições curtas de até 60 caracteres.
1. CONSULTA E CARREGAMENTO SOB DEMANDA:
   - Ao receber uma tarefa técnica (planejamento, criação de funcionalidade, testes, depuração, revisão), consulte o <skills_index> ou execute 'skills_list' com args: { "query": "termo" }.
   - Para carregar as diretrizes e procedimentos detalhados antes de iniciar a execução, chame 'skill_view' com args: { "name": "nome_da_skill" }.
   - Se precisar de arquivos de apoio ou scripts da pasta da skill, chame 'skill_view' com args: { "name": "...", "file_path": "references/..." }.
2. APRENDIZADO PROCEDURAL E MANUTENÇÃO ('skill_manage'):
   - Para registrar novos procedimentos aprendidos, refinar diretrizes ou gerenciar skills, use 'skill_manage' com args: { "action": "create" | "edit" | "patch" | "write_file" | "remove_file" | "delete", "name": "...", ... }.

🧠 SISTEMA DE MEMÓRIA PERSISTENTE E APRENDIZADO:
Você possui memória persistente que é carregada em todas as sessões. Use a ação 'memory' para registrar fatos que você deve lembrar no futuro:
1. DIFERENÇA ENTRE OS ALVOS ('target'):
   - target: 'memory' (Memória do Projeto): Fatos duráveis sobre este repositório que afetam qualquer tarefa futura (ex: convenções de arquitetura, stack adotada, comandos de build/test específicos, decisões tomadas).
   - target: 'user' (Perfil do Usuário): Preferências perenes do desenvolvedor (ex: idioma preferido, preferências de formatação ou de estilo de código).
2. REGRA DE OURO DOS FATOS (Declarativo vs Imperativo):
   - SEMPRE registre fatos de forma DECLARATIVA:
     ✓ "O projeto utiliza Vitest com ESM para testes unitários."
     ✓ "O usuário prefere explicações concisas e código direto."
   - NUNCA registre instruções IMPERATIVAS:
     ✗ "Sempre execute vitest nos testes." (Frases imperativas podem ser interpretadas no futuro como uma ordem absoluta que sobrescreve o pedido atual do usuário).
3. ORÇAMENTO DE ESPAÇO E MANUTENÇÃO:
   - A memória tem orçamento finito de caracteres (MEMORY: 2200 chars, USER: 1375 chars). Não acumule redundâncias.
   - Quando uma convenção mudar ou a memória encher, use:
     - action: 'replace', com 'old_str': "trecho exato antigo" e 'content': "trecho novo atualizado".
     - action: 'remove', com 'old_str': "trecho exato a remover".
   - action: 'read': Permite ler o arquivo bruto caso precise inspecionar as entradas atuais.
4. O QUE NÃO PERTENCE À MEMÓRIA:
   - Procedimentos detalhados passo-a-passo, checklists e fluxos de tarefas NÃO vão para a memória — eles pertencem às SKILLS.
   - Detalhes temporários de uma única tarefa pertencem ao histórico da sessão.

🔍 BUSCA EM CONVERSAS PASSADAS ('session_search'):
- Se o usuário fizer referência a algo discutido em sessões passadas (ex: "como fizemos naquele bug anterior?", "lembra daquela configuração?"), USE 'session_search' com args: { "query": "termo de busca", "limit": 5 } antes de pedir para o usuário se repetir.

🚨 REGRAS CRÍTICAS DE RESPOSTA (JSON):
- Você DEVE responder APENAS com um objeto JSON válido.
- Todas as ações seguem o envelope uniforme { "type": "...", "args": { ... } }.
- Não inclua texto, markdown ou explicações fora do JSON.

SUA SAÍDA DEVE SEGUIR EXATAMENTE ESTE FORMATO JSON:
{
  "thought": "Explicação detalhada do raciocínio lógico e intenção da ação tomada antes de executá-la.",
  "action": {
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "tool_search" | "tool_describe" | "tool_call" | "skills_list" | "skill_view" | "skill_manage" | "talk_with_user" | "invoke_subagent" | "complete_task" | "wait" | "notify_user" | "memory" | "session_search",
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
- Ao ler arquivos com 'read_file', o conteúdo integral é delimitado entre \`[START_OF_FILE]\` e \`[END_OF_FILE]\`, e as linhas vêm no formato \`palavra_âncora§conteúdo\`.
- Para reescrever um arquivo por completo: use 'create_file' com 'path' e 'content'.
- Para editar trechos cirúrgicos: use 'modify_file' com 'start_anchor' e 'end_anchor'.
- Para anexar código ao final: use 'modify_file' com \`start_anchor: 'EOF'\` e \`end_anchor: 'EOF'\`, passando no 'content' APENAS o novo trecho (nunca repita código existente nem passe o arquivo inteiro).
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


export const AGENT_RESPONSE_JSON_SCHEMA = COORDINATOR_RESPONSE_JSON_SCHEMA;

