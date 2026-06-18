import { describe, it, expect, vi, beforeEach } from 'vitest';
import { devCommand } from './dev.js';
import { interactiveDeveloperAgent } from '../core/agents/developer-agent.js';

vi.mock('../core/agents/developer-agent.js');

describe('Dev Command (Single Agent)', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        devCommand.setOptionValue('task', undefined);
        devCommand.setOptionValue('context', undefined);
        devCommand.setOptionValue('yes', undefined);
        devCommand.setOptionValue('auto', undefined);
        devCommand.setOptionValue('exportSchema', undefined);
        devCommand.setOptionValue('taskId', undefined);
    });

    it('should call interactiveDeveloperAgent with correct options (with -y)', async () => {
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

    it('should call interactiveDeveloperAgent with correct options (with --auto)', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({
            success: true,
            summary: 'Task completed'
        });

        await devCommand.parseAsync(['node', 'shark', 'dev', '-t', 'Build UI', '--auto']);

        expect(interactiveDeveloperAgent).toHaveBeenCalledWith(expect.objectContaining({
            taskInstruction: 'Build UI',
            auto: true
        }));
    });

    it('should exit with 1 on task failure', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({
            success: false,
            summary: 'Compilation failed'
        });

        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await devCommand.parseAsync(['node', 'shark', 'dev', '-t', 'Build UI']);

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errSpy).toHaveBeenCalledWith('Task execution failed:', 'Compilation failed');

        exitSpy.mockRestore();
        errSpy.mockRestore();
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

    it('should call interactiveDeveloperAgent with taskId option', async () => {
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({
            success: true,
            summary: 'Task completed'
        });

        await devCommand.parseAsync(['node', 'shark', 'dev', '--taskId', 'subagent-123']);

        expect(interactiveDeveloperAgent).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'subagent-123'
        }));
    });
});

