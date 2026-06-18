import { describe, it, expect, vi } from 'vitest';
import { subagentManager } from './subagent-manager.js';
import { interactiveDeveloperAgent } from '../agents/developer-agent.js';

vi.mock('../agents/developer-agent.js', () => ({
    interactiveDeveloperAgent: vi.fn()
}));

describe('SubagentManager', () => {
    it('registers and manages subagent status', () => {
        const id = 'test-id';
        subagentManager.registerSubagent(id, 'self', 'Tester');
        expect(subagentManager.isSubagentActive(id)).toBe(true);
        subagentManager.terminateSubagent(id);
        expect(subagentManager.isSubagentActive(id)).toBe(false);
    });

    it('sends and retrieves messages (mailbox)', () => {
        const subagentId = 'subagent-1';
        subagentManager.sendMessage(subagentId, 'Hello from parent!');
        subagentManager.sendMessage(subagentId, 'Are you done yet?');

        const messages = subagentManager.retrieveMessages(subagentId);
        expect(messages).toEqual(['Hello from parent!', 'Are you done yet?']);

        // Mailbox should be cleared after retrieval
        const emptyMessages = subagentManager.retrieveMessages(subagentId);
        expect(emptyMessages).toEqual([]);
    });

    it('defines and retrieves custom subagent types', () => {
        const name = 'code-writer';
        const description = 'Writes code';
        const systemPrompt = 'You are a code writer...';
        subagentManager.defineSubagentType(name, description, systemPrompt, {
            enableWriteTools: true,
            enableSubagentTools: false
        });

        const customType = subagentManager.getCustomSubagentType(name);
        expect(customType).toBeDefined();
        expect(customType?.name).toBe(name);
        expect(customType?.description).toBe(description);
        expect(customType?.systemPrompt).toBe(systemPrompt);
        expect(customType?.enableWriteTools).toBe(true);
        expect(customType?.enableSubagentTools).toBe(false);
    });

    it('lists and terminates active subagents', () => {
        const id1 = 'id-1';
        const id2 = 'id-2';
        subagentManager.registerSubagent(id1, 'self', 'Tester 1');
        subagentManager.registerSubagent(id2, 'self', 'Tester 2');

        let active = subagentManager.getActiveSubagents();
        expect(active.some(s => s.id === id1)).toBe(true);
        expect(active.some(s => s.id === id2)).toBe(true);

        subagentManager.killSubagent(id1);
        expect(subagentManager.isSubagentActive(id1)).toBe(false);
        expect(subagentManager.isSubagentActive(id2)).toBe(true);

        subagentManager.killAllSubagents();
        expect(subagentManager.isSubagentActive(id2)).toBe(false);
        expect(subagentManager.getActiveSubagents()).toEqual([]);
    });

    it('correctly tracks and filters active subagents by parentId', () => {
        const id1 = 'parent1-child1';
        const id2 = 'parent1-child2';
        const id3 = 'parent2-child1';
        
        subagentManager.registerSubagent(id1, 'self', 'Tester 1', 'parent1');
        subagentManager.registerSubagent(id2, 'self', 'Tester 2', 'parent1');
        subagentManager.registerSubagent(id3, 'self', 'Tester 3', 'parent2');
        
        const activeParent1 = subagentManager.getActiveSubagentsForParent('parent1');
        expect(activeParent1.length).toBe(2);
        expect(activeParent1.some(s => s.id === id1)).toBe(true);
        expect(activeParent1.some(s => s.id === id2)).toBe(true);
        expect(activeParent1.some(s => s.id === id3)).toBe(false);
        
        subagentManager.terminateSubagent(id1);
        const activeParent1PostTerminate = subagentManager.getActiveSubagentsForParent('parent1');
        expect(activeParent1PostTerminate.length).toBe(1);
        expect(activeParent1PostTerminate[0].id).toBe(id2);
    });

    it('sends notification to parent mailbox on subagent completion', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({ success: true, summary: 'Passed test checks' });
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';

        await subagentManager.invokeSubagents(subagents, parentId);
        
        // Wait briefly for the background promise to resolve
        await new Promise(resolve => setTimeout(resolve, 10));

        const parentMsgs = subagentManager.retrieveMessages(parentId);
        expect(parentMsgs.length).toBe(1);
        expect(parentMsgs[0]).toContain('[Subagent Notification]');
        expect(parentMsgs[0]).toContain('Tester');
        expect(parentMsgs[0]).toContain('Passed test checks');
    });

    it('sends notification to parent mailbox on subagent failure', async () => {
        vi.mocked(interactiveDeveloperAgent).mockRejectedValue(new Error('Simulated subagent failure'));
        const subagents = [{ TypeName: 'self', Role: 'Tester', Prompt: 'Verify code' }];
        const parentId = 'parent-test';

        await subagentManager.invokeSubagents(subagents, parentId);
        
        // Wait briefly for the background promise to resolve
        await new Promise(resolve => setTimeout(resolve, 10));

        const parentMsgs = subagentManager.retrieveMessages(parentId);
        expect(parentMsgs.length).toBe(1);
        expect(parentMsgs[0]).toContain('[Subagent Notification]');
        expect(parentMsgs[0]).toContain('Tester');
        expect(parentMsgs[0]).toContain('FAILED');
    });
});
