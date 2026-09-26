import { describe, it, expect, afterEach } from 'vitest';
import { handleRunCommand } from './agent-tools.js';
import { ProcessManager } from '../process/process-manager.js';

describe('handleRunCommand enhancements', () => {
    const testSession = 'test-tools-' + Date.now();

    afterEach(async () => {
        await ProcessManager.getInstance().killAll();
    });

    it('should execute short command synchronously and return output', async () => {
        const output = await handleRunCommand(`node -e "console.log(\\"fast execution\\");"`, {
            sessionId: testSession
        });
        expect(output).toContain('fast execution');
    });

    it('should launch command in background when background: true', async () => {
        const output = await handleRunCommand(`node -e "setInterval(() => console.log(\\"tick\\"), 200);"`, {
            background: true,
            sessionId: testSession
        });

        expect(output).toContain('started in background');
        expect(output).toContain('proc_');

        const list = ProcessManager.getInstance().list(testSession);
        expect(list.some(p => p.status === 'running')).toBe(true);
    });

    it('should automatically promote long-running command to background on timeout', async () => {
        // Sleep 4 seconds, but timeout is 1 second
        const cmd = `node -e "console.log(\\"booting...\\"); setTimeout(() => console.log(\\"done\\"), 4000);"`;
        const output = await handleRunCommand(cmd, {
            timeoutSeconds: 1,
            sessionId: testSession
        });

        expect(output).toContain('promoted to background');
        expect(output).toContain('proc_');

        const list = ProcessManager.getInstance().list(testSession);
        expect(list.some(p => p.status === 'running')).toBe(true);
    });

    it('should immediately promote to background when watch_pattern triggers without waiting full timeout', async () => {
        const startTime = Date.now();
        const cmd = `node -e "console.log(\\"STARTING\\"); setTimeout(() => console.log(\\"READY_ON_PORT_8080\\"), 300); setTimeout(() => console.log(\\"end\\"), 10000);"`;

        const output = await handleRunCommand(cmd, {
            timeoutSeconds: 10,
            watchPatterns: ['READY_ON_PORT_\\d+'],
            sessionId: testSession
        });

        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(4000); // Promoted well before 10s timeout
        expect(output).toContain('promoted to background');
        expect(output).toContain('proc_');
    });
});
