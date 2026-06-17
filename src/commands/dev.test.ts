import { describe, it, expect, vi, beforeEach } from 'vitest';
import { devCommand } from './dev.js';
import { interactiveDeveloperAgent } from '../core/agents/developer-agent.js';

vi.mock('../core/agents/developer-agent.js');

describe('Dev Command (Single Agent)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should call interactiveDeveloperAgent with correct options', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({
            success: true,
            summary: 'Task completed'
        });

        await devCommand.parseAsync(['node', 'shark', 'dev', '-t', 'Build UI', '-y']);

        expect(interactiveDeveloperAgent).toHaveBeenCalledWith(expect.objectContaining({
            taskInstruction: 'Build UI',
            auto: true
        }));
    });

    it('should output the JSON Schema when --export-schema is passed', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await devCommand.parseAsync(['node', 'shark', 'dev', '--export-schema']);

        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed).toHaveProperty('title', 'AgentResponse');

        logSpy.mockRestore();
    });
});
