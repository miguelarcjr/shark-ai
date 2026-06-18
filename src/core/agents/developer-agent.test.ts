import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interactiveDeveloperAgent } from './developer-agent.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { AIProvider } from '../api/provider.interface.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import { tui } from '../../ui/tui.js';
import { handleRunCommand, handleListFiles, handleSearchFile, handleSearchCode } from './agent-tools.js';
import { skillManager } from '../workflow/skill-manager.js';
import { subagentManager } from '../workflow/subagent-manager.js';


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
            select: vi.fn(),
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

    it('should handle define_subagent, invoke_subagent, send_message, and manage_subagents actions', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'define_subagent',
                    name: 'test-writer',
                    description: 'Writes test files',
                    system_prompt: 'You write vitest files',
                    enable_write_tools: true,
                },
                actions: [],
                message: 'Defining a test writer',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'invoke_subagent',
                    Subagents: [{
                        TypeName: 'test-writer',
                        Role: 'test code author',
                        Prompt: 'Write a unit test for subagent manager',
                    }],
                },
                actions: [],
                message: 'Invoking test writer subagent',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'send_message',
                    Recipient: 'subagent-abc',
                    Message: 'Please proceed with writing tests',
                },
                actions: [],
                message: 'Sending message to subagent',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'manage_subagents',
                    Action: 'list',
                },
                actions: [],
                message: 'Listing active subagents',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Finished testing subagent actions',
                conversation_id: 'conv-123',
            });

        // Spy on subagentManager methods
        const defineSpy = vi.spyOn(subagentManager, 'defineSubagentType');
        const invokeSpy = vi.spyOn(subagentManager, 'invokeSubagents').mockResolvedValue([{
            id: 'subagent-abc',
            TypeName: 'test-writer',
            Role: 'test code author',
        }]);
        const sendSpy = vi.spyOn(subagentManager, 'sendMessage');
        const getActiveSpy = vi.spyOn(subagentManager, 'getActiveSubagents');

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-flow-task',
            taskInstruction: 'Test subagent management flow',
        });

        expect(defineSpy).toHaveBeenCalledWith('test-writer', 'Writes test files', 'You write vitest files', {
            enableWriteTools: true,
            enableSubagentTools: undefined,
            enableMcpTools: undefined,
        });
        expect(invokeSpy).toHaveBeenCalledWith([{
            TypeName: 'test-writer',
            Role: 'test code author',
            Prompt: 'Write a unit test for subagent manager',
        }], 'subagent-flow-task');
        expect(sendSpy).toHaveBeenCalledWith('subagent-abc', 'Please proceed with writing tests');
        expect(getActiveSpy).toHaveBeenCalled();

        expect(result).toEqual({ success: true, summary: 'Finished testing subagent actions' });
    });

    it('should support /skills interactive command and activate selection', async () => {
        vi.mocked(tui.text)
            .mockResolvedValueOnce('/skills')
            .mockResolvedValueOnce('my actual task');

        vi.mocked(tui.select).mockResolvedValueOnce('brainstorming');
        vi.mocked(tui.isCancel).mockReturnValue(false);

        vi.spyOn(skillManager, 'listAvailableSkills').mockResolvedValue(['brainstorming', 'systematic-debugging', 'test-driven-development']);
        vi.spyOn(skillManager, 'activateSkill').mockResolvedValue('Brainstorm prompt');

        const expectedResponse = {
            actions: [],
            message: 'TASK_COMPLETED: Done task',
            conversation_id: 'conv-id',
        };
        vi.mocked(mockProvider.streamChat).mockResolvedValue(expectedResponse);

        const result = await interactiveDeveloperAgent({
            taskId: 'skills-cmd-task',
        });

        expect(skillManager.listAvailableSkills).toHaveBeenCalled();

        expect(tui.select).toHaveBeenCalledWith({
            message: 'Selecione a Skill do Superpowers para ativar:',
            options: [
                { value: 'brainstorming', label: 'brainstorming' },
                { value: 'systematic-debugging', label: 'systematic-debugging' },
                { value: 'test-driven-development', label: 'test-driven-development' },
            ]
        });

        expect(skillManager.activateSkill).toHaveBeenCalledWith('brainstorming');
        expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining("Skill 'brainstorming' ativada com sucesso!"));

        expect(tui.text).toHaveBeenNthCalledWith(2, {
            message: 'O que você gostaria que o Shark Dev fizesse?',
            placeholder: 'digite a instrução da tarefa...'
        });

        expect(mockProvider.streamChat).toHaveBeenCalledWith(
            expect.stringContaining('my actual task'),
            expect.any(Object)
        );

        expect(result).toEqual({ success: true, summary: 'Done task' });
    });

    it('should stay open and prompt the user again on task completion in interactive mode', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: First part done',
                conversation_id: 'conv-interactive-1',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Second part done',
                conversation_id: 'conv-interactive-1',
            });

        // 1st call: initial prompt, 2nd call: continue conversation, 3rd call: cancel to break the loop
        vi.mocked(tui.text)
            .mockResolvedValueOnce('initial task')
            .mockResolvedValueOnce('continue conversation')
            .mockResolvedValueOnce('cancel');
        vi.mocked(tui.isCancel)
            .mockReturnValueOnce(false) // for 'initial task'
            .mockReturnValueOnce(false) // for 'continue conversation'
            .mockReturnValueOnce(true);  // for 'cancel'

        const result = await interactiveDeveloperAgent({}); // run in interactive mode

        // Verify the user was prompted multiple times
        expect(tui.text).toHaveBeenCalledTimes(3);
        expect(result).toEqual({ success: true, summary: 'Second part done' });
    });

    it('should stay open and prompt the user again on task failure in interactive mode', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_FAILED: First try failed',
                conversation_id: 'conv-interactive-failed',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_FAILED: Second try failed',
                conversation_id: 'conv-interactive-failed',
            });

        // 1st call: initial prompt, 2nd call: retry instruction, 3rd call: cancel to break the loop
        vi.mocked(tui.text)
            .mockResolvedValueOnce('try task')
            .mockResolvedValueOnce('retry instruction')
            .mockResolvedValueOnce('cancel');
        vi.mocked(tui.isCancel)
            .mockReturnValueOnce(false) // for 'try task'
            .mockReturnValueOnce(false) // for 'retry instruction'
            .mockReturnValueOnce(true);  // for 'cancel'

        const result = await interactiveDeveloperAgent({}); // run in interactive mode

        // Verify the user was prompted multiple times
        expect(tui.text).toHaveBeenCalledTimes(3);
        expect(result).toEqual({ success: false, summary: 'Second try failed' });
    });

    it('should retrieve mailbox messages for parent when taskId is undefined', async () => {
        vi.spyOn(subagentManager, 'retrieveMessages').mockReturnValue(['Hello parent']);

        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Done',
                conversation_id: 'conv-123',
            });

        // We run with taskInstruction so that we don't prompt for task instruction at start
        await interactiveDeveloperAgent({
            taskInstruction: 'Do something',
        });

        // Verify subagentManager.retrieveMessages was called with 'parent'
        expect(subagentManager.retrieveMessages).toHaveBeenCalledWith('parent');
        // Verify the streamChat was called with the mailbox content
        expect(mockProvider.streamChat).toHaveBeenCalledWith(
            expect.stringContaining('✉️ NEW MAILBOX MESSAGES:\n- Hello parent'),
            expect.any(Object)
        );
    });

    it('should complete and return summary without prompting if subagent receives talk_with_user', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: {
                type: 'talk_with_user',
                content: 'TASK_COMPLETED: Final subagent result',
            },
            actions: [],
            message: 'Talk to user',
            conversation_id: 'conv-sub-talk-1',
        });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-talk-task',
            auto: true,
        });

        // Verify promptUser/tui.text was never called
        expect(tui.text).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, summary: 'Final subagent result' });
    });

    it('should log warning and exit loop if subagent receives empty action (no action)', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: null,
            actions: [],
            message: 'Doing something, but no action',
            conversation_id: 'conv-sub-empty-1',
        });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-empty-task',
            auto: true,
        });

        // Verify tui.text was never called
        expect(tui.text).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, summary: 'Task completed without summary.' });
    });

    it('should auto-approve error recovery without prompting if subagent receives talk_with_user with [SYSTEM ERROR]', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: '[SYSTEM ERROR] invalid json',
                },
                actions: [],
                message: 'System error',
                conversation_id: 'conv-sub-error-1',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: 'TASK_COMPLETED: Recovered successfully',
                },
                actions: [],
                message: 'Talk to user completion',
                conversation_id: 'conv-sub-error-1',
            });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-error-task',
            auto: true,
        });

        // Verify tui.text/confirm were never called
        expect(tui.text).not.toHaveBeenCalled();
        expect(tui.confirm).not.toHaveBeenCalled();
        
        // The second streamChat should be called with the [SYSTEM ERROR] message automatically sent back to the agent
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(2, expect.stringContaining('[SYSTEM ERROR] invalid json'), expect.any(Object));
        expect(result).toEqual({ success: true, summary: 'Recovered successfully' });
    });

    it('should NOT block and wait for active subagents, allowing the loop to continue immediately', async () => {
        let subagentPromiseResolved = false;
        const subagentPromise = new Promise<void>(resolve => {
            setTimeout(() => {
                subagentPromiseResolved = true;
                subagentManager.sendMessage('parent', 'Subagent result message');
                resolve();
            }, 50);
        });

        // Register a mock subagent for the parent
        vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockImplementation((parentId) => {
            if (parentId === 'parent' && !subagentPromiseResolved) {
                return [{
                    id: 'subagent-mock-1',
                    type: 'self',
                    role: 'Mock subagent',
                    status: 'running',
                    promise: subagentPromise,
                    parentId: 'parent'
                }];
            }
            return [];
        });

        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: null,
            actions: [],
            message: 'TASK_COMPLETED: Done immediately',
            conversation_id: 'conv-subagent-wait-1',
        });

        // Run the agent with a taskInstruction so it doesn't prompt for task at start
        const result = await interactiveDeveloperAgent({
            taskInstruction: 'Invoke and do not wait',
        });

        // Verify it did NOT wait (i.e. subagentPromiseResolved is still false)
        expect(subagentPromiseResolved).toBe(false);

        expect(result).toEqual({ success: true, summary: 'Done immediately' });
    });

    it('should truncate extremely long subagent role descriptions in prefix', async () => {
        const longRole = 'Analisar o projeto atual e resumir suas principais funcionalidades com base na estrutura e nos arquivos relevantes.';
        const expectedTruncated = 'Analisar o projet...';

        // Mock state for subagent Prefix logging
        vi.spyOn(subagentManager, 'getSubagentState').mockReturnValue({
            id: 'subagent-mock-long-1',
            type: 'self',
            role: longRole,
            status: 'running'
        });

        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: null,
            actions: [],
            message: 'TASK_COMPLETED: Done with long roles',
            conversation_id: 'conv-subagent-long-role',
        });

        // Run as a subagent (taskId is defined) so we can check the subagent prefix behavior
        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-mock-long-1',
            taskInstruction: 'Do something',
        });

        // Verify the prefix log used the truncated name (check if tui.log.success was called with truncated prefix)
        expect(tui.log.success).toHaveBeenCalledWith(
            expect.stringContaining(`[Subagent: ${expectedTruncated}]`)
        );

        expect(result).toEqual({ success: true, summary: 'Done with long roles' });
    });
});

