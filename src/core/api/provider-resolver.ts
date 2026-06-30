import { AIProvider } from './provider.interface.js';
import { StackSpotProvider } from './stackspot-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { ConfigManager } from '../config-manager.js';

export class ProviderResolver {
    static getProvider(agentType: 'developer_agent'): AIProvider {
        const config = ConfigManager.getInstance().getConfig() as any;
        
        if (config.provider === 'openai-compatible') {
            const opt = config['openai-compatible'] || {};
            return new OpenAICompatibleProvider({
                baseURL: opt.baseURL || 'http://localhost:11434/v1',
                apiKey: opt.apiKey || 'ollama',
                model: opt.model || 'llama3',
                useStructuredOutputs: opt.useStructuredOutputs ?? true
            });
        }
        
        return new StackSpotProvider(agentType);
    }
}
