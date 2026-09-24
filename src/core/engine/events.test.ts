import { describe, it, expect } from 'vitest';
import type { AgentInboundEvent, AgentOutboundEvent } from './events.js';

describe('Agent Events Contracts', () => {
    it('allows valid inbound user message construction', () => {
        const msg: AgentInboundEvent = {
            type: 'user_message',
            sessionId: 'test-session',
            text: 'Hello world',
            role: 'user',
            origin: { channelId: 'cli', senderId: 'local' }
        };
        expect(msg.type).toBe('user_message');
        expect(msg.sessionId).toBe('test-session');
    });

    it('allows valid action approval response event', () => {
        const approval: AgentInboundEvent = {
            type: 'action_approval_response',
            sessionId: 'test-session',
            approvalId: 'uuid-123',
            decision: 'approved'
        };
        expect(approval.type).toBe('action_approval_response');
    });

    it('allows valid outbound tool progress event', () => {
        const progress: AgentOutboundEvent = {
            type: 'tool_progress',
            sessionId: 'test-session',
            toolName: 'write_file',
            status: 'running',
            details: 'Writing index.ts'
        };
        expect(progress.type).toBe('tool_progress');
        expect(progress.toolName).toBe('write_file');
    });
});
