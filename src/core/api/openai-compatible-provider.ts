import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';
import { UNIFIED_SYSTEM_PROMPT, SUBAGENT_SYSTEM_PROMPT, COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA, AGENT_RESPONSE_JSON_SCHEMA } from './prompts.js';
import crypto from 'node:crypto';
import { FileLogger } from '../debug/file-logger.js';
import { skillManager } from '../workflow/skill-manager.js';
import { encode } from 'gpt-tokenizer';

export function compactToolOutputRetroactively(content: string): string {
    // 1. run_command output
    if (content.startsWith('[Action run_command(')) {
        const lines = content.split('\n');
        if (lines.length > 80) {
            const head = lines.slice(0, 40).join('\n');
            const tail = lines.slice(-40).join('\n');
            return `${head}\n\n... [TRUNCADO PARA ECONOMIZAR CONTEXTO - ${lines.length - 80} LINHAS OCULTAS] ...\n\n${tail}`;
        }
    }
    
    // 2. read_file output
    if (content.startsWith('[Action read_file(')) {
        const parts = content.split('Success]:\n');
        if (parts.length > 1) {
            const prefix = parts[0] + 'Success (Signatures Only)]:\n';
            const fileCode = parts.slice(1).join('Success]:\n');
            
            const lines = fileCode.split('\n');
            let signatureText = '';
            let braceCount = 0;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('import ') || trimmed.startsWith('export {') || trimmed.startsWith('export default')) {
                    signatureText += line + '\n';
                    continue;
                }
                if (
                    trimmed.includes('class ') || 
                    trimmed.includes('interface ') || 
                    trimmed.includes('function ') || 
                    trimmed.includes('constructor') ||
                    (trimmed.includes('public ') && (trimmed.includes('(') || trimmed.includes('=>'))) ||
                    (trimmed.includes('private ') && (trimmed.includes('(') || trimmed.includes('=>'))) ||
                    (trimmed.includes('export ') && (trimmed.includes('class ') || trimmed.includes('interface ') || trimmed.includes('function ')))
                ) {
                    if (braceCount === 0) {
                        signatureText += line + '\n';
                    }
                }
                
                for (const char of line) {
                    if (char === '{') braceCount++;
                    if (char === '}') braceCount--;
                }
            }
            if (signatureText.trim()) {
                return prefix + signatureText;
            }
        }
    }
    
    // 3. create_file / modify_file
    if (content.startsWith('[Action create_file(') || content.startsWith('[Action modify_file(')) {
        const lines = content.split('\n');
        return lines[0];
    }
    
    // 4. list_files / search_file / search_code
    if (content.startsWith('[Action list_files(') || content.startsWith('[Action search_file(') || content.startsWith('[Action search_code(')) {
        const lines = content.split('\n');
        const header = lines[0];
        if (lines.length > 5) {
            return `${header} - Compacted (found ${lines.length - 2} matches/items)`;
        }
    }

    return content;
}

export function cleanResponseObject(val: any): any {
    if (val === null || val === undefined || val === false) {
        return undefined;
    }
    if (Array.isArray(val)) {
        if (val.length === 0) {
            return undefined;
        }
        const cleanedArr = val.map(item => cleanResponseObject(item)).filter(item => item !== undefined);
        return cleanedArr.length > 0 ? cleanedArr : undefined;
    }
    if (typeof val === 'object') {
        const cleanedObj: any = {};
        let hasKeys = false;
        for (const key of Object.keys(val)) {
            const cleanedVal = cleanResponseObject(val[key]);
            if (cleanedVal !== undefined && cleanedVal !== '') {
                cleanedObj[key] = cleanedVal;
                hasKeys = true;
            }
        }
        return hasKeys ? cleanedObj : undefined;
    }
    return val;
}

