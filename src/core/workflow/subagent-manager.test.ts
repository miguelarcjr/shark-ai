import { describe, it, expect } from 'vitest';
import { subagentManager } from './subagent-manager.js';

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
});
