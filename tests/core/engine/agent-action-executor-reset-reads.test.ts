import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentActionExecutor } from '../../../src/core/engine/agent-action-executor.js';

describe('AgentActionExecutor - Read Count Reset on Compaction', () => {
    let tmpDir: string;
    let executor: AgentActionExecutor;
    const testFile = 'test-file.txt';

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shark-executor-test-'));
        fs.writeFileSync(path.join(tmpDir, testFile), 'Line 1\nLine 2\nLine 3\n', 'utf-8');
        executor = new AgentActionExecutor({
            projectRoot: tmpDir,
            autoApprove: true,
            emitOutbound: () => {}
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should block read_file on 3rd attempt, but allow reading again after resetReadCounts', async () => {
        // 1st read -> Success
        const res1 = await executor.executeAction({ type: 'read_file', args: { path: testFile } });
        expect(res1.output).toContain('[Action read_file(test-file.txt) Success');

        // 2nd read -> Success with LOOP NOTICE
        const res2 = await executor.executeAction({ type: 'read_file', args: { path: testFile } });
        expect(res2.output).toContain('LOOP NOTICE');

        // 3rd read -> Blocked
        const res3 = await executor.executeAction({ type: 'read_file', args: { path: testFile } });
        expect(res3.output).toContain('[Action read_file(test-file.txt) Blocked]');

        // Simulate context compaction: reset read counts
        executor.resetReadCounts();

        // 4th read (post-compaction) -> Allowed again!
        const res4 = await executor.executeAction({ type: 'read_file', args: { path: testFile } });
        expect(res4.output).toContain('[Action read_file(test-file.txt) Success');
        expect(res4.output).not.toContain('Blocked');
    });
});
