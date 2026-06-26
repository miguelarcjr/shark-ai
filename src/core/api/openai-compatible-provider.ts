import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';
import { UNIFIED_SYSTEM_PROMPT, AGENT_RESPONSE_JSON_SCHEMA } from './prompts.js';
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
                    schema: toStrictOpenAISchema(AGENT_RESPONSE_JSON_SCHEMA)
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

function toStrictOpenAISchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
        return schema;
    }
    const cloned = JSON.parse(JSON.stringify(schema));

    // OpenAI strict JSON Schema does not allow $schema or title at the root level
    delete cloned.$schema;
    delete cloned.title;

    function processNode(node: any) {
        if (!node || typeof node !== 'object') {
            return;
        }

        if (node.type === 'object') {
            node.additionalProperties = false;

            if (node.properties) {
                const originalRequired = node.required || [];
                const allProperties = Object.keys(node.properties);

                node.required = allProperties;

                for (const key of allProperties) {
                    const prop = node.properties[key];

                    if (!originalRequired.includes(key)) {
                        if (prop.type) {
                            if (Array.isArray(prop.type)) {
                                if (!prop.type.includes('null')) {
                                    prop.type.push('null');
                                }
                            } else if (typeof prop.type === 'string') {
                                if (prop.type !== 'null') {
                                    prop.type = [prop.type, 'null'];
                                }
                            }
                        }
                    }

                    if (prop.enum && Array.isArray(prop.enum)) {
                        if (!prop.enum.includes(null)) {
                            prop.enum.push(null);
                        }
                    }

                    processNode(prop);
                }
            }
        } else if (node.type === 'array' && node.items) {
            processNode(node.items);
        }
    }

    processNode(cloned);
    return cloned;
}

