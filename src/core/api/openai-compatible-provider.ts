import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse } from '../agents/agent-response-parser.js';

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private options: any) {}
    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        return { actions: [] };
    }
}
