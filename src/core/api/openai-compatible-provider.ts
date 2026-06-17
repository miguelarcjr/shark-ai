import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';
import crypto from 'node:crypto';

interface OpenAIConfig {
    baseURL: string;
    apiKey: string;
    model: string;
    useStructuredOutputs: boolean;
}

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private options: OpenAIConfig) {}

    private getAgentSystemPrompt(agentType: string): string {
        // Base system instructions establishing JSON schema and available actions
        const baseSystem = `You are a professional software engineer AI agent in a collaborative development environment.
You MUST respond strictly with a single JSON object matching the schema.
Do NOT output any markdown blocks or explanations outside of the JSON object.
Use the 'talk_with_user' action inside the actions list to speak to the user.

Required Output JSON Schema:
{
  "actions": [
    {
      "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_code" | "run_command" | "talk_with_user" | "delete_file",
      "path": "relative path to file",
      "content": "file content or talk message",
      "target_content": "exact text block to replace (modify_file only)",
      "command": "terminal command (run_command only)"
    }
  ],
  "summary": "Short explanation of the actions performed."
}`;

        let specific = '';
        if (agentType === 'business_analyst') {
            specific = `You are the Business Analyst Agent. Understand user requirements, gather clarifications, and create technical briefings.`;
        } else if (agentType === 'developer_agent') {
            specific = `You are the Developer Agent. Implement code steps and fix compilation/test issues using terminal feedback.`;
        } else if (agentType === 'specification_agent') {
            specific = `You are the Specification Agent. Write and maintain the tech-spec.md file in the project.`;
        } else if (agentType === 'qa_agent') {
            specific = `You are the QA Agent. Write unit tests, run them, and verify coverage and correctness.`;
        } else if (agentType === 'scan_agent') {
            specific = `You are the Scan Agent. Analyze repository code for vulnerabilities, issues, and style guidelines.`;
        } else if (agentType === 'code_review') {
            specific = `You are the Code Review Agent. Review pull requests and code modifications, pointing out flaws and recommending improvements.`;
        } else {
            specific = `You are an AI Agent assisting in development.`;
        }

        return `${baseSystem}\n\nAgent Personality: ${specific}`;
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
                          actions: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                type: { 
                                  type: 'string', 
                                  enum: ["create_file", "modify_file", "read_file", "list_files", "search_code", "run_command", "talk_with_user", "delete_file"] 
                                },
                                path: { type: 'string' },
                                content: { type: 'string' },
                                target_content: { type: 'string' },
                                command: { type: 'string' }
                              },
                              required: ["type", "path", "content", "target_content", "command"],
                              additionalProperties: false
                            }
                          },
                          summary: { type: 'string' }
                        },
                        required: ["actions", "summary"],
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
