import { z } from 'zod';
import { FileLogger } from '../debug/file-logger.js';

// Action Schema
export const AgentActionSchema = z.object({
    type: z.enum([
        'create_file', 'modify_file', 'modify_ast', 'search_ast', 'delete_file',
        'talk_with_user', 'list_files', 'read_file', 'search_file', 'run_command', 'use_mcp_tool',
        // New AST Tools
        'ast_list_structure', 'ast_add_method', 'ast_modify_method', 'ast_remove_method',
        'ast_add_class', 'ast_add_property', 'ast_remove_property', 'ast_add_decorator',
        'ast_add_interface', 'ast_add_type_alias', 'ast_add_function', 'ast_remove_function',
        'ast_add_import', 'ast_remove_import', 'ast_organize_imports'
    ]),
    path: z.string().nullable().optional(), // Nullable for strict mode combatibility
    content: z.string().nullable().optional(),
    line_range: z.array(z.number()).nullable().optional(),
    target_content: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    tool_name: z.string().nullable().optional(),
    tool_args: z.string().nullable().optional(), // JSON string argument

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
    actions: z.array(AgentActionSchema),
    commands: z.array(AgentCommandSchema).optional(),
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
            // Fallback: treat as simple message if not valid JSON
            return {
                actions: [{
                    type: 'talk_with_user',
                    content: rawResponse,
                    path: ''
                }],
                message: rawResponse
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
                // Try to parse it as JSON actions
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
                // Not JSON, continue with rawResponse
                parsedObj = rawResponse;
                FileLogger.log('PARSER', 'Inner JSON Parse Error - treating as raw', { error: (e as Error).message });
            }
        } else {
            parsedObj = rawResponse;
        }

        // If we didn't successfully parse inner JSON actions, use the raw object
        if (!parsedObj.actions) {
            parsedObj = rawResponse;
        }
    }

    // 3. Normalize Actions
    // Ensure 'actions' array exists
    if (!parsedObj.actions) {
        FileLogger.log('PARSER', 'No Actions Found - Constructing Default');
        // If it looks like the legacy format or direct message
        return {
            conversation_id,
            actions: [{
                type: 'talk_with_user',
                content: parsedObj.message || JSON.stringify(parsedObj),
                path: ''
            }],
            message: parsedObj.message
        };
    }

    // 4. Validate against Schema
    // We construct the final object to match our schema structure
    const result = {
        actions: parsedObj.actions,
        commands: parsedObj.commands || [],
        summary: parsedObj.summary || '',
        conversation_id,
        message: parsedObj.summary || 'Agent Action' // Backward compatibility
    };


    FileLogger.log('PARSER', 'Final Result Constructed', { actionCount: result.actions.length });

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
