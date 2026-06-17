import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse } from '../agents/agent-response-parser.js';

export class StackSpotProvider implements AIProvider {
    constructor(private agentType: string) {}
    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        return { actions: [] };
    }
}
