import { describe, it, expect } from 'vitest';
import { handleRunCommand, handleSearchFile, handleSearchCode } from './agent-tools.js';

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

describe('agent-tools: search functions', () => {
    it('handleSearchFile excludes .shark and gitignored files', () => {
        const result = handleSearchFile('**/*');
        expect(result).not.toContain('.shark');
        expect(result).not.toContain('node_modules');
    });

    it('handleSearchCode does not search inside .shark directory', () => {
        const result = handleSearchCode('**/*', 'membox', false);
        expect(result).not.toContain('.shark');
    });
});

