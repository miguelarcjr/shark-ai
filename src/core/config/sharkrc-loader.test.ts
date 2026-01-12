import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadSharkRC, SharkRCFileSchema } from './sharkrc-loader.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('fs');
vi.mock('os');

describe('SharkRC Loader', () => {
    const mockCwd = '/app';
    const mockHome = '/home/user';

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
        vi.mocked(os.homedir).mockReturnValue(mockHome);
    });

    it('should return empty object if no files exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        const config = loadSharkRC();
        expect(config).toEqual({});
    });

    it('should load global config', () => {
        const globalConfig = { project: 'global-project' };
        const expectedPath = path.join(mockHome, '.sharkrc');

        vi.mocked(fs.existsSync).mockImplementation((p) => p.toString() === expectedPath);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(globalConfig));

        const config = loadSharkRC();
        expect(config).toEqual(globalConfig);
    });

    it('should verify local overrides global', () => {
        const globalConfig = { project: 'global', logLevel: 'info' };
        const localConfig = { project: 'local' };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
            if (filePath.toString().includes('home')) return JSON.stringify(globalConfig);
            return JSON.stringify(localConfig);
        });

        const config = loadSharkRC();
        expect(config).toEqual({
            project: 'local',
            logLevel: 'info',
        });
    });

    it('should ignore invalid json gracefully', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

        // Should catch parsing error and return empty for that file
        const config = loadSharkRC();
        // Warns are logged but function returns valid object
        expect(config).toBeDefined();
    });
});
