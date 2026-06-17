import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBusinessAnalystAgent } from './business-analyst-agent.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { AIProvider } from '../api/provider.interface.js';

vi.mock('../api/provider-resolver.js', () => ({
    ProviderResolver: {
        getProvider: vi.fn(),
    },
}));

vi.mock('../workflow/conversation-manager.js', () => ({
    conversationManager: {
        getConversationId: vi.fn(),
        saveConversationId: vi.fn(),
    },
}));

describe('BusinessAnalystAgent', () => {
    let mockProvider: AIProvider;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();

        mockProvider = {
            streamChat: vi.fn(),
        };
        vi.mocked(ProviderResolver.getProvider).mockReturnValue(mockProvider);
    });

    it('should delegate calls to provider resolved via ProviderResolver', async () => {
        const expectedResponse = {
            actions: [{ type: 'talk_with_user', content: 'Design ideas', path: '' }],
            conversation_id: 'new-conv-id',
        };

        vi.mocked(conversationManager.getConversationId).mockResolvedValue('existing-conv-id');
        vi.mocked(mockProvider.streamChat).mockResolvedValue(expectedResponse as any);

        const onChunk = vi.fn();
        const onComplete = vi.fn();

        const response = await runBusinessAnalystAgent('Build a task manager', {
            onChunk,
            onComplete,
        });

        expect(ProviderResolver.getProvider).toHaveBeenCalledWith('business_analyst');
        expect(conversationManager.getConversationId).toHaveBeenCalledWith('business_analyst');
        expect(mockProvider.streamChat).toHaveBeenCalledWith('Build a task manager', {
            conversationId: 'existing-conv-id',
            agentType: 'business_analyst',
            onChunk,
            onComplete,
        });
        expect(conversationManager.saveConversationId).toHaveBeenCalledWith('business_analyst', 'new-conv-id');
        expect(response).toEqual(expectedResponse);
    });
});
