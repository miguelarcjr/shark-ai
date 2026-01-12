import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tui } from './tui.js';
import * as p from '@clack/prompts';

vi.mock('@clack/prompts');

describe('TUI Wrapper', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Mock process.exit to prevent test runner termination
        vi.spyOn(process, 'exit').mockImplementation((() => { }) as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should call p.intro with styled title', () => {
        tui.intro('Hello');
        expect(p.intro).toHaveBeenCalled();
    });

    it('should call p.text and return value', async () => {
        vi.mocked(p.text).mockResolvedValue('user input');
        const result = await tui.text({ message: 'Type something' });
        expect(result).toBe('user input');
    });

    it('should exit process on cancel', async () => {
        // Simulate symbol return for cancel
        vi.mocked(p.text).mockResolvedValue(Symbol('clack:cancel'));
        vi.mocked(p.isCancel).mockReturnValue(true);

        await tui.text({ message: 'Cancel me' });

        expect(p.cancel).toHaveBeenCalled();
        expect(process.exit).toHaveBeenCalledWith(0);
    });
});
