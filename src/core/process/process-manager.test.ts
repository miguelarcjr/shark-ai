import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ProcessManager } from './process-manager.js';

describe('ProcessManager', () => {
    let manager: ProcessManager;
    const testSession = 'test-session-' + Date.now();

    beforeEach(() => {
        manager = new ProcessManager();
    });

    afterEach(async () => {
        await manager.killAll();
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

    it('should spawn a short command, stream output to disk, and track line counts', async () => {
        const cmd = `node -e "console.log(\\"line 1\\"); console.log(\\"line 2\\"); console.log(\\"line 3\\");"`;
        const proc = await manager.spawn(cmd, { sessionId: testSession });

        expect(proc.id).toBeDefined();
        expect(proc.pid).toBeGreaterThan(0);
        expect(proc.status).toBe('running');
        expect(fs.existsSync(proc.logPath)).toBe(true);

        // Wait for process to finish
        let updated: any;
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            updated = manager.get(proc.id);
            if (updated?.status === 'completed') break;
        }
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('completed');
        expect(updated!.exitCode).toBe(0);
        expect(updated!.totalLines).toBeGreaterThanOrEqual(3);

        const content = fs.readFileSync(proc.logPath, 'utf-8');
        expect(content).toContain('line 1');
        expect(content).toContain('line 2');
        expect(content).toContain('line 3');
    });

    it('should list all managed processes for a session', async () => {
        const proc1 = await manager.spawn(`node -e "console.log(\\"p1\\");"`, { sessionId: testSession });
        const proc2 = await manager.spawn(`node -e "console.log(\\"p2\\");"`, { sessionId: testSession });

        const list = manager.list(testSession);
        expect(list.length).toBe(2);
        expect(list.map(p => p.id)).toContain(proc1.id);
        expect(list.map(p => p.id)).toContain(proc2.id);
    });

    it('should incrementally return new lines via poll()', async () => {
        const cmd = `node -e "console.log(\\"alpha\\"); setTimeout(() => console.log(\\"beta\\"), 500);"`;
        const proc = await manager.spawn(cmd, { sessionId: testSession });

        // Wait for alpha to appear in poll
        let poll1: any;
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            poll1 = await manager.poll(proc.id);
            if (poll1.newLines.some((l: string) => l.includes('alpha'))) break;
        }
        expect(poll1.newLines.some((l: string) => l.includes('alpha'))).toBe(true);

        // Immediate poll should not duplicate alpha
        const pollImmediate = await manager.poll(proc.id);
        expect(pollImmediate.newLines.length).toBe(0);

        // Wait for beta to appear in poll
        let poll2: any;
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            poll2 = await manager.poll(proc.id);
            if (poll2.newLines.some((l: string) => l.includes('beta'))) break;
        }
        expect(poll2.newLines.some((l: string) => l.includes('beta'))).toBe(true);
    });

    it('should retrieve sliced historical logs via getLogs()', async () => {
        const cmd = `node -e "for (let i = 1; i <= 10; i++) console.log(\\"entry \\" + i);"`;
        const proc = await manager.spawn(cmd, { sessionId: testSession });
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            const p = manager.get(proc.id);
            if (p?.status === 'completed') break;
        }

        // Tail logs
        const tail = await manager.getLogs(proc.id, { lines: 3 });
        expect(tail.lines.length).toBe(3);
        expect(tail.lines[tail.lines.length - 1]).toContain('entry 10');

        // Offset logs
        const slice = await manager.getLogs(proc.id, { offset: 0, lines: 2 });
        expect(slice.lines.length).toBe(2);
        expect(slice.lines[0]).toContain('entry 1');
        expect(slice.lines[1]).toContain('entry 2');
    });

    it('should terminate a long running process via kill()', async () => {
        const cmd = `node -e "setInterval(() => console.log(\\"alive\\"), 100);"`;
        const proc = await manager.spawn(cmd, { sessionId: testSession });

        expect(proc.status).toBe('running');
        await new Promise(resolve => setTimeout(resolve, 200));

        const killed = await manager.kill(proc.id);
        expect(killed).toBe(true);

        const updated = manager.get(proc.id);
        expect(updated?.status).toBe('killed');
    });

    it('should trigger onWatchPatternMatched callback when pattern matches', async () => {
        let matchedPattern = '';
        let matchedLine = '';

        const cmd = `node -e "console.log(\\"BOOTING...\\"); setTimeout(() => console.log(\\"PORT 4200 READY\\"), 200);"`;
        const proc = await manager.spawn(cmd, {
            sessionId: testSession,
            watchPatterns: ['PORT (\\d+) READY'],
            onWatchPatternMatched: (p, l) => {
                matchedPattern = p;
                matchedLine = l;
            }
        });

        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (matchedPattern) break;
        }

        expect(matchedPattern).toBe('PORT (\\d+) READY');
        expect(matchedLine).toContain('PORT 4200 READY');
    });

    it('should push notification to MessageQueue on process completion', async () => {
        const fakeQueue = {
            messages: [] as any[],
            push(msg: any) {
                this.messages.push(msg);
            }
        };
        manager.setMessageQueue(fakeQueue);

        const cmd = `node -e "console.log(\\"done\\");"`;
        await manager.spawn(cmd, {
            sessionId: testSession,
            notifyOnComplete: true
        });

        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (fakeQueue.messages.length > 0) break;
        }

        expect(fakeQueue.messages.length).toBeGreaterThan(0);
        const notification = fakeQueue.messages[0];
        expect(notification.type).toBe('process_notification');
        expect(notification.metadata?.status).toBe('completed');
    });

    it('should safely spawn processes when sessionId contains colons or special chars (Windows path safe)', async () => {
        const specialSession = 'whatsapp:dm:120363431367146933@g.us';
        const proc = await manager.spawn('node -e "console.log(\\"special\\");"', { sessionId: specialSession });

        expect(proc.id).toBeDefined();
        expect(fs.existsSync(proc.logPath)).toBe(true);
        expect(proc.logPath).not.toContain(':dm:');

        // Wait for process to complete
        let updated: any;
        for (let i = 0; i < 30; i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            updated = manager.get(proc.id);
            if (updated?.status === 'completed') break;
        }
        expect(updated?.status).toBe('completed');

        // Cleanup
        const safeSession = specialSession.replace(/[^a-zA-Z0-9_-]/g, '_');
        const logDir = path.resolve(process.cwd(), '.shark', 'processes', safeSession);
        if (fs.existsSync(logDir)) {
            fs.rmSync(logDir, { recursive: true, force: true });
        }
    });
});
