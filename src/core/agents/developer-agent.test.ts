import { describe, it, expect, vi, beforeEach } from 'vitest';
import { interactiveDeveloperAgent, waitForInputOrNotification } from './developer-agent.js';
import { MessageQueue } from '../workflow/message-queue.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { workflowManager } from '../workflow/workflow-manager.js';
import { HistoryManager } from '../workflow/history-manager.js';
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

vi.mock('node:fs', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:fs')>();
    const mockExistsSync = vi.fn(original.default.existsSync);
    const mockReaddirSync = vi.fn(original.default.readdirSync);
    const mockStatSync = vi.fn(original.default.statSync);
    const mockReadFileSync = vi.fn(original.default.readFileSync);
    return {
        ...original,
        existsSync: mockExistsSync,
        readdirSync: mockReaddirSync,
        statSync: mockStatSync,
        readFileSync: mockReadFileSync,
        default: {
            ...original.default,
            existsSync: mockExistsSync,
            readdirSync: mockReaddirSync,
            statSync: mockStatSync,
            readFileSync: mockReadFileSync,
        }
    };
});

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
            auto: true,
        });

        // Verify provider retrieval
        expect(ProviderResolver.getProvider).toHaveBeenCalledWith('developer_agent');
        
        // Verify conversation id was loaded
        expect(conversationManager.getConversationId).toHaveBeenCalledWith('dev_agent_test-task');

        // Verify streamChat called correctly
        expect(mockProvider.streamChat).toHaveBeenCalledWith(expect.stringContaining('Refactor developer-agent'), {
            conversationId: 'existing-conv-id',
            agentType: 'developer_agent',
            searchQuery: expect.any(String),
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
            auto: true,
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
        vi.mocked(tui.isCancel).mockReturnValueOnce(true);
        vi.mocked(tui.text).mockResolvedValueOnce('cancel');

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
        vi.mocked(tui.isCancel).mockReturnValueOnce(true);
        vi.mocked(tui.text).mockResolvedValueOnce('cancel');

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

        vi.mocked(tui.text)
            .mockResolvedValueOnce('Just ignore them')
            .mockResolvedValueOnce('cancel');
        vi.mocked(tui.isCancel)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

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
            auto: true,
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
            auto: true,
        });

        expect(skillManager.activateSkill).toHaveBeenCalledWith('my-skill');
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining("[System]: Skill 'my-skill' activated successfully."),
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, summary: 'Done with skill' });
    });

    it('should handle invoke_subagent action', async () => {
        vi.mocked(mockProvider.streamChat)
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
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Finished testing subagent actions',
                conversation_id: 'conv-123',
            });

        // Spy on subagentManager methods
        const invokeSpy = vi.spyOn(subagentManager, 'invokeSubagents').mockResolvedValue([{
            id: 'subagent-abc',
            TypeName: 'test-writer',
            Role: 'test code author',
        }]);

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-flow-task',
            taskInstruction: 'Test subagent management flow',
            auto: true,
        });

        expect(invokeSpy).toHaveBeenCalledWith([{
            TypeName: 'test-writer',
            Role: 'test code author',
            Prompt: 'Write a unit test for subagent manager',
        }], 'subagent-flow-task', expect.any(MessageQueue));

        expect(result).toEqual({ success: true, summary: 'Finished testing subagent actions' });
    });

    it('should support /skills interactive command and activate selection', async () => {
        vi.mocked(tui.text)
            .mockResolvedValueOnce('/skills')
            .mockResolvedValueOnce('my actual task')
            .mockResolvedValueOnce('cancel');

        vi.mocked(tui.select).mockResolvedValueOnce('brainstorming');
        vi.mocked(tui.isCancel)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

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
            auto: true,
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

    it('should NOT block and wait for active subagents during the loop, allowing it to continue immediately', async () => {
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

        let resolvedDuringStreamChat = false;
        vi.mocked(mockProvider.streamChat).mockImplementation(async () => {
            resolvedDuringStreamChat = subagentPromiseResolved;
            return {
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Done immediately',
                conversation_id: 'conv-subagent-wait-1',
            };
        });

        const nextSpy = vi.spyOn(MessageQueue.prototype, 'next').mockResolvedValue({
            type: 'user',
            content: 'cancel',
            timestamp: Date.now()
        });
        vi.mocked(tui.isCancel).mockReturnValue(true);

        // Run the agent with a taskInstruction so it doesn't prompt for task at start
        const result = await interactiveDeveloperAgent({
            taskInstruction: 'Invoke and do not wait',
            auto: true,
        });

        // Verify it did NOT wait during streamChat execution
        expect(resolvedDuringStreamChat).toBe(false);

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

    it('wakes up from prompt when a subagent completion event is queued', async () => {
        const queue = new MessageQueue();
        
        // Mock promptUser to resolve slowly
        let promptResolved = false;
        const promptPromise = (async () => {
            await new Promise(r => setTimeout(r, 2000));
            promptResolved = true;
            return 'user input';
        })();
        vi.mocked(tui.text).mockImplementation(() => promptPromise);
        
        // Push subagent completion event in 100ms
        setTimeout(() => {
            queue.push({
                type: 'subagent_notification',
                content: 'Task completed successfully',
                timestamp: Date.now(),
                metadata: { subagentId: 'sub-1', role: 'Tester', status: 'completed' }
            });
        }, 100);

        const result = await waitForInputOrNotification(queue);
        expect(result.type).toBe('subagent_notification');
        expect(result.content).toBe('Task completed successfully');
        expect(promptResolved).toBe(false); // Verified prompt was bypassed/aborted
    });

    it('handles wait action and resolves on timeout', async () => {
        const queue = new MessageQueue();
        // Mock promptUser to resolve slowly so timeout wins
        const promptPromise = new Promise<string>(() => {}); // never resolves
        vi.mocked(tui.text).mockImplementation(() => promptPromise);

        const start = Date.now();
        const result = await waitForInputOrNotification(queue, 'Your answer:', '', 100); // 100ms timeout
        const duration = Date.now() - start;
        expect(result.type).toBe('timeout');
        expect(duration).toBeGreaterThanOrEqual(95);
    });

    it('should handle wait action in main loop and resume on timeout', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'wait',
                    duration_seconds: 0.05,
                },
                actions: [],
                message: 'Waiting for updates',
                conversation_id: 'conv-123',
            })
            .mockResolvedValueOnce({
                action: null,
                actions: [],
                message: 'TASK_COMPLETED: Wait finished',
                conversation_id: 'conv-123',
            });

        // Mock promptUser to resolve slowly so timeout wins
        const promptPromise = new Promise<string>(() => {}); // never resolves
        vi.mocked(tui.text).mockImplementation(() => promptPromise);

        const result = await interactiveDeveloperAgent({
            taskId: 'wait-loop-task',
            taskInstruction: 'Wait and complete',
            auto: true,
        });

        // The second streamChat should be called with the timeout message
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('[System]: Wait duration of 0.05 seconds expired. No notifications received.'),
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, summary: 'Wait finished' });
    });

    it('terminates active subagents on exit (cleanup)', async () => {
        const expectedResponse = {
            actions: [],
            message: 'TASK_COMPLETED: Done',
            conversation_id: 'conv-id',
        };
        vi.mocked(mockProvider.streamChat).mockResolvedValue(expectedResponse);

        // Mock active subagents for parent
        const activeSub = {
            id: 'sub-active-cleanup',
            type: 'self',
            role: 'Tester',
            status: 'running' as const,
            parentId: 'parent-cleanup-id'
        };
        
        vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockImplementation((parentId) => {
            if (parentId === 'parent-cleanup-id') {
                return [activeSub];
            }
            return [];
        });

        const killSpy = vi.spyOn(subagentManager, 'killSubagent').mockImplementation(() => {});

        await interactiveDeveloperAgent({
            taskId: 'parent-cleanup-id',
            taskInstruction: 'Do something',
            auto: true,
        });

        expect(killSpy).toHaveBeenCalledWith('sub-active-cleanup');
    });

    it('registers and unregisters SIGINT and SIGTERM handlers, and cleans up subagents on signal', async () => {
        const expectedResponse = {
            actions: [],
            message: 'TASK_COMPLETED: Done',
            conversation_id: 'conv-id',
        };
        vi.mocked(mockProvider.streamChat).mockResolvedValue(expectedResponse);

        const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
        const offSpy = vi.spyOn(process, 'off').mockImplementation(() => process);
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

        // Mock active subagents for parent
        const activeSub = {
            id: 'sub-active-cleanup-sig',
            type: 'self',
            role: 'Tester',
            status: 'running' as const,
            parentId: 'parent-sig-id'
        };
        
        vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockImplementation((parentId) => {
            if (parentId === 'parent-sig-id') {
                return [activeSub];
            }
            return [];
        });

        const killSpy = vi.spyOn(subagentManager, 'killSubagent').mockImplementation(() => {});

        let sigIntHandler: Function | undefined;
        let sigTermHandler: Function | undefined;

        onSpy.mockImplementation((event, listener) => {
            if (event === 'SIGINT') sigIntHandler = listener;
            if (event === 'SIGTERM') sigTermHandler = listener;
            return process;
        });

        await interactiveDeveloperAgent({
            taskId: 'parent-sig-id',
            taskInstruction: 'Do something',
            auto: true,
        });

        // Verify registration
        expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

        // Verify unregistration
        expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
        expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

        // Verify the signal handler logic
        expect(sigIntHandler).toBeDefined();
        expect(sigTermHandler).toBeDefined();

        // Execute signal handler SIGINT
        sigIntHandler!();

        expect(killSpy).toHaveBeenCalledWith('sub-active-cleanup-sig');
        expect(exitSpy).toHaveBeenCalledWith(130);

        killSpy.mockClear();
        exitSpy.mockClear();

        // Execute signal handler SIGTERM
        sigTermHandler!();

        expect(killSpy).toHaveBeenCalledWith('sub-active-cleanup-sig');
        expect(exitSpy).toHaveBeenCalledWith(143);
    });

    it('does not create or register a timeout timer when timeoutMs is undefined or null', async () => {
        const setTimerSpy = vi.spyOn(global, 'setTimeout');
        const queue = new MessageQueue();
        queue.push({
            type: 'subagent_notification',
            content: 'Ready',
            timestamp: Date.now()
        });

        await waitForInputOrNotification(queue, 'Your answer:', '', undefined);
        const timeoutCalls = setTimerSpy.mock.calls.filter(call => call[1] !== 50);
        expect(timeoutCalls.length).toBe(0);
        
        setTimerSpy.mockRestore();
    });

    it('should only write ANSI escape sequences to stdout when it is a TTY', async () => {
        const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const originalIsTTY = process.stdout.isTTY;

        // Mock a MessageQueue with a subagent_notification ready
        const queue = new MessageQueue();
        queue.push({
            type: 'subagent_notification',
            content: 'Ready',
            timestamp: Date.now()
        });

        // 1. Test when isTTY is false
        process.stdout.isTTY = false;
        await waitForInputOrNotification(queue, 'Your answer:');
        expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining('\x1b[1A'));

        // 2. Test when isTTY is true
        process.stdout.isTTY = true;
        const queue2 = new MessageQueue();
        queue2.push({
            type: 'subagent_notification',
            content: 'Ready2',
            timestamp: Date.now()
        });
        await waitForInputOrNotification(queue2, 'Your answer:');
        expect(writeSpy).toHaveBeenCalledWith('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');

        // Restore
        process.stdout.isTTY = originalIsTTY;
        writeSpy.mockRestore();
    });

    it('should retry automatically on system error if running in subagent/auto mode', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: '[SYSTEM ERROR] failed to parse response',
                },
                actions: [],
                message: 'Turn 1 error',
                conversation_id: 'conv-retry-1',
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: 'TASK_COMPLETED: Recovered successfully',
                },
                actions: [],
                message: 'Turn 2 success',
                conversation_id: 'conv-retry-1',
            });

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-retry-task',
            auto: true,
        });

        expect(mockProvider.streamChat).toHaveBeenCalledTimes(2);
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('[SYSTEM ERROR] failed to parse response'),
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, summary: 'Recovered successfully' });
    });

    it('should complete task successfully when complete_task action is received', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'complete_task',
                    content: 'Detailed result of task execution',
                    summary: 'Task completed successfully.'
                },
                actions: [],
                message: 'Subagent completing task',
                conversation_id: 'conv-complete-1',
            });

        // Set parent ID to test subagent notification sending
        process.env.SHARK_PARENT_ID = 'parent-agent-id';
        process.env.SHARK_SUBAGENT_ROLE = 'Developer';

        const sendMessageSpy = vi.spyOn(subagentManager, 'sendMessage').mockImplementation(() => {});
        const updateSummarySpy = vi.spyOn(subagentManager, 'updateSubagentSummary').mockImplementation(() => {});

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-complete-task',
            auto: true,
        });

        expect(result).toEqual({ success: true, summary: 'Task completed successfully.' });
        expect(updateSummarySpy).toHaveBeenCalledWith('subagent-complete-task', 'Task completed successfully.');
        expect(sendMessageSpy).toHaveBeenCalledWith(
            'parent-agent-id',
            expect.stringContaining('[Subagent Notification] Subagent Developer (subagent-complete-task) completed.\nResult Details:\nDetailed result of task execution')
        );

        // Clean up environment variables
        delete process.env.SHARK_PARENT_ID;
        delete process.env.SHARK_SUBAGENT_ROLE;
    });

    it('should send notification to parent on talk_with_user when running as subagent', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: {
                type: 'talk_with_user',
                content: 'Bom dia! Estou pronto.\n\nTASK_COMPLETED: Respondi ao cumprimento',
            },
            actions: [],
            message: 'Talk to user',
            conversation_id: 'conv-sub-talk-1',
        });

        // Set parent ID to test subagent notification sending
        process.env.SHARK_PARENT_ID = 'parent-agent-id';
        process.env.SHARK_SUBAGENT_ROLE = 'Developer';

        const sendMessageSpy = vi.spyOn(subagentManager, 'sendMessage').mockImplementation(() => {});
        const updateSummarySpy = vi.spyOn(subagentManager, 'updateSubagentSummary').mockImplementation(() => {});

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-talk-task',
            auto: true,
        });

        expect(result).toEqual({ success: true, summary: 'Respondi ao cumprimento' });
        expect(updateSummarySpy).toHaveBeenCalledWith('subagent-talk-task', 'Respondi ao cumprimento');
        expect(sendMessageSpy).toHaveBeenCalledWith(
            'parent-agent-id',
            expect.stringContaining('[Subagent Notification] Subagent Developer (subagent-talk-task) completed.\nResult Details:\nBom dia! Estou pronto.')
        );

        // Clean up environment variables
        delete process.env.SHARK_PARENT_ID;
        delete process.env.SHARK_SUBAGENT_ROLE;
    });

    it('should send notification to parent on raw message TASK_COMPLETED when running as subagent', async () => {
        vi.mocked(mockProvider.streamChat).mockResolvedValueOnce({
            action: null,
            actions: [],
            message: 'Doing raw task.\n\nTASK_COMPLETED: Done raw task',
            conversation_id: 'conv-sub-raw-1',
        });

        // Set parent ID to test subagent notification sending
        process.env.SHARK_PARENT_ID = 'parent-agent-id';
        process.env.SHARK_SUBAGENT_ROLE = 'Developer';

        const sendMessageSpy = vi.spyOn(subagentManager, 'sendMessage').mockImplementation(() => {});
        const updateSummarySpy = vi.spyOn(subagentManager, 'updateSubagentSummary').mockImplementation(() => {});

        const result = await interactiveDeveloperAgent({
            taskId: 'subagent-raw-task',
            auto: true,
        });

        expect(result).toEqual({ success: true, summary: 'Done raw task' });
        expect(updateSummarySpy).toHaveBeenCalledWith('subagent-raw-task', 'Done raw task');
        expect(sendMessageSpy).toHaveBeenCalledWith(
            'parent-agent-id',
            expect.stringContaining('[Subagent Notification] Subagent Developer (subagent-raw-task) completed.\nResult Details:\nDoing raw task.')
        );

        // Clean up environment variables
        delete process.env.SHARK_PARENT_ID;
        delete process.env.SHARK_SUBAGENT_ROLE;
    });

    it('should handle notify_user action without blocking or waiting for user input', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'notify_user',
                    content: 'Background progress message'
                },
                actions: [],
                message: 'Notification turn',
                conversation_id: 'conv-notify-user'
            })
            .mockResolvedValueOnce({
                action: {
                    type: 'complete_task',
                    summary: 'Done after notification'
                },
                actions: [],
                message: 'Done',
                conversation_id: 'conv-notify-user'
            });

        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const result = await interactiveDeveloperAgent({
            taskInstruction: 'Notify and complete',
            auto: true
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Done after notification');
        expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('🤖 Shark Dev:'));
        expect(consoleSpy).toHaveBeenCalledWith('Background progress message');
        expect(mockProvider.streamChat).toHaveBeenNthCalledWith(2, expect.stringContaining('[Action notify_user Success]: Notificação exibida com sucesso para o usuário.'), expect.any(Object));

        consoleSpy.mockRestore();
    });

    it('should not exit on TASK_COMPLETED if parent has auto set to false', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'talk_with_user',
                    content: 'Here is explanation\n\nTASK_COMPLETED: Done first part',
                },
                actions: [],
                message: 'Here is explanation\n\nTASK_COMPLETED: Done first part',
                conversation_id: 'conv-parent-completed-interactive',
            });

        vi.mocked(tui.isCancel).mockReturnValueOnce(true);
        vi.mocked(tui.text).mockResolvedValueOnce('cancel');

        const result = await interactiveDeveloperAgent({
            taskInstruction: 'Do task with interactive continuation',
            auto: false,
        });

        expect(tui.text).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, summary: 'Done first part' });
    });

    it('should not exit on complete_task action if parent has auto set to false', async () => {
        vi.mocked(mockProvider.streamChat)
            .mockResolvedValueOnce({
                action: {
                    type: 'complete_task',
                    summary: 'Finished successfully',
                    content: 'Some details',
                },
                actions: [],
                message: 'Completed via action',
                conversation_id: 'conv-complete-action-interactive',
            });

        vi.mocked(tui.isCancel).mockReturnValueOnce(true);
        vi.mocked(tui.text).mockResolvedValueOnce('cancel');

        const result = await interactiveDeveloperAgent({
            taskInstruction: 'Do task with complete_task action',
            auto: false,
        });

        expect(tui.text).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ success: true, summary: 'Finished successfully' });
    });

    it('should handle /chat command, list conversations and switch conversation key', async () => {
        const fsMock = await import('node:fs');
        vi.mocked(fsMock.default.existsSync).mockReturnValue(true);
        vi.mocked(fsMock.default.readdirSync).mockReturnValue([
            'test-convo-123.raw.json' as any
        ]);
        vi.mocked(fsMock.default.statSync).mockReturnValue({
            mtime: new Date('2026-07-16T12:00:00Z')
        } as any);
        vi.mocked(fsMock.default.readFileSync).mockReturnValue(
            JSON.stringify([
                { role: 'system', content: 'system instructions' },
                { role: 'user', content: 'hello agent' },
                { role: 'assistant', content: 'hello user' }
            ])
        );

        const loadSpy = vi.spyOn(workflowManager, 'load').mockResolvedValue({
            projectId: '938a7487-8061-46dc-b592-2b655989c1e7',
            projectName: 'Test Project',
            techStack: 'nextjs',
            currentStage: 'business_analysis',
            stageStatus: 'pending',
            lastUpdated: '2026-01-09T19:48:58.866Z',
            conversations: {
                developer_agent: 'test-convo-123'
            },
            artifacts: []
        });

        const getRawHistorySpy = vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([
            { role: 'system', content: 'system instructions' },
            { role: 'user', content: 'hello agent' },
            { role: 'assistant', content: 'hello user' }
        ]);

        vi.mocked(tui.text)
            .mockResolvedValueOnce('/chat')
            .mockResolvedValueOnce('cancel'); // cancel prompt loop after command

        vi.mocked(tui.select).mockResolvedValueOnce('test-convo-123');
        vi.mocked(tui.isCancel).mockReturnValue(false);

        await interactiveDeveloperAgent({
            taskInstruction: undefined,
            auto: false
        });

        expect(tui.select).toHaveBeenCalled();
        expect(conversationManager.saveConversationId).toHaveBeenCalledWith(
            expect.any(String),
            'test-convo-123'
        );

        vi.mocked(fsMock.default.existsSync).mockReset();
        vi.mocked(fsMock.default.readdirSync).mockReset();
        vi.mocked(fsMock.default.statSync).mockReset();
        vi.mocked(fsMock.default.readFileSync).mockReset();
        loadSpy.mockRestore();
        getRawHistorySpy.mockRestore();
    });
});

