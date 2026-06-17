import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderResolver } from './provider-resolver.js';
import { ConfigManager } from '../config-manager.js';
import { StackSpotProvider } from './stackspot-provider.js';

describe('ProviderResolver', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should resolve StackSpotProvider by default', () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({} as any);
        const provider = ProviderResolver.getProvider('developer_agent');
        expect(provider.constructor.name).toBe('StackSpotProvider');
    });

    it('should configure StackSpotProvider with the single agentId from config', () => {
        const mockConfig = {
            stackspot: {
                agentId: 'joker-agent-id'
            }
        };
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue(mockConfig as any);

        const devProvider = ProviderResolver.getProvider('developer_agent') as StackSpotProvider;
        expect(devProvider.agentId).toBe('joker-agent-id');
    });

    it('should resolve OpenAICompatibleProvider when configured', () => {
        const mockConfig = {
            provider: 'openai-compatible',
            'openai-compatible': {
                baseURL: 'http://custom-url/v1',
                apiKey: 'custom-key',
                model: 'custom-model',
                useStructuredOutputs: false
            }
        };
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue(mockConfig as any);

        const provider = ProviderResolver.getProvider('developer_agent');
        expect(provider.constructor.name).toBe('OpenAICompatibleProvider');
        expect((provider as any).options).toEqual({
            baseURL: 'http://custom-url/v1',
            apiKey: 'custom-key',
            model: 'custom-model',
            useStructuredOutputs: false
        });
    });

    it('should resolve OpenAICompatibleProvider with defaults when configured without options', () => {
        const mockConfig = {
            provider: 'openai-compatible'
        };
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue(mockConfig as any);

        const provider = ProviderResolver.getProvider('developer_agent');
        expect(provider.constructor.name).toBe('OpenAICompatibleProvider');
        expect((provider as any).options).toEqual({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: true
        });
    });
});
