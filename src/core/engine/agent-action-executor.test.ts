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

    it('executes process tool actions (list, log, kill) through executeAction', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-process-test'
        });

        // 1. Start a process via run_command with background: true
        const runRes = await executor.executeAction({
            type: 'run_command',
            args: {
                command: 'node -e "setInterval(() => console.log(\\"alive\\"), 200);"',
                background: true
            }
        });
        expect(runRes.success).toBe(true);
        expect(runRes.output).toContain('started in background');

        // Extract proc id
        const match = runRes.output.match(/proc_\d+/);
        expect(match).not.toBeNull();
        const procId = match![0];

        // 2. List processes
        const listRes = await executor.executeAction({
            type: 'process',
            args: { action: 'list' }
        });
        expect(listRes.success).toBe(true);
        expect(listRes.output).toContain(procId);

        // 3. Get logs
        const logRes = await executor.executeAction({
            type: 'process',
            args: { action: 'log', process_id: procId, lines: 5 }
        });
        expect(logRes.success).toBe(true);
        expect(logRes.output).toContain(`Process ${procId}`);

        // 4. Kill process
        const killRes = await executor.executeAction({
            type: 'process',
            args: { action: 'kill', process_id: procId }
        });
        expect(killRes.success).toBe(true);
        expect(killRes.output).toContain('terminated successfully');
    });

    it('emits media_attachment event when send_file is executed with existing file', async () => {
        const emittedEvents: AgentOutboundEvent[] = [];
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: (ev) => emittedEvents.push(ev),
            sessionId: 'sess-media-test'
        });

        const videoFile = path.resolve(testDir, 'recording.webm');
        fs.writeFileSync(videoFile, 'fake-webm-content');

        const result = await executor.executeAction({
            type: 'send_file',
            args: {
                path: videoFile,
                caption: 'Gravação da automação'
            }
        });

        expect(result.success).toBe(true);
        expect(result.output).toContain('video/webm');
        expect(result.output).toContain('recording.webm');

        const mediaEvent = emittedEvents.find(e => e.type === 'media_attachment') as any;
        expect(mediaEvent).toBeDefined();
        expect(mediaEvent.filePath).toBe(videoFile);
        expect(mediaEvent.mimeType).toBe('video/webm');
        expect(mediaEvent.caption).toBe('Gravação da automação');
        expect(mediaEvent.sessionId).toBe('sess-media-test');
    });

    it('returns failure output when send_file target does not exist', async () => {
        const emittedEvents: AgentOutboundEvent[] = [];
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: (ev) => emittedEvents.push(ev),
            sessionId: 'sess-media-test'
        });

        const result = await executor.executeAction({
            type: 'send_file',
            args: {
                path: path.resolve(testDir, 'non-existent.mp4')
            }
        });

        expect(result.output).toContain('Arquivo não encontrado');
        const mediaEvent = emittedEvents.find(e => e.type === 'media_attachment');
        expect(mediaEvent).toBeUndefined();
    });

    it('returns failure when read_file has empty path without incrementing recentReadCounts', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const result1 = await executor.executeAction({ type: 'read_file', args: {} });
        expect(result1.success).toBe(true); // executor wraps tool output
        expect(result1.output).toContain('[Action read_file Failed]: O parâmetro \'path\' é obrigatório');

        // Calling multiple times should not trigger redundant read block
        const result2 = await executor.executeAction({ type: 'read_file', args: { path: '   ' } });
        expect(result2.output).toContain('[Action read_file Failed]: O parâmetro \'path\' é obrigatório');
        expect(result2.output).not.toContain('Leitura redundante bloqueada');
    });

    it('returns failure when create_file, modify_file, or delete_file has empty path', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const rCreate = await executor.executeAction({ type: 'create_file', args: { content: 'test' } });
        expect(rCreate.output).toContain('[Action create_file Failed]: O parâmetro \'path\' é obrigatório');

        const rModify = await executor.executeAction({ type: 'modify_file', args: { content: 'test' } });
        expect(rModify.output).toContain('[Action modify_file Failed]: O parâmetro \'path\' é obrigatório');

        const rDelete = await executor.executeAction({ type: 'delete_file', args: {} });
        expect(rDelete.output).toContain('[Action delete_file Failed]: O parâmetro \'path\' é obrigatório');
    });

    it('defaults list_files to current directory when path is empty or whitespace', async () => {
        const executor = new AgentActionExecutor({
            projectRoot: testDir,
            emitOutbound: () => {},
            sessionId: 'sess-test'
        });

        const result = await executor.executeAction({ type: 'list_files', args: { path: '  ' } });
        expect(result.output).toContain('[Action list_files(.) Success]');
    });
});

