import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configCommand } from './config.js';
import { tui } from '../ui/tui.js';
import { ConfigManager } from '../core/config-manager.js';
import { saveGlobalRC } from '../core/config/sharkrc-loader.js';

vi.mock('../ui/tui.js');
vi.mock('../core/config-manager.js');
vi.mock('../core/config/sharkrc-loader.js');

describe('Config Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(tui.isCancel).mockReturnValue(false);
        vi.mocked(ConfigManager.getInstance).mockReturnValue({
            getConfig: () => ({ project: 'old-project', language: 'en-us', logLevel: 'info' }),
            reloadConfig: vi.fn(),
        } as any);
    });

    it('should exit if user selects exit', async () => {
        vi.mocked(tui.select).mockResolvedValue('exit' as any);

        await configCommand.action();

        expect(tui.outro).toHaveBeenCalledWith('Configuration unchanged.');
        expect(saveGlobalRC).not.toHaveBeenCalled();
    });

    it('should update project if selected', async () => {
        vi.mocked(tui.select).mockResolvedValueOnce('project');
        vi.mocked(tui.text).mockResolvedValue('new-project');

        await configCommand.action();

        expect(saveGlobalRC).toHaveBeenCalledWith({ project: 'new-project' });
        expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('new-project'));
    });

    it('should handle cancel during selection', async () => {
        vi.mocked(tui.select).mockResolvedValue('project');
        vi.mocked(tui.isCancel).mockReturnValueOnce(false).mockReturnValueOnce(true); // cancel on text input
        vi.mocked(tui.text).mockResolvedValue(Symbol('cancel') as any);

        await configCommand.action();

        expect(saveGlobalRC).not.toHaveBeenCalled();
    });
});
