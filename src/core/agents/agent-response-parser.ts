import { z } from 'zod';
import { FileLogger } from '../debug/file-logger.js';

// Action Schema
export const AgentActionSchema = z.object({
    type: z.enum([
        'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
        'list_structure', 'modify_ast', 'search_ast', 'run_command',
        'talk_with_user', 'use_mcp_tool',
        'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
        'complete_task',
        'wait',
        'notify_user',
        'ast_list_structure',
        'ast_get_method',
        'ast_add_method', 'ast_modify_method', 'ast_remove_method',
        'ast_add_class',
        'ast_get_property', 'ast_add_property', 'ast_modify_property', 'ast_remove_property',
        'ast_add_decorator',
        'ast_add_interface', 'ast_add_type_alias',
        'ast_add_function', 'ast_remove_function',
        'ast_add_import', 'ast_remove_import', 'ast_organize_imports'
    ]),
    path: z.string().nullable().optional(), // Nullable for strict mode combatibility
    content: z.string().nullable().optional(),
    line_range: z.array(z.number()).nullable().optional(),
    target_content: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    tool_name: z.string().nullable().optional(),
    tool_args: z.string().nullable().optional(), // JSON string argument

    // search_code fields
    query: z.string().nullable().optional(),
    is_regex: z.boolean().nullable().optional(),

    // AST-Grep fields
    pattern: z.string().nullable().optional(),
    fix: z.string().nullable().optional(),
    language: z.string().nullable().optional(),
    file_path: z.string().nullable().optional(), // Alias for path in ast-grep actions

    // New AST Tool Specific Fields
    class_name: z.string().nullable().optional(),
    method_name: z.string().nullable().optional(),
    method_code: z.string().nullable().optional(),
    property_name: z.string().nullable().optional(),
    property_code: z.string().nullable().optional(),
    extends_class: z.string().nullable().optional(),
    implements_interfaces: z.array(z.string()).nullable().optional(),
    decorator_code: z.string().nullable().optional(),
    interface_code: z.string().nullable().optional(),
    type_code: z.string().nullable().optional(),
    function_name: z.string().nullable().optional(),
    function_code: z.string().nullable().optional(),
    import_statement: z.string().nullable().optional(),
    module_path: z.string().nullable().optional(),
    new_body: z.string().nullable().optional(),

    // Preview confirmation
    confirmed: z.boolean().nullable().optional(),
    start_anchor: z.string().nullable().optional(),
    end_anchor: z.string().nullable().optional(),

    // Superpowers fields
    skill_name: z.string().nullable().optional(),
    duration_seconds: z.number().nullable().optional(),
    Subagents: z.array(z.object({
        TypeName: z.string(),
        Role: z.string(),
        Prompt: z.string()
    })).nullable().optional(),
    Recipient: z.string().nullable().optional(),
    Message: z.string().nullable().optional(),
    Action: z.enum(['list', 'kill', 'kill_all']).nullable().optional(),
    ConversationIds: z.array(z.string()).nullable().optional(),

    // define_subagent fields
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    system_prompt: z.string().nullable().optional(),
    enable_write_tools: z.boolean().nullable().optional(),
    enable_subagent_tools: z.boolean().nullable().optional(),
    enable_mcp_tools: z.boolean().nullable().optional(),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

// Command Schema (for future use)
export const AgentCommandSchema = z.object({
    command: z.string(),
    description: z.string(),
    critical: z.boolean(),
});

// Full Structured Response Schema
export const AgentResponseSchema = z.object({
    action: AgentActionSchema.nullable().optional(),
    actions: z.array(AgentActionSchema).default([]), // Maintain backward compatibility
    commands: z.array(AgentCommandSchema).optional(), // Maintain backward compatibility
    summary: z.string().optional(),

    // Legacy fields handling for smooth transition/fallback
    message: z.string().optional(),
    conversation_id: z.string().optional(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

/**
 * Parses raw agent response expecting a JSON string that matches our schema.
 */
export function parseAgentResponse(rawResponse: unknown): AgentResponse {
    FileLogger.log('PARSER', 'Parsing Agent Response', { rawType: typeof rawResponse });

    let parsedObj: any = {};
    let conversation_id: string | undefined;

    // 1. Handle string input (accumulated SSE or raw JSON string)
    if (typeof rawResponse === 'string') {
        FileLogger.log('PARSER', 'Type String', { length: rawResponse.length });
        try {
            parsedObj = extractFirstJson(rawResponse);
        } catch (e) {
            FileLogger.log('PARSER', 'String Parse Failed', { error: (e as Error).message });
            const errMsg = (e as Error).message;
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
            
            if (!looksLikeJson) {
                // Fallback: treat as simple message if not valid JSON and not trying to be JSON
                return {
                    action: {
                        type: 'talk_with_user',
                        content: rawResponse,
                        path: ''
                    },
                    actions: [{
                        type: 'talk_with_user',
                        content: rawResponse,
                        path: ''
                    }],
                    message: rawResponse
                };
            }

            const isTruncated = errMsg.includes('Unterminated string') || errMsg.includes('Unexpected end of JSON input');
            const charCount = rawResponse.length;
            const safeLimit = Math.floor(charCount * 0.9);
            const systemMsg = isTruncated
                ? `[SYSTEM ERROR]: Sua resposta anterior foi cortada/truncada antes do final devido ao limite máximo de tokens de saída (output token limit) após atingir ${charCount} caracteres. O JSON ficou incompleto: ${errMsg}. Por favor, envie uma nova resposta com formato JSON completo e válido (não tente apenas completar o JSON anterior). Continue o trabalho lógico da tarefa de forma mais curta ou incremental (ex: criando apenas o esqueleto/estrutura básica ou escrevendo uma parte menor do arquivo de cada vez). Garanta que o tamanho total desta nova resposta JSON seja menor que ${safeLimit} caracteres para evitar novos cortes.`
                : `[SYSTEM ERROR]: Falha ao parsear o JSON de resposta: ${errMsg}.`;
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
    }
    // 2. Handle object input (direct API response)
    else if (typeof rawResponse === 'object' && rawResponse !== null) {
        const anyResp = rawResponse as any;
        conversation_id = anyResp.conversation_id;

        FileLogger.log('PARSER', 'Type Object', {
            hasContent: !!anyResp.content,
            hasMessage: !!anyResp.message,
            messageType: typeof anyResp.message
        });

        // Sometimes content is nested in 'content' or 'message'
        const stringContent = anyResp.content || anyResp.message;
        if (stringContent && typeof stringContent === 'string') {
            try {
                // Try to parse it as JSON actions/action
                const parsedInside = extractFirstJson(stringContent);
                // Only use it if it looks like an object (not just a primitive)
                if (typeof parsedInside === 'object' && parsedInside !== null) {
                    parsedObj = parsedInside;
                    FileLogger.log('PARSER', 'Inner JSON Parsed', { keys: Object.keys(parsedObj) });
                } else {
                    // It was a string literal or number, treat as text
                    parsedObj = rawResponse;
                    FileLogger.log('PARSER', 'Inner JSON was primitive');
                }
            } catch (e) {
                FileLogger.log('PARSER', 'Inner JSON Parse Error', { error: (e as Error).message });
                const errMsg = (e as Error).message;
                const cleanContent = stringContent.trim();
                const looksLikeJson = cleanContent.startsWith('{') || cleanContent.startsWith('[');
                
                if (looksLikeJson) {
                    const isTruncated = errMsg.includes('Unterminated string') || errMsg.includes('Unexpected end of JSON input');
                    const charCount = stringContent.length;
                    const safeLimit = Math.floor(charCount * 0.9);
                    const systemMsg = isTruncated
                        ? `[SYSTEM ERROR]: Sua resposta anterior foi cortada/truncada antes do final devido ao limite máximo de tokens de saída (output token limit) após atingir ${charCount} caracteres. O JSON ficou incompleto: ${errMsg}. Por favor, envie uma nova resposta com formato JSON completo e válido (não tente apenas completar o JSON anterior). Continue o trabalho lógico da tarefa de forma mais curta ou incremental (ex: criando apenas o esqueleto/estrutura básica ou escrevendo uma parte menor do arquivo de cada vez). Garanta que o tamanho total desta nova resposta JSON seja menor que ${safeLimit} caracteres para evitar novos cortes.`
                        : `[SYSTEM ERROR]: Falha ao parsear o JSON de resposta: ${errMsg}.`;
                    parsedObj = {
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
                        summary: 'Parsing failed due to truncated JSON response'
                    };
                } else {
                    parsedObj = rawResponse;
                }
            }
        } else {
            parsedObj = rawResponse;
        }

        // If we didn't successfully parse inner JSON actions/action, use the raw object
        if (!parsedObj.actions && !parsedObj.action) {
            parsedObj = rawResponse;
        }
    }

    // 3. Normalize Actions/Action
    let normalizedAction: any = parsedObj.action;
    let normalizedActions: any[] = parsedObj.actions;

    // Handle root-level action objects directly (fallback for less strict models)
    if (!normalizedAction && (!normalizedActions || normalizedActions.length === 0) && parsedObj && typeof parsedObj === 'object' && typeof parsedObj.type === 'string') {
        const validTypes = [
            'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
            'talk_with_user', 'use_mcp_tool', 'list_structure', 'modify_ast', 'search_ast', 'run_command',
            'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
            'complete_task', 'wait', 'notify_user'
        ];
        if (validTypes.includes(parsedObj.type)) {
            normalizedAction = parsedObj;
            normalizedActions = [parsedObj];
        }
    }

    if (!normalizedAction && normalizedActions && normalizedActions.length > 0) {
        normalizedAction = normalizedActions[0];
    } else if (normalizedAction && (!normalizedActions || normalizedActions.length === 0)) {
        normalizedActions = [normalizedAction];
    }

    if (!normalizedAction && !normalizedActions) {
        FileLogger.log('PARSER', 'No Action/Actions Found - Constructing Default');
        const content = parsedObj.message || (typeof parsedObj === 'object' ? JSON.stringify(parsedObj) : String(parsedObj));
        normalizedAction = {
            type: 'talk_with_user',
            content,
            path: ''
        };
        normalizedActions = [normalizedAction];
    }

    // 4. Validate against Schema
    // We construct the final object to match our schema structure
    let normalizedCommands: any[] = [];
    if (Array.isArray(parsedObj.commands)) {
        normalizedCommands = parsedObj.commands.map((cmd: any) => {
            if (typeof cmd === 'string') {
                return {
                    command: cmd,
                    description: `Execute ${cmd}`,
                    critical: false
                };
            }
            if (cmd && typeof cmd === 'object') {
                return {
                    command: cmd.command || '',
                    description: cmd.description || `Execute ${cmd.command || ''}`,
                    critical: cmd.critical === true
                };
            }
            return null;
        }).filter(Boolean);
    }

    const result = {
        action: normalizedAction,
        actions: normalizedActions,
        commands: normalizedCommands,
        summary: parsedObj.summary || '',
        conversation_id,
        message: parsedObj.summary || 'Agent Action' // Backward compatibility
    };

    FileLogger.log('PARSER', 'Final Result Constructed', { hasAction: !!result.action });

    try {
        return AgentResponseSchema.parse(result);
    } catch (e) {
        FileLogger.log('PARSER', 'Schema Validation Failed', { error: (e as Error).message });
        throw e;
    }
}

export function extractFirstJson(str: string): any {
    try {
        return JSON.parse(str);
    } catch (e) {
        // If simple parse fails, try to find the first balanced object
        const firstOpen = str.indexOf('{');
        if (firstOpen === -1) throw e;

        let balance = 0;
        let inString = false;
        let escape = false;

        for (let i = firstOpen; i < str.length; i++) {
            const char = str[i];

            if (escape) {
                escape = false;
                continue;
            }

            if (char === '\\') {
                escape = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') balance++;
                else if (char === '}') {
                    balance--;
                    if (balance === 0) {
                        // Found the end of the first object
                        const potentialJson = str.substring(firstOpen, i + 1);
                        try {
                            return JSON.parse(potentialJson);
                        } catch (innerE) {
                            // If this chunk failed, maybe our brace counting was off (e.g. comments?), throw original
                            throw e;
                        }
                    }
                }
            }
        }
        throw e;
    }
}
