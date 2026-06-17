import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interactiveDeveloperAgent } from './developer-agent.js';
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

vi.mock('../../ui/tui.js', () => {
    const mockSpinner = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
    };
    return {
        tui: {
            spinner: vi.fn(() => mockSpinner),
            log: {
                info: vi.fn(),
                success: vi.fn(),
                warning: vi.fn(),
                error: vi.fn(),
            },
            isCancel: vi.fn(),
            confirm: vi.fn(),
            text: vi.fn(),
        },
    };
});

describe('DeveloperAgent', () => {
    let mockProvider: AIProvider;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();

        mockProvider = {
            streamChat: vi.fn(),
        };
        vi.mocked(ProviderResolver.getProvider).mockReturnValue(mockProvider);
    });

    it('should delegate calls to provider resolved via ProviderResolver and return success', async () => {
        const expectedResponse = {
            actions: [],
            message: 'TASK_COMPLETED: Refactoring complete',
            conversation_id: 'new-conv-id',
        };

        vi.mocked(conversationManager.getConversationId).mockResolvedValue('existing-conv-id');
        vi.mocked(mockProvider.streamChat).mockResolvedValue(expectedResponse);

        const result = await interactiveDeveloperAgent({
            taskId: 'test-task',
            taskInstruction: 'Refactor developer-agent',
        });

        // Verify provider retrieval
        expect(ProviderResolver.getProvider).toHaveBeenCalledWith('developer_agent');
        
        // Verify conversation id was loaded
        expect(conversationManager.getConversationId).toHaveBeenCalledWith('dev_agent_test-task');

        // Verify streamChat called correctly
        expect(mockProvider.streamChat).toHaveBeenCalledWith(expect.stringContaining('Refactor developer-agent'), {
            conversationId: 'existing-conv-id',
            agentType: 'developer_agent',
            onChunk: expect.any(Function),
        });

        // Verify conversation id was saved
        expect(conversationManager.saveConversationId).toHaveBeenCalledWith('dev_agent_test-task', 'new-conv-id');

        // Verify result
        expect(result).toEqual({ success: true, summary: 'Refactoring complete' });
    });
});
