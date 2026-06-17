import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interactiveDeveloperAgent } from './developer-agent.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { AIProvider } from '../api/provider.interface.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import { tui } from '../../ui/tui.js';

vi.mock('../workflow/anchor-state-manager.js', () => ({
    AnchorStateManager: vi.fn(),
}));

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

    it('should handle read_file action using AnchorStateManager', async () => {
        const mockGetAnchoredContent = vi.fn().mockReturnValue('anchor1§const x = 1;');
        vi.mocked(AnchorStateManager).mockImplementation(() => ({
            getAnchoredContent: mockGetAnchoredContent,
            applyAnchoredEdit: vi.fn(),
        } as any));

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'read_file',
                    path: 'test.ts',
                },
                message: 'Reading file test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                message: 'TASK_COMPLETED: Read completed successfully',
                conversation_id: 'conv-123',
            });

        const result = await interactiveDeveloperAgent({
            taskId: 'read-task',
            taskInstruction: 'Read test.ts file',
        });

        expect(mockGetAnchoredContent).toHaveBeenCalledWith('test.ts');
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(2, expect.stringContaining('anchor1§const x = 1;'), expect.any(Object));
        expect(result).toEqual({ success: true, summary: 'Read completed successfully' });
    });

    it('should handle modify_file action using AnchorStateManager with confirmation', async () => {
        const mockApplyAnchoredEdit = vi.fn();
        vi.mocked(AnchorStateManager).mockImplementation(() => ({
            getAnchoredContent: vi.fn(),
            applyAnchoredEdit: mockApplyAnchoredEdit,
        } as any));

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'modify_file',
                    path: 'test.ts',
                    start_anchor: 'anchor1',
                    end_anchor: 'anchor2',
                    content: 'new code content',
                },
                message: 'Modifying test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                message: 'TASK_COMPLETED: Modify completed',
                conversation_id: 'conv-123',
            });

        const mockConfirm = vi.mocked(tui.confirm).mockResolvedValue(true);

        const result = await interactiveDeveloperAgent({
            taskId: 'modify-task',
            taskInstruction: 'Modify test.ts file',
        });

        expect(mockConfirm).toHaveBeenCalledWith({ message: expect.stringContaining('Approve modify_file changes to test.ts?') });
        expect(mockApplyAnchoredEdit).toHaveBeenCalledWith('test.ts', 'anchor1', 'anchor2', 'new code content');
        expect(result).toEqual({ success: true, summary: 'Modify completed' });
    });

    it('should handle modify_file action auto-approved when auto flag is active', async () => {
        const mockApplyAnchoredEdit = vi.fn();
        vi.mocked(AnchorStateManager).mockImplementation(() => ({
            getAnchoredContent: vi.fn(),
            applyAnchoredEdit: mockApplyAnchoredEdit,
        } as any));

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'modify_file',
                    path: 'test.ts',
                    start_anchor: 'anchor1',
                    end_anchor: 'anchor2',
                    content: 'new code content',
                },
                message: 'Modifying test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                message: 'TASK_COMPLETED: Modify completed',
                conversation_id: 'conv-123',
            });

        const mockConfirm = vi.mocked(tui.confirm);

        const result = await interactiveDeveloperAgent({
            taskId: 'modify-task',
            taskInstruction: 'Modify test.ts file',
            auto: true,
        });

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockApplyAnchoredEdit).toHaveBeenCalledWith('test.ts', 'anchor1', 'anchor2', 'new code content');
        expect(result).toEqual({ success: true, summary: 'Modify completed' });
    });

    it('should handle create_file, delete_file, and run_command actions with confirmation', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'create_file',
                    path: 'newfile.ts',
                    content: 'console.log("hello");',
                },
                message: 'Creating file',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'run_command',
                    command: 'echo "test"',
                },
                message: 'Running command',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'delete_file',
                    path: 'newfile.ts',
                },
                message: 'Deleting file',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                message: 'TASK_COMPLETED: Cleanup completed',
                conversation_id: 'conv-123',
            });

        vi.mocked(tui.confirm).mockResolvedValue(true);

        const result = await interactiveDeveloperAgent({
            taskId: 'crud-task',
            taskInstruction: 'Do CRUD operations',
        });

        expect(tui.confirm).toHaveBeenCalledWith({ message: expect.stringContaining('Approve create_file changes to newfile.ts?') });
        expect(tui.confirm).toHaveBeenCalledWith({ message: expect.stringContaining('Execute run_command: echo "test"?') });
        expect(tui.confirm).toHaveBeenCalledWith({ message: expect.stringContaining('Approve delete_file changes to newfile.ts?') });
        expect(result).toEqual({ success: true, summary: 'Cleanup completed' });
    });

    it('should handle talk_with_user action', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: 'How should I handle empty inputs?',
                },
                message: 'Asking user',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                message: 'TASK_COMPLETED: Conversation done',
                conversation_id: 'conv-123',
            });

        vi.mocked(tui.text).mockResolvedValue('Just ignore them');

        const result = await interactiveDeveloperAgent({
            taskId: 'talk-task',
            taskInstruction: 'Ask user and complete',
        });

        expect(tui.text).toHaveBeenCalledWith({ message: 'Your answer:' });
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(2, expect.stringContaining('Just ignore them'), expect.any(Object));
        expect(result).toEqual({ success: true, summary: 'Conversation done' });
    });
});

