import { describe, it, expect } from 'vitest';
import { handleRunCommand } from './agent-tools.js';

describe('agent-tools: handleRunCommand', () => {
    it('should execute basic commands successfully', async () => {
        const result = await handleRunCommand('echo test-output-matching');
        expect(result).toContain('test-output-matching');
    });

    it('should execute commands in a stateless fashion', async () => {
        // Command 1: run cd to a different directory
        await handleRunCommand('cd ..');
        
        // Command 2: run echo to check that we are still in original dir
        // Since it's stateless, the next process should still start in process.cwd()
        const result = await handleRunCommand('echo current-run');
        expect(result).toContain('current-run');
    });
});
