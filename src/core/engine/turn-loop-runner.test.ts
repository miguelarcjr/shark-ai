import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnLoopRunner } from './turn-loop-runner.js';
import { MessageQueue } from '../workflow/message-queue.js';

describe('TurnLoopRunner', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns development result when provider completes task with TASK_COMPLETED string', async () => {
        const mockProvider = {
            streamChat: vi.fn().mockResolvedValue({
                message: 'All done! TASK_COMPLETED: Finished building component'
            })
        };

        const mockContext = {
            dynamicSystemPrompt: 'prompt',
            basePrompt: 'task base',
            activeProvider: mockProvider,
            activeConversationId: 'c1',
            conversationKey: 'k1',
            mcpManager: { getAvailableTools: () => [] },
            forkReviewAgent: {
                onUserTurn: vi.fn(),
                onToolIteration: vi.fn(),
                maybeTriggerReview: vi.fn(),
                currentReviewPromise: undefined
            },
            updateDynamicPrompt: vi.fn()
        } as any;

        const actionExecutor = {
            executeAction: vi.fn()
        } as any;

        const result = await TurnLoopRunner.run({
            sessionId: 's1',
            projectRoot: process.cwd(),
            isBatchMode: true,
            messageQueue: new MessageQueue(),
            abortController: new AbortController(),
            actionExecutor,
            context: mockContext
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Finished building component');
    });

    it('handles complete_task action properly', async () => {
        const mockProvider = {
            streamChat: vi.fn().mockResolvedValue({
                action: {
                    type: 'complete_task',
                    args: { summary: 'Completed via action', content: 'Detailed info' }
                }
            })
        };

        const mockContext = {
            dynamicSystemPrompt: 'prompt',
            basePrompt: 'task base',
            activeProvider: mockProvider,
            activeConversationId: 'c1',
            conversationKey: 'k1',
            mcpManager: { getAvailableTools: () => [] },
            forkReviewAgent: {
                onUserTurn: vi.fn(),
                onToolIteration: vi.fn(),
                maybeTriggerReview: vi.fn(),
                currentReviewPromise: undefined
            },
            updateDynamicPrompt: vi.fn()
        } as any;

        const actionExecutor = {
            executeAction: vi.fn()
        } as any;

        const result = await TurnLoopRunner.run({
            sessionId: 's1',
            projectRoot: process.cwd(),
            isBatchMode: true,
            messageQueue: new MessageQueue(),
            abortController: new AbortController(),
            actionExecutor,
            context: mockContext
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Completed via action');
    });
});
