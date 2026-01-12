import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './config-manager.js';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os');

describe('ConfigManager', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        (ConfigManager as any).instance = null;
        process.env = {};

        // Default mocks
        vi.mocked(os.homedir).mockReturnValue('/home/test');
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readFileSync).mockReturnValue('{}');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load default config when no files or envs exist', () => {
        const config = ConfigManager.getInstance().getConfig();
        expect(config.logLevel).toBe('info');
        expect(config.language).toBe('pt-br');
    });

    it('should prioritized ENV vars over defaults', () => {
        process.env.SHARK_LOG_LEVEL = 'debug';

        const config = ConfigManager.getInstance().getConfig();
        expect(config.logLevel).toBe('debug');
    });
});
