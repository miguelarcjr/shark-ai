import { AgentResponse } from '../agents/agent-response-parser.js';

export interface ChatOptions {
    onChunk?: (chunk: string) => void;
    onComplete?: (response: AgentResponse) => void;
    conversationId?: string;
    agentType: 'developer_agent';
    searchQuery?: string;
    systemPrompt?: string;
    hasMcpServers?: boolean;
    signal?: AbortSignal;
}

export interface CompletePromptOptions {
    systemPrompt?: string;
    temperature?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export interface AIProvider {
    streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse>;
    completePrompt?(prompt: string, options?: CompletePromptOptions): Promise<string>;
}

