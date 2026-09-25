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
});
