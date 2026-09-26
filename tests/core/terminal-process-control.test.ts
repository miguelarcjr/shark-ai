import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentActionExecutor } from '../../src/core/engine/agent-action-executor.js';
import { ProcessManager } from '../../src/core/process/process-manager.js';
import { MessageQueue } from '../../src/core/workflow/message-queue.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('End-to-End Terminal & Background Process Control Integration', () => {
    const testSession = 'e2e-session-' + Date.now();
    let messageQueue: MessageQueue;
    let executor: AgentActionExecutor;

    beforeEach(() => {
        messageQueue = new MessageQueue();
        executor = new AgentActionExecutor({
            sessionId: testSession,
            emitOutbound: () => {},
            messageQueue
        });
    });

    afterEach(async () => {
        await ProcessManager.getInstance().killAll();
        // Clean test logs
        const logDir = path.resolve(process.cwd(), '.shark', 'processes', testSession);
        if (fs.existsSync(logDir)) {
            try {
                fs.rmSync(logDir, { recursive: true, force: true });
            } catch {
                // ignore
            }
        }
    });

    it('manages full lifecycle: spawn background -> watch pattern -> poll -> log -> write -> kill -> queue notify', async () => {
        // 1. Spawn a mock interactive server in background
        const cmd = `node -e "console.log(\\"SERVER BOOTING...\\"); setTimeout(() => console.log(\\"SERVER READY ON PORT 3000\\"), 200); process.stdin.on(\\"data\\", (data) => console.log(\\"RECEIVED INPUT: \\" + data.toString().trim())); setInterval(() => {}, 1000);"`;

        const startRes = await executor.executeAction({
            type: 'run_command',
            args: {
                command: cmd,
                background: true,
                watch_patterns: ['SERVER READY ON PORT (\\d+)'],
                notify_on_complete: true
            }
        });

        expect(startRes.success).toBe(true);
        expect(startRes.output).toContain('started in background');

        const procMatch = startRes.output.match(/proc_\d+/);
        expect(procMatch).not.toBeNull();
        const procId = procMatch![0];

        // 2. List processes via process tool
        const listRes = await executor.executeAction({
            type: 'process',
            args: { action: 'list' }
        });
        expect(listRes.success).toBe(true);
        expect(listRes.output).toContain(procId);
        expect(listRes.output).toContain('RUNNING');

        // 3. Poll new lines until server ready message appears
        let pollRes: any;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            pollRes = await executor.executeAction({
                type: 'process',
                args: { action: 'poll', process_id: procId }
            });
            if (pollRes.output.includes('SERVER READY ON PORT 3000')) break;
        }
        expect(pollRes.output).toContain('SERVER READY ON PORT 3000');

        // 4. Send interactive input via write
        const writeRes = await executor.executeAction({
            type: 'process',
            args: { action: 'write', process_id: procId, data: 'HELLO_SHARK' }
        });
        expect(writeRes.success).toBe(true);

        // 5. Read log history with pagination
        let logRes: any;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            logRes = await executor.executeAction({
                type: 'process',
                args: { action: 'log', process_id: procId, lines: 10 }
            });
            if (logRes.output.includes('RECEIVED INPUT: HELLO_SHARK')) break;
        }
        expect(logRes.output).toContain('RECEIVED INPUT: HELLO_SHARK');
        expect(logRes.output).toContain('Total:');

        // 6. Terminate process via kill
        const killRes = await executor.executeAction({
            type: 'process',
            args: { action: 'kill', process_id: procId }
        });
        expect(killRes.success).toBe(true);
        expect(killRes.output).toContain('terminated successfully');

        // 7. Verify ProcessManager shows killed/completed
        const info = ProcessManager.getInstance().get(procId);
        expect(info?.status).toBe('killed');

        // 8. MessageQueue should contain process exit notification
        let foundNotification = false;
        while (!messageQueue.isEmpty()) {
            const msg = await messageQueue.next();
            if (msg.type === 'process_notification') {
                foundNotification = true;
                break;
            }
        }
        expect(foundNotification).toBe(true);
    });
});
