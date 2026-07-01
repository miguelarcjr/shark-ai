import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StackSpotProvider } from './stackspot-provider.js';
import { sseClient } from './sse-client.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { ConfigManager } from '../config-manager.js';
import { ensureValidToken } from './stackspot-client.js';
import { parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { skillManager } from '../workflow/skill-manager.js';

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

vi.mock('../workflow/history-manager.js', () => ({
    HistoryManager: {
        getHistory: vi.fn().mockResolvedValue([]),
        saveHistory: vi.fn().mockResolvedValue(undefined)
    }
}));

vi.mock('../workflow/skill-manager.js', () => ({
    skillManager: {
        getSystemInstructionExtension: vi.fn().mockReturnValue(''),
        activateSkill: vi.fn().mockResolvedValue(''),
        listAvailableSkills: vi.fn().mockResolvedValue([]),
        reset: vi.fn()
    }
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
        vi.mocked(HistoryManager.getHistory).mockResolvedValue([]);
        vi.mocked(HistoryManager.saveHistory).mockResolvedValue(undefined);
        vi.mocked(skillManager.getSystemInstructionExtension).mockReturnValue('');
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: '01KEQCGJ65YENRA4QBXVN1YFFX',
                useServerConversation: true
            },
            agents: {},
            agentVersions: {}
        } as any);
    });

    it('should be instantiable and reference agentType', () => {
        const provider = new StackSpotProvider('developer_agent');
        expect(provider).toBeDefined();
    });

    it('should retrieve single agent ID from configuration stackspot.agentId', () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'config-stackspot-agent-id'
            }
        } as any);

        const devProvider = new StackSpotProvider('developer_agent');
        expect(devProvider.agentId).toBe('config-stackspot-agent-id');

        const baProvider = new StackSpotProvider('business_analyst');
        expect(baProvider.agentId).toBe('config-stackspot-agent-id');
    });

    it('should stream chat response correctly', async () => {
        const provider = new StackSpotProvider('developer_agent');
        
        // Mock streamAgentResponse to trigger callbacks
        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onChunk) {
                    callbacks.onChunk('Hello ');
                    callbacks.onChunk('world!');
                }
                if (callbacks?.onComplete) {
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
            use_conversation: true,
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
                if (callbacks?.onComplete) {
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

    it('should prepend system instructions if conversationId is undefined/empty', async () => {
        const provider = new StackSpotProvider('developer_agent');
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'test-agent-id'
            }
        } as any);

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onComplete) {
                    callbacks.onComplete('{}', {});
                }
            }
        );

        await provider.streamChat('Test prompt', {
            agentType: 'developer_agent',
            conversationId: undefined
        });

        expect(sseClient.streamAgentResponse).toHaveBeenCalled();
        const [, payload] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(payload.user_prompt).toContain('SYSTEM INSTRUCTIONS:');
        expect(payload.user_prompt).toContain('USER REQUEST:');
        expect(payload.user_prompt).toContain('Test prompt');
    });

    it('should not prepend system instructions if conversationId is defined', async () => {
        const provider = new StackSpotProvider('developer_agent');
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'test-agent-id'
            }
        } as any);

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onComplete) {
                    callbacks.onComplete('{}', {});
                }
            }
        );

        await provider.streamChat('Test prompt', {
            agentType: 'developer_agent',
            conversationId: 'existing-session-id'
        });

        expect(sseClient.streamAgentResponse).toHaveBeenCalled();
        const [, payload] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(payload.user_prompt).not.toContain('SYSTEM INSTRUCTIONS:');
        expect(payload.user_prompt).toBe('Test prompt');
    });

    it('should use local history and not use server conversation when useServerConversation is false', async () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'test-agent-id',
                useServerConversation: false
            },
            agents: {},
            agentVersions: {}
        } as any);
        const provider = new StackSpotProvider('developer_agent');

        vi.mocked(HistoryManager.getHistory).mockResolvedValue([
            { role: 'system', content: 'Base system prompt' },
            { role: 'user', content: 'First message' },
            { role: 'assistant', content: '{"actions":[]}' }
        ]);

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onComplete) {
                    callbacks.onComplete('{"actions":[]}', { conversation_id: 'local-session-id' });
                }
            }
        );

        await provider.streamChat('Second message', {
            agentType: 'developer_agent',
            conversationId: 'local-session-id'
        });

        expect(HistoryManager.getHistory).toHaveBeenCalledWith('local-session-id');
        expect(sseClient.streamAgentResponse).toHaveBeenCalled();
        const [, payload] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(payload.use_conversation).toBe(false);
        expect(payload.conversation_id).toBe('local-session-id');
        expect(payload.user_prompt).toContain('SYSTEM INSTRUCTIONS:\nBase system prompt');
        expect(payload.user_prompt).toContain('USER REQUEST:\nFirst message');
        expect(payload.user_prompt).toContain('ASSISTANT RESPONSE:\n{"actions":[]}');
        expect(payload.user_prompt).toContain('USER REQUEST:\nSecond message');

        expect(HistoryManager.saveHistory).toHaveBeenCalledWith(
            'local-session-id',
            expect.arrayContaining([
                { role: 'system', content: 'Base system prompt' },
                { role: 'user', content: 'First message' },
                { role: 'assistant', content: '{"actions":[]}' },
                { role: 'user', content: 'Second message' },
                { role: 'assistant', content: expect.stringContaining('actions') }
            ])
        );
    });

    it('should inject skill instructions in system instructions and not in user prompt when useServerConversation is false', async () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'test-agent-id',
                useServerConversation: false
            },
            agents: {},
            agentVersions: {}
        } as any);
        const provider = new StackSpotProvider('developer_agent');

        vi.mocked(HistoryManager.getHistory).mockResolvedValue([
            { role: 'system', content: 'Base system prompt' }
        ]);

        vi.mocked(skillManager.getSystemInstructionExtension).mockReturnValue('\n\n--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content\n');

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onComplete) {
                    callbacks.onComplete('{"actions":[]}', { conversation_id: 'local-session-id' });
                }
            }
        );

        await provider.streamChat('Test message', {
            agentType: 'developer_agent',
            conversationId: 'local-session-id'
        });

        const [, payload] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(payload.user_prompt).toContain('SYSTEM INSTRUCTIONS:\nBase system prompt');
        expect(payload.user_prompt).toContain('--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content');
        expect(payload.user_prompt).toContain('USER REQUEST:\nTest message');
        expect(payload.user_prompt).not.toContain('Test message\n\n--- ACTIVE SKILL');
    });

    it('should inject skill instructions in user prompt for subsequent turns when useServerConversation is true', async () => {
        vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
            stackspot: {
                agentId: 'test-agent-id',
                useServerConversation: true
            },
            agents: {},
            agentVersions: {}
        } as any);
        const provider = new StackSpotProvider('developer_agent');

        vi.mocked(skillManager.getSystemInstructionExtension).mockReturnValue('\n\n--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content\n');

        vi.mocked(sseClient.streamAgentResponse).mockImplementation(
            async (url, payload, headers, callbacks) => {
                if (callbacks?.onComplete) {
                    callbacks.onComplete('{"actions":[]}', { conversation_id: 'server-session-id' });
                }
            }
        );

        await provider.streamChat('Test message', {
            agentType: 'developer_agent',
            conversationId: 'server-session-id'
        });

        const [, payload] = vi.mocked(sseClient.streamAgentResponse).mock.calls[0] as any;
        expect(payload.user_prompt).toContain('Test message');
        expect(payload.user_prompt).toContain('--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content');
    });
});