interface OpenAIConfig {
    baseURL: string;
    apiKey: string;
    model: string;
    useStructuredOutputs: boolean;
}

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private options: OpenAIConfig) {}

    private getAgentSystemPrompt(agentType: string): string {
        const isSubagent = !!process.env.SHARK_SUBAGENT_ROLE;
        return isSubagent ? SUBAGENT_SYSTEM_PROMPT : UNIFIED_SYSTEM_PROMPT;
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

        const requestMessages: ChatMessage[] = [];
        let systemPrompt = this.getAgentSystemPrompt(options.agentType);
        
        // Clone history to avoid mutating the original array
        const historyCopy = history.map(msg => ({ ...msg }));
        
        // Extract and remove the system message from historyCopy to place it strictly at the beginning
        const systemIndex = historyCopy.findIndex(m => m.role === 'system');
        if (systemIndex !== -1) {
            systemPrompt = historyCopy[systemIndex].content;
            historyCopy.splice(systemIndex, 1);
        }
        
        // 1. Message 0: Static system prompt (Stable prefix - 100% cached)
        requestMessages.push({ role: 'system', content: systemPrompt });
        
        // Extract the latest user query (which was just pushed to history)
        const newPromptMsg = historyCopy.pop();
        
        // 2. Messages 1..N-2: Chat history (Fully cached stable prefix)
        requestMessages.push(...historyCopy);
        
        // 3. Message N-1: Dynamic support context (RAG + Skill Extensions)
        const isHelperCall = conversationId.startsWith('membox-');
        if (!isHelperCall) {
            const { MemboxManager } = await import('../workflow/membox-manager.js');
            const memboxManager = new MemboxManager();
            const query = options?.searchQuery || prompt;
            const retrievedContext = await memboxManager.retrieveContext(query, history);
            const skillExtension = skillManager.getSystemInstructionExtension();
            
            if (retrievedContext || skillExtension) {
                let dynamicContent = '--- DADOS E MEMÓRIA DE SUPORTE ---';
                if (retrievedContext) {
                    dynamicContent += '\n' + retrievedContext;
                }
                if (skillExtension) {
                    dynamicContent += '\n' + skillExtension;
                }
                requestMessages.push({ role: 'system', content: dynamicContent });
            }
        }
        
        // 4. Message N: The current user query
        if (newPromptMsg) {
            requestMessages.push(newPromptMsg);
        }

        const requestPayload: any = {
            model: this.options.model,
            messages: requestMessages,
            stream: true,
            temperature: 0.2
        };

        if (this.options.useStructuredOutputs) {
            const isSubagent = !!process.env.SHARK_SUBAGENT_ROLE;
            requestPayload.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: isSubagent ? 'subagent_response' : 'agent_response',
                    strict: true,
                    schema: toStrictOpenAISchema(isSubagent ? SUBAGENT_RESPONSE_JSON_SCHEMA : COORDINATOR_RESPONSE_JSON_SCHEMA)
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

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined;
        try {
            const res = await fetch(`${this.options.baseURL}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestPayload),
                signal: controller.signal
            });

            if (!res.ok) {
                clearTimeout(timeoutId);
                const errBody = await res.text();
                throw new Error(`OpenAI API request failed: ${res.status} ${res.statusText} - ${errBody}`);
            }

            reader = res.body?.getReader();
            if (!reader) {
                clearTimeout(timeoutId);
                throw new Error('Response body reader is undefined');
            }

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

            clearTimeout(timeoutId);

            FileLogger.log('PROVIDER_RESPONSE', 'Raw response from OpenAI Compatible API', { fullContent });
            const parsedResponse = parseAgentResponse(fullContent);
            parsedResponse.conversation_id = conversationId;

            // Save LLM response to history
            const cleanedResponse = cleanResponseObject(parsedResponse);
            history.push({ role: 'assistant', content: JSON.stringify(cleanedResponse) });

            // Retroactive Tool Output Compaction (Micro-cycle Cleanup)
            const lastUserMsg = history[history.length - 2];
            if (lastUserMsg && lastUserMsg.role === 'user') {
                lastUserMsg.content = compactToolOutputRetroactively(lastUserMsg.content);
            }

            await HistoryManager.saveHistory(conversationId, history);

            if (options.onComplete) {
                options.onComplete(parsedResponse);
            }

            return parsedResponse;
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`OpenAI API request timed out after 5 minutes.`);
            }
            throw error;
        } finally {
            if (reader && typeof reader.releaseLock === 'function') {
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

