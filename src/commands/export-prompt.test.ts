import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportPromptCommand } from './export-prompt.js';
import { UNIFIED_SYSTEM_PROMPT, SUBAGENT_SYSTEM_PROMPT } from '../core/api/prompts.js';
import { tui } from '../ui/tui.js';

vi.mock('../ui/tui.js', () => ({
    tui: {
        select: vi.fn()
    }
}));

describe('Export Prompt Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        exportPromptCommand.args = [];
        (exportPromptCommand as any).processedArgs = [];
    });

    it('should output the coordinator prompt when coordinator argument is passed', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await exportPromptCommand.parseAsync(['node', 'export-prompt', 'coordinator']);

        expect(logSpy).toHaveBeenCalledWith(UNIFIED_SYSTEM_PROMPT);

        logSpy.mockRestore();
    });

    it('should output the subagent prompt when subagent argument is passed', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await exportPromptCommand.parseAsync(['node', 'export-prompt', 'subagent']);

        expect(logSpy).toHaveBeenCalledWith(SUBAGENT_SYSTEM_PROMPT);

        logSpy.mockRestore();
    });

    it('should use TUI select menu when no arguments are provided', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(tui.select).mockResolvedValue('subagent');

        await exportPromptCommand.parseAsync(['node', 'export-prompt']);

        expect(tui.select).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledWith(SUBAGENT_SYSTEM_PROMPT);

        logSpy.mockRestore();
    });
});
