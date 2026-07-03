import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportSchemaCommand } from './export-schema.js';
import { COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA } from '../core/api/prompts.js';
import { tui } from '../ui/tui.js';

vi.mock('../ui/tui.js', () => ({
    tui: {
        select: vi.fn()
    }
}));

describe('Export Schema Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        exportSchemaCommand.args = [];
        (exportSchemaCommand as any).processedArgs = [];
    });

    it('should output the coordinator JSON Schema when coordinator argument is passed', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await exportSchemaCommand.parseAsync(['node', 'export-schema', 'coordinator']);

        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.title).toBe('AgentResponse');

        logSpy.mockRestore();
    });

    it('should output the subagent JSON Schema when subagent argument is passed', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await exportSchemaCommand.parseAsync(['node', 'export-schema', 'subagent']);

        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.title).toBe('SubagentResponse');

        logSpy.mockRestore();
    });

    it('should use TUI select menu when no arguments are provided', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(tui.select).mockResolvedValue('subagent');

        await exportSchemaCommand.parseAsync(['node', 'export-schema']);

        expect(tui.select).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.title).toBe('SubagentResponse');

        logSpy.mockRestore();
    });
});
