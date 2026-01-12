import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrashHandler } from './crash-handler.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock fs and os
vi.mock('fs', () => ({
    default: {
        existsSync: vi.fn(),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn()
    }
}));
vi.mock('os', () => ({
    default: {
        homedir: vi.fn(() => '/home/user'),
        platform: vi.fn(() => 'linux'),
        release: vi.fn(() => '5.0.0'),
        arch: vi.fn(() => 'x64')
    }
}));

describe('CrashHandler', () => {
    let processOnSpy: any;
    let processExitSpy: any;
    let crashHandler: CrashHandler;

    beforeEach(() => {
        vi.resetAllMocks();

        // Mock OS
        vi.mocked(os.homedir).mockReturnValue('/home/user');
        vi.mocked(os.platform).mockReturnValue('linux');
        vi.mocked(os.release).mockReturnValue('5.0.0');
        vi.mocked(os.arch).mockReturnValue('x64');

        // Mock Process
        processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
        processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
            throw new Error(`Process.exit(${code}) called`);
        });

        // Get instance (singleton reset trick via prototype if needed, or valid assumptions)
        // Since singleton, we just get it. 
        // Note: In real unit tests singletons are tricky. 
        // We assume init() adds listeners.
        crashHandler = CrashHandler.getInstance();
    });

    afterEach(() => {
        processOnSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    it('should register event listeners on init', () => {
        crashHandler.init();
        expect(process.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
        expect(process.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });

    it('should write log file and exit on error', () => {
        // trigger handler manually
        const handleFn = (crashHandler as any).handleError.bind(crashHandler);
        const testError = new Error('Test Crash');

        // Mock fs exists check
        vi.mocked(fs.existsSync).mockReturnValue(false);

        try {
            handleFn(testError, 'Test Exception');
        } catch (e: any) {
            expect(e.message).toBe('Process.exit(1) called');
        }

        const expectedLogDir = path.join('/home/user', '.shark', 'logs');

        expect(fs.mkdirSync).toHaveBeenCalledWith(expectedLogDir, { recursive: true });
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('crash-'),
            expect.stringContaining('Test Crash'),
            'utf-8'
        );
        expect(process.exit).toHaveBeenCalledWith(1);
    });
});
