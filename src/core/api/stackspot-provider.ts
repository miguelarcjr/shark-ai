import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse } from '../agents/agent-response-parser.js';
import { ConfigManager } from '../config-manager.js';

export class StackSpotProvider implements AIProvider {
    public agentId?: string;

    constructor(private agentType: string) {
        const config = ConfigManager.getInstance().getConfig();
        const mapping: Record<string, string | undefined> = {
            'business_analyst': config.agents?.ba,
            'developer_agent': config.agents?.dev,
            'qa_agent': config.agents?.qa,
            'specification_agent': config.agents?.spec,
            'scan_agent': config.agents?.scan,
            'code_review': config.agents?.codeReview
        };
        this.agentId = mapping[agentType];
    }

    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        return { actions: [] };
    }
}
