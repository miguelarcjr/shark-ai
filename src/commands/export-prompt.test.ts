import { describe, it, expect, vi } from 'vitest';
import { exportPromptCommand } from './export-prompt.js';
import { UNIFIED_SYSTEM_PROMPT } from '../core/api/prompts.js';

describe('Export Prompt Command', () => {
    it('should output the unified system prompt to stdout', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        // Run command action
        exportPromptCommand.parse(['node', 'shark', 'export-prompt']);

        expect(logSpy).toHaveBeenCalledWith(UNIFIED_SYSTEM_PROMPT);

        logSpy.mockRestore();
    });
});
