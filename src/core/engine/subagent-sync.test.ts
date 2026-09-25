import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatNotification, drainIncomingNotifications, formatActiveSubagentsPanel, terminateChildSubagents } from './subagent-sync.js';
import { MessageQueue } from '../workflow/message-queue.js';
import { subagentManager } from '../workflow/subagent-manager.js';

describe('SubagentSync', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('formatNotification', () => {
        it('wraps plain string into subagent_notification XML tag', () => {
            const formatted = formatNotification('Subagent finished step 1');
            expect(formatted).toBe('<subagent_notification status="completed">\nSubagent finished step 1\n</subagent_notification>');
        });

        it('detects failed status', () => {
            const formatted = formatNotification('Task execution failed with error');
            expect(formatted).toBe('<subagent_notification status="failed">\nTask execution failed with error\n</subagent_notification>');
        });

        it('preserves already formatted XML notifications', () => {
            const xml = '<subagent_notification status="cancelled">\nOperation cancelled\n</subagent_notification>';
            expect(formatNotification(xml)).toBe(xml);
        });
    });

    describe('drainIncomingNotifications', () => {
        it('drains both disk messages and queued memory messages', async () => {
            vi.spyOn(subagentManager, 'retrieveMessages').mockReturnValue(['disk message 1']);
            const queue = new MessageQueue();
            queue.push({ type: 'subagent_notification', content: 'memory message 1', timestamp: Date.now() });

            const result = await drainIncomingNotifications('parent', queue);
            expect(result.length).toBe(2);
            expect(result[0]).toContain('disk message 1');
            expect(result[1]).toContain('memory message 1');
            expect(queue.isEmpty()).toBe(true);
        });
    });

    describe('formatActiveSubagentsPanel', () => {
        it('returns empty string when there are no active subagents', () => {
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([]);
            const panel = formatActiveSubagentsPanel('parent');
            expect(panel).toBe('');
        });

        it('returns formatted panel when active subagents exist', () => {
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([
                { id: 'sub-1', role: 'tester', status: 'running', summary: 'running tests' } as any
            ]);
            const panel = formatActiveSubagentsPanel('parent');
            expect(panel).toContain('--- ACTIVE SUBAGENTS ---');
            expect(panel).toContain('ID: sub-1 | Role: tester | Status: running | Last Status: running tests');
        });
    });

    describe('terminateChildSubagents', () => {
        it('calls killSubagent on all active subagents for parent', () => {
            const killSpy = vi.spyOn(subagentManager, 'killSubagent').mockImplementation(() => {});
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([
                { id: 'sub-1' } as any,
                { id: 'sub-2' } as any
            ]);
            terminateChildSubagents('parent');
            expect(killSpy).toHaveBeenCalledTimes(2);
            expect(killSpy).toHaveBeenCalledWith('sub-1');
            expect(killSpy).toHaveBeenCalledWith('sub-2');
        });
    });
});
