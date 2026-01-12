import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationManager } from './conversation-manager.js';
import { workflowManager } from './workflow-manager.js';

vi.mock('./workflow-manager.js');

describe('ConversationManager', () => {
    let conversationManager: ConversationManager;

    beforeEach(() => {
        vi.resetAllMocks();
        conversationManager = ConversationManager.getInstance();
    });

    it('should save conversation ID', async () => {
        const mockState = {
            projectId: 'test-id',
            projectName: 'Test Project',
            techStack: 'node-ts',
            currentStage: 'business_analysis',
            stageStatus: 'in-progress',
            lastUpdated: new Date().toISOString(),
        } as any;

        vi.mocked(workflowManager.load).mockResolvedValue(mockState);
        vi.mocked(workflowManager.save).mockResolvedValue();

        await conversationManager.saveConversationId('business_analyst', 'conv-123');

        expect(workflowManager.save).toHaveBeenCalledWith(
            expect.objectContaining({
                conversations: {
                    business_analyst: 'conv-123',
                },
            })
        );
    });

    it('should get conversation ID', async () => {
        const mockState = {
            conversations: {
                business_analyst: 'conv-abc',
                architect: 'conv-xyz',
            },
        } as any;

        vi.mocked(workflowManager.load).mockResolvedValue(mockState);

        const result = await conversationManager.getConversationId('business_analyst');
        expect(result).toBe('conv-abc');
    });

    it('should return undefined for non-existent conversation ID', async () => {
        const mockState = {
            conversations: {},
        } as any;

        vi.mocked(workflowManager.load).mockResolvedValue(mockState);

        const result = await conversationManager.getConversationId('unknown_agent');
        expect(result).toBeUndefined();
    });

    it('should clear specific conversation ID', async () => {
        const mockState = {
            conversations: {
                business_analyst: 'conv-abc',
                architect: 'conv-xyz',
            },
        } as any;

        vi.mocked(workflowManager.load).mockResolvedValue(mockState);
        vi.mocked(workflowManager.save).mockResolvedValue();

        await conversationManager.clearConversationId('business_analyst');

        expect(workflowManager.save).toHaveBeenCalledWith(
            expect.objectContaining({
                conversations: {
                    architect: 'conv-xyz',
                },
            })
        );
    });

    it('should clear all conversations', async () => {
        const mockState = {
            conversations: {
                business_analyst: 'conv-abc',
                architect: 'conv-xyz',
            },
        } as any;

        vi.mocked(workflowManager.load).mockResolvedValue(mockState);
        vi.mocked(workflowManager.save).mockResolvedValue();

        await conversationManager.clearAllConversations();

        expect(workflowManager.save).toHaveBeenCalledWith(
            expect.objectContaining({
                conversations: {},
            })
        );
    });

    it('should throw error when saving without workflow state', async () => {
        vi.mocked(workflowManager.load).mockResolvedValue(null);

        await expect(
            conversationManager.saveConversationId('test', 'conv-123')
        ).rejects.toThrow('No workflow state found');
    });
});
