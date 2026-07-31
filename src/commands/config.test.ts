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
            getConfig: () => ({
                provider: 'stackspot',
                language: 'pt-br',
                logLevel: 'info',
                memory: { compactionTokenLimit: 120000, enabled: false },
                stackspot: { agentId: '01KEQCGJ65YENRA4QBXVN1YFFX', useServerConversation: false }
            }),
            reloadConfig: vi.fn(),
        } as any);
    });

    it('should exit when user selects exit option', async () => {
        vi.mocked(tui.select).mockResolvedValueOnce('exit' as any);

        await configCommand.action();

        expect(tui.outro).toHaveBeenCalledWith('Configuration completed.');
        expect(saveGlobalRC).not.toHaveBeenCalled();
    });

    it('should update language under general category', async () => {
        vi.mocked(tui.select)
            .mockResolvedValueOnce('general' as any)
            .mockResolvedValueOnce('language' as any)
            .mockResolvedValueOnce('en-us' as any)
            .mockResolvedValueOnce('exit' as any);

        await configCommand.action();

        expect(saveGlobalRC).toHaveBeenCalledWith({ language: 'en-us' });
    });

    it('should update compaction token limit under memory category', async () => {
        vi.mocked(tui.select)
            .mockResolvedValueOnce('memory' as any)
            .mockResolvedValueOnce('tokenLimit' as any)
            .mockResolvedValueOnce('exit' as any);
        vi.mocked(tui.text).mockResolvedValueOnce('150000');

        await configCommand.action();

        expect(saveGlobalRC).toHaveBeenCalledWith({ memory: expect.objectContaining({ compactionTokenLimit: 150000 }) });
    });
});
