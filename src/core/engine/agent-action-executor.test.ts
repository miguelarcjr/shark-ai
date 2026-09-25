import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentActionExecutor } from './agent-action-executor.js';
import type { AgentOutboundEvent } from './events.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('AgentActionExecutor', () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-executor');
    const testFile = path.resolve(testDir, 'test.txt');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\n');
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('emits tool_progress starting and completed when executing read_file', async () => {
        const emittedEvents: AgentOutboundEvent[] = [];
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: (ev) => emittedEvents.push(ev),
            sessionId: 'sess-test'
        });

        const result = await executor.executeAction({
            type: 'read_file',
            path: testFile
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('Line 1');

        const types = emittedEvents.map(e => e.type);
        expect(types).toContain('tool_progress');

        const progressEvents = emittedEvents.filter(e => e.type === 'tool_progress') as any[];
        expect(progressEvents.some(p => p.toolName === 'read_file' && p.status === 'starting')).toBe(true);
        expect(progressEvents.some(p => p.toolName === 'read_file' && p.status === 'completed')).toBe(true);
    });

    it('requests approval when sensitive action requires confirmation', async () => {
        const emittedEvents: AgentOutboundEvent[] = [];
        let approvalRequested = false;

        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: (ev) => emittedEvents.push(ev),
            sessionId: 'sess-test',
            autoApprove: false,
            requestApproval: async (toolName, args) => {
                approvalRequested = true;
                return true; // Aprovado
            }
        });

        const createdPath = path.resolve(testDir, 'created.txt');
        const result = await executor.executeAction({
            type: 'create_file',
            path: createdPath,
            content: 'Hello created'
        });

        expect(approvalRequested).toBe(true);
        expect(result.success).toBe(true);
        expect(fs.existsSync(createdPath)).toBe(true);
    });

    it('blocks execution when approval is denied', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test',
            autoApprove: false,
            requestApproval: async () => false // Rejeitado
        });

        const createdPath = path.resolve(testDir, 'denied.txt');
        const result = await executor.executeAction({
            type: 'create_file',
            path: createdPath,
            content: 'Should not create'
        });

        expect(result.success).toBe(false);
        expect(result.output).toContain('Aborted');
        expect(fs.existsSync(createdPath)).toBe(false);
    });
});
