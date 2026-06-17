import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StackSpotProvider } from './stackspot-provider.js';
import { sseClient } from './sse-client.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { ConfigManager } from '../config-manager.js';
import { ensureValidToken } from './stackspot-client.js';
import { parseAgentResponse } from '../agents/agent-response-parser.js';

vi.mock('../auth/get-active-realm.js', () => ({
    getActiveRealm: vi.fn()
}));

vi.mock('../auth/token-storage.js', () => ({
    tokenStorage: {
        getToken: vi.fn()
    }
}));

vi.mock('./stackspot-client.js', () => ({
    STACKSPOT_AGENT_API_BASE: 'https://test.api.stackspot.com',
    ensureValidToken: vi.fn()
}));

vi.mock('./sse-client.js', () => ({
    sseClient: {
        streamAgentResponse: vi.fn()
    }
}));

vi.mock('../agents/agent-response-parser.js', () => ({
    parseAgentResponse: vi.fn()
}));

describe('StackSpotProvider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.mocked(getActiveRealm).mockResolvedValue('test-realm');
        vi.mocked(tokenStorage.getToken).mockResolvedValue('test-token');
        vi.mocked(ensureValidToken).mockResolvedValue('test-token');
        vi.mocked(parseAgentResponse).mockImplementation((raw: any) => ({
            actions: [{ type: 'talk_with_user', content: raw?.message || '', path: '' }],
            conversation_id: raw?.conversation_id
        }));
    });

    it('should be instantiable and reference agentType', () => {
        const provider = new StackSpotProvider('developer_agent');
        expect(provider).toBeDefined();
        expect(provider.agentId).toBeUndefined(); // mapping is empty in default config
    });

    it('should retrieve agent ID from configuration mapping if available', () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            agents: {
                dev: 'config-dev-agent-id',
                ba: 'config-ba-agent-id'
            }
        } as any);

        const devProvider = new StackSpotProvider('developer_agent');
        expect(devProvider.agentId).toBe('config-dev-agent-id');

        const baProvider = new StackSpotProvider('business_analyst');
        expect(baProvider.agentId).toBe('config-ba-agent-id');
    });

    it('should stream chat response correctly', async () => {
        const provider = new StackSpotProvider('developer_agent');
        
        // Mock streamAgentResponse to trigger callbacks
        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks.onChunk) {
                    callbacks.onChunk('Hello ');
                    callbacks.onChunk('world!');
                }
                if (callbacks.onComplete) {
                    callbacks.onComplete('Hello world!', { conversation_id: 'test-conv-id' });
                }
            }
        );

        const onChunk = vi.fn();
        const onComplete = vi.fn();
        
        const response = await provider.streamChat('Test prompt', {
            conversationId: 'test-conv-id',
            agentType: 'developer_agent',
            onChunk,
            onComplete
        });

        expect(sseClient.streamAgentResponse).toHaveBeenCalled();
        const [url, payload, headers] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        
        expect(url).toContain('01KEQCGJ65YENRA4QBXVN1YFFX'); // default dev agent ID
        expect(payload).toEqual({
            user_prompt: 'Test prompt',
            streaming: true,
            stackspot_knowledge: false,
            return_ks_in_response: true,
            deep_search_ks: false,
            conversation_id: 'test-conv-id'
        });
        expect(headers).toEqual({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
        });

        expect(onChunk).toHaveBeenCalledWith('Hello ');
        expect(onChunk).toHaveBeenCalledWith('world!');
        expect(onComplete).toHaveBeenCalled();
        expect(response.conversation_id).toBe('test-conv-id');
    });

    it('should fall back to tokenStorage.getToken if ensureValidToken fails', async () => {
        const provider = new StackSpotProvider('developer_agent');
        
        vi.mocked(ensureValidToken).mockRejectedValue(new Error('Auth failed'));
        vi.mocked(tokenStorage.getToken).mockResolvedValue('fallback-token');

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks.onComplete) {
                    callbacks.onComplete('Hello world!', { conversation_id: 'test-conv-id' });
                }
            }
        );

        await provider.streamChat('Test prompt', {
            conversationId: 'test-conv-id',
            agentType: 'developer_agent'
        });

        expect(ensureValidToken).toHaveBeenCalled();
        expect(tokenStorage.getToken).toHaveBeenCalled();
        
        const [url, payload, headers] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(headers.Authorization).toBe('Bearer fallback-token');
    });
});
