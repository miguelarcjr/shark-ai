import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interactiveDeveloperAgent } from './developer-agent.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { AIProvider } from '../api/provider.interface.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import { tui } from '../../ui/tui.js';
import { handleRunCommand, handleListFiles, handleSearchFile, handleSearchCode } from './agent-tools.js';
import { skillManager } from '../workflow/skill-manager.js';


vi.mock('./agent-tools.js', () => ({
    handleRunCommand: vi.fn(),
    handleListFiles: vi.fn(),
    handleSearchFile: vi.fn(),
    handleSearchCode: vi.fn(),
}));

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
                actions: [],
                message: 'Reading file test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
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
                actions: [],
                message: 'Modifying test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
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
                actions: [],
                message: 'Modifying test.ts',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
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
        vi.mocked(handleRunCommand).mockResolvedValue('test output');
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'create_file',
                    path: 'newfile.ts',
                    content: 'console.log("hello");',
                },
                actions: [],
                message: 'Creating file',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'run_command',
                    command: 'echo "test"',
                },
                actions: [],
                message: 'Running command',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'delete_file',
                    path: 'newfile.ts',
                },
                actions: [],
                message: 'Deleting file',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
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
                actions: [],
                message: 'Asking user',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
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

    it('should handle list_files, search_file, search_code, and use_mcp_tool actions', async () => {
        vi.mocked(handleListFiles).mockReturnValue('[FILE] file1.ts\n[FILE] file2.ts');
        vi.mocked(handleSearchFile).mockReturnValue('file1.ts');
        vi.mocked(handleSearchCode).mockReturnValue('match on line 5');

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'list_files',
                    path: 'src',
                },
                actions: [],
                message: 'Listing files',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'search_file',
                    path: '*.ts',
                },
                actions: [],
                message: 'Searching files',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'search_code',
                    path: 'src/**/*.ts',
                    query: 'import',
                    is_regex: false,
                },
                actions: [],
                message: 'Searching code',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'use_mcp_tool',
                    tool_name: 'test-tool',
                },
                actions: [],
                message: 'Trying MCP tool',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Done searching',
                conversation_id: 'conv-123',
            });

        const result = await interactiveDeveloperAgent({
            taskId: 'search-task',
            taskInstruction: 'Search and complete',
        });

        expect(handleListFiles).toHaveBeenCalledWith('src');
        expect(handleSearchFile).toHaveBeenCalledWith('*.ts');
        expect(handleSearchCode).toHaveBeenCalledWith('src/**/*.ts', 'import', false);
        expect(result).toEqual({ success: true, summary: 'Done searching' });
    });

    it('should prompt user on empty agent response and handle cancellation', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: null,
            actions: [],
            message: '',
            conversation_id: 'conv-123',
        });

        vi.mocked(tui.isCancel).mockReturnValue(true);
        vi.mocked(tui.text).mockResolvedValue('cancel');

        const result = await interactiveDeveloperAgent({
            taskId: 'empty-task',
            taskInstruction: 'Empty instruction',
        });

        expect(tui.text).toHaveBeenCalledWith({ message: 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:' });
        expect(result).toEqual({ success: true, summary: 'Task completed without summary.' });
    });

    it('should handle activate_skill action and append its instruction extension to subsequent prompts', async () => {
        vi.spyOn(skillManager, 'activateSkill').mockResolvedValue('My Skill Prompt Content');
        vi.spyOn(skillManager, 'getSystemInstructionExtension').mockReturnValue('\n\n<EXTREMELY_IMPORTANT>\n--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content\n</EXTREMELY_IMPORTANT>\n');

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'activate_skill',
                    skill_name: 'my-skill',
                },
                actions: [],
                message: 'Activating skill my-skill',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Done with skill',
                conversation_id: 'conv-123',
            });

        const result = await interactiveDeveloperAgent({
            taskId: 'skill-task',
            taskInstruction: 'Activate a skill',
        });

        expect(skillManager.activateSkill).toHaveBeenCalledWith('my-skill');
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("[System]: Skill 'my-skill' activated successfully.\n\n<EXTREMELY_IMPORTANT>\n--- ACTIVE SKILL: my-skill ---\nMy Skill Prompt Content\n</EXTREMELY_IMPORTANT>\n"),
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, summary: 'Done with skill' });
    });
});

