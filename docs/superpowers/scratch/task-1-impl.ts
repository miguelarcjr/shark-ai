// Reference implementation for Task 1: Response Parser Robustness and complete_task Schema Support

// 1. Modificar src/core/agents/agent-response-parser.ts:

// No AgentActionSchema (linha ~5):
export const AgentActionSchema = z.object({
    type: z.enum([
        'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
        'list_structure', 'modify_ast', 'search_ast', 'run_command',
        'talk_with_user', 'use_mcp_tool',
        'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
        'complete_task', // <-- Adicionado
        // ... outros tipos de AST ...
    ]),
    // ... outros campos ...
});

// Na função parseAgentResponse (linha ~122):
            const cleanRaw = rawResponse.trim();
            
            if (cleanRaw === '') {
                const systemMsg = `[SYSTEM ERROR]: O modelo retornou uma resposta vazia. Por favor, tente novamente e forneça uma ação JSON válida.`;
                return {
                    action: {
                        type: 'talk_with_user',
                        content: systemMsg,
                        path: ''
                    },
                    actions: [{
                        type: 'talk_with_user',
                        content: systemMsg,
                        path: ''
                    }],
                    message: systemMsg
                };
            }

            const looksLikeJson = cleanRaw.startsWith('{') || cleanRaw.startsWith('[');


// 2. Modificar src/core/api/openai-compatible-provider.ts (linha ~88):
// No enumerador do JSON Schema:
                                  "send_message",
                                  "manage_subagents",
                                  "complete_task", // <-- Adicionado
                                  "wait"


// 3. Modificar src/core/api/prompts.ts (linha ~29):
// No texto explicativo do formato de saída do UNIFIED_SYSTEM_PROMPT:
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool" | "activate_skill" | "define_subagent" | "invoke_subagent" | "send_message" | "manage_subagents" | "complete_task" | "wait",
