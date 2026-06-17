import { AgentResponse } from '../agents/agent-response-parser.js';

export interface ChatOptions {
    onChunk?: (chunk: string) => void;
    onComplete?: (response: AgentResponse) => void;
    conversationId?: string;
    agentType: 'business_analyst' | 'developer_agent' | 'qa_agent' | 'specification_agent' | 'scan_agent' | 'code_review';
}

export interface AIProvider {
    streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse>;
}
