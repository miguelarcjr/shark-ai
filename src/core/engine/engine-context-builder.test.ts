import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineContextBuilder } from './engine-context-builder.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';

describe('EngineContextBuilder', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('prepares engine context with prompts, managers and conversation ids', async () => {
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
        vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_123');

        const context = await EngineContextBuilder.prepare({
            projectRoot: process.cwd(),
            sessionId: 'sess_1',
            taskInstruction: 'Do something awesome'
        });

        expect(context.activeConversationId).toBe('conv_123');
        expect(context.conversationKey).toBe('session_sess_1');
        expect(context.activeProvider.id).toBe('mock-provider');
        expect(context.basePrompt).toContain('Do something awesome');
        expect(context.dynamicSystemPrompt).toBeDefined();
        expect(typeof context.updateDynamicPrompt).toBe('function');

        await context.mcpManager.closeAll();
    });

    it('prepares initial turn with EXECUTION MODE when history is empty', async () => {
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
        vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_new');
        const { HistoryManager } = await import('../workflow/history-manager.js');
        vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([]);

        const context = await EngineContextBuilder.prepare({
            projectRoot: process.cwd(),
            sessionId: 'sess_new',
            taskInstruction: 'Initial Task'
        });

        expect(context.basePrompt).toContain('🟢 EXECUTION MODE');
        expect(context.basePrompt).toContain('Initial Task');

        await context.mcpManager.closeAll();
    });

    it('prepares continuation turn with clean raw instruction when history exists', async () => {
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
        vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_existing');
        const { HistoryManager } = await import('../workflow/history-manager.js');
        vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([
            { role: 'user', content: 'previous message' } as any
        ]);

        const context = await EngineContextBuilder.prepare({
            projectRoot: process.cwd(),
            sessionId: 'sess_existing',
            taskInstruction: 'Follow up question'
        });

        expect(context.basePrompt).toBe('Follow up question');
        expect(context.basePrompt).not.toContain('EXECUTION MODE');

        await context.mcpManager.closeAll();
    });

    it('keeps structured execution prompt for subagents even if history exists', async () => {
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
        vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_subagent');
        const { HistoryManager } = await import('../workflow/history-manager.js');
        vi.spyOn(HistoryManager, 'getRawHistory').mockResolvedValue([
            { role: 'user', content: 'prior context' } as any
        ]);

        const context = await EngineContextBuilder.prepare({
            projectRoot: process.cwd(),
            taskId: 'subagent-worker-1',
            taskInstruction: 'Subagent Task'
        });

        expect(context.basePrompt).toContain('🟢 EXECUTION MODE');
        expect(context.basePrompt).toContain('Subagent Task');

        await context.mcpManager.closeAll();
    });
});
