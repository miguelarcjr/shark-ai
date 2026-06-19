import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';
import { UNIFIED_SYSTEM_PROMPT } from './prompts.js';
import crypto from 'node:crypto';
import { FileLogger } from '../debug/file-logger.js';

interface OpenAIConfig {
    baseURL: string;
    apiKey: string;
    model: string;
    useStructuredOutputs: boolean;
}

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private options: OpenAIConfig) {}

    private getAgentSystemPrompt(agentType: string): string {
        return UNIFIED_SYSTEM_PROMPT;
    }

    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        const conversationId = options.conversationId || crypto.randomUUID();

        const history = await HistoryManager.getHistory(conversationId);
        if (history.length === 0) {
            history.push({
                role: 'system',
                content: this.getAgentSystemPrompt(options.agentType)
            });
        }

        history.push({ role: 'user', content: prompt });

        const requestPayload: any = {
            model: this.options.model,
            messages: history,
            stream: true,
            temperature: 0.2
        };

        if (this.options.useStructuredOutputs) {
            requestPayload.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'agent_response',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                          action: {
                            type: 'object',
                            properties: {
                              type: {
                                type: 'string',
                                enum: [
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
                                  "list_structure",
                                  "modify_ast",
                                  "search_ast",
                                  "ast_list_structure",
                                  "ast_get_method",
                                  "ast_add_method",
                                  "ast_modify_method",
                                  "ast_remove_method",
                                  "ast_add_class",
                                  "ast_get_property",
                                  "ast_add_property",
                                  "ast_modify_property",
                                  "ast_remove_property",
                                  "ast_add_decorator",
                                  "ast_add_interface",
                                  "ast_add_type_alias",
                                  "ast_add_function",
                                  "ast_remove_function",
                                  "ast_add_import",
                                  "ast_remove_import",
                                  "ast_organize_imports"
                                ]
                              },
                              path: { type: ['string', 'null'] },
                              content: { type: ['string', 'null'] },
                              start_anchor: { type: ['string', 'null'] },
                              end_anchor: { type: ['string', 'null'] },
                              command: { type: ['string', 'null'] },
                              query: { type: ['string', 'null'] },
                              tool_name: { type: ['string', 'null'] },
                              tool_args: { type: ['string', 'null'] },
                              line_range: {
                                type: ['array', 'null'],
                                items: { type: 'number' }
                              },
                              target_content: { type: ['string', 'null'] },
                              is_regex: { type: ['boolean', 'null'] },
                              pattern: { type: ['string', 'null'] },
                              fix: { type: ['string', 'null'] },
                              language: { type: ['string', 'null'] },
                              file_path: { type: ['string', 'null'] },
                              class_name: { type: ['string', 'null'] },
                              method_name: { type: ['string', 'null'] },
                              method_code: { type: ['string', 'null'] },
                              property_name: { type: ['string', 'null'] },
                              property_code: { type: ['string', 'null'] },
                              extends_class: { type: ['string', 'null'] },
                              implements_interfaces: {
                                type: ['array', 'null'],
                                items: { type: 'string' }
                              },
                              decorator_code: { type: ['string', 'null'] },
                              interface_code: { type: ['string', 'null'] },
                              type_code: { type: ['string', 'null'] },
                              function_name: { type: ['string', 'null'] },
                              function_code: { type: ['string', 'null'] },
                              import_statement: { type: ['string', 'null'] },
                              module_path: { type: ['string', 'null'] },
                              new_body: { type: ['string', 'null'] },
                              confirmed: { type: ['boolean', 'null'] },
                              skill_name: { type: ['string', 'null'] },
                              Subagents: {
                                type: ['array', 'null'],
                                items: {
                                  type: 'object',
                                  properties: {
                                    TypeName: { type: 'string' },
                                    Role: { type: 'string' },
                                    Prompt: { type: 'string' }
                                  },
                                  required: ["TypeName", "Role", "Prompt"],
                                  additionalProperties: false
                                }
                              },
                              Recipient: { type: ['string', 'null'] },
                              Message: { type: ['string', 'null'] },
                              Action: { type: ['string', 'null'] },
                              ConversationIds: {
                                type: ['array', 'null'],
                                items: { type: 'string' }
                              },
                              name: { type: ['string', 'null'] },
                              description: { type: ['string', 'null'] },
                              system_prompt: { type: ['string', 'null'] },
                              enable_write_tools: { type: ['boolean', 'null'] },
                              enable_subagent_tools: { type: ['boolean', 'null'] },
                              enable_mcp_tools: { type: ['boolean', 'null'] }
                            },
                            required: [
                              "type", "path", "content", "start_anchor", "end_anchor", "command", "query", "tool_name", "tool_args",
                              "line_range", "target_content", "is_regex", "pattern", "fix", "language", "file_path",
                              "class_name", "method_name", "method_code", "property_name", "property_code", "extends_class", "implements_interfaces",
                              "decorator_code", "interface_code", "type_code", "function_name", "function_code", "import_statement", "module_path", "new_body",
                              "confirmed", "skill_name", "Subagents", "Recipient", "Message", "Action", "ConversationIds",
                              "name", "description", "system_prompt", "enable_write_tools", "enable_subagent_tools", "enable_mcp_tools"
                            ],
                            additionalProperties: false
                          },
                          summary: { type: 'string' }
                        },
                        required: ["action", "summary"],
                        additionalProperties: false
                    }
                }
            };
        } else {
            requestPayload.response_format = { type: 'json_object' };
        }

        const headers: any = {
            'Content-Type': 'application/json'
        };
        if (this.options.apiKey) {
            headers['Authorization'] = `Bearer ${this.options.apiKey}`;
        }

        const sanitizedHeaders = { ...headers };
        if (sanitizedHeaders['Authorization']) {
            sanitizedHeaders['Authorization'] = 'Bearer ***';
        }
        FileLogger.log('PROVIDER_REQUEST', 'Request payload sent to OpenAI Compatible API', {
            baseURL: this.options.baseURL,
            headers: sanitizedHeaders,
            payload: requestPayload
        });

        const res = await fetch(`${this.options.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestPayload)
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenAI API request failed: ${res.status} ${res.statusText} - ${errBody}`);
        }

        const reader = res.body?.getReader();
        if (!reader) {
            throw new Error('Response body reader is undefined');
        }

        try {
            const decoder = new TextDecoder();
            let fullContent = '';
            let done = false;
            let buffer = '';

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                if (value) {
                    buffer += decoder.decode(value, { stream: !done });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

                    for (const line of lines) {
                        const clean = line.trim();
                        if (!clean || clean === 'data: [DONE]') continue;
                        if (clean.startsWith('data: ')) {
                            let parsed: any;
                            try {
                                parsed = JSON.parse(clean.substring(6));
                            } catch {
                                // ignore JSON parse error
                                continue;
                            }
                            if (parsed && parsed.error) {
                                throw new Error(`OpenAI Stream Error: ${JSON.stringify(parsed.error)}`);
                            }
                            const delta = parsed?.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                fullContent += delta;
                                if (options.onChunk) {
                                    options.onChunk(delta);
                                }
                            }
                        }
                    }
                }
            }

            // Process any remaining data in buffer
            if (buffer) {
                const clean = buffer.trim();
                if (clean && clean !== 'data: [DONE]' && clean.startsWith('data: ')) {
                    let parsed: any;
                    try {
                        parsed = JSON.parse(clean.substring(6));
                    } catch {
                        // ignore JSON parse error
                    }
                    if (parsed && parsed.error) {
                        throw new Error(`OpenAI Stream Error: ${JSON.stringify(parsed.error)}`);
                    }
                    const delta = parsed?.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        fullContent += delta;
                        if (options.onChunk) {
                            options.onChunk(delta);
                        }
                    }
                }
            }

            FileLogger.log('PROVIDER_RESPONSE', 'Raw response from OpenAI Compatible API', { fullContent });
            const parsedResponse = parseAgentResponse(fullContent);
            parsedResponse.conversation_id = conversationId;

            // Save LLM response to history
            history.push({ role: 'assistant', content: JSON.stringify(parsedResponse) });
            await HistoryManager.saveHistory(conversationId, history);

            if (options.onComplete) {
                options.onComplete(parsedResponse);
            }

            return parsedResponse;
        } finally {
            if (typeof reader.releaseLock === 'function') {
                reader.releaseLock();
            }
        }
    }
}
