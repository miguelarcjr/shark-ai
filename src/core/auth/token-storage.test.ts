import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tokenStorage } from './token-storage.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('fs');
vi.mock('os');

describe('TokenStorage', () => {
    const mockHomeDir = '/mock/home';
    const mockSharkDir = path.join(mockHomeDir, '.shark-ai');
    const mockCredentialsFile = path.join(mockSharkDir, 'credentials.json');

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
        vi.mocked(fs.existsSync).mockReturnValue(true);
        // Default empty credentials file
        vi.mocked(fs.readFileSync).mockReturnValue('{}');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete process.env.SHARK_ACCESS_TOKEN;
    });

    it('should get correct file path', () => {
        expect(tokenStorage.getFilePath()).toContain('.shark-ai');
        expect(tokenStorage.getFilePath()).toContain('credentials.json');
    });

    it('should create directory if not exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        tokenStorage.getFilePath();
        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.shark-ai'), { mode: 0o700 });
    });

    it('should save token and credentials to file', async () => {
        await tokenStorage.saveToken('test-realm', 'access-token', 'client-id', 'client-key', 3600);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('credentials.json'),
            expect.stringContaining('"accessToken": "access-token"'),
            { mode: 0o600 }
        );
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            expect.stringContaining('credentials.json'),
            expect.stringContaining('"clientId": "client-id"'),
            { mode: 0o600 }
        );
    });

    it('should get token from file', async () => {
        const mockData = {
            'test-realm': { accessToken: 'stored-token' }
        };
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

        const token = await tokenStorage.getToken('test-realm');
        expect(token).toBe('stored-token');
    });

    it('should prioritize SHARK_ACCESS_TOKEN env var', async () => {
        process.env.SHARK_ACCESS_TOKEN = 'env-token';
        const token = await tokenStorage.getToken('test-realm');
        expect(token).toBe('env-token');
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should return null if realm not found', async () => {
        vi.mocked(fs.readFileSync).mockReturnValue('{}');
        const token = await tokenStorage.getToken('non-existent');
        expect(token).toBeNull();
    });

    it('should delete token', async () => {
        const mockData = {
            'test-realm': { accessToken: 'stored-token' },
            'other-realm': { accessToken: 'other' }
        };
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

        const result = await tokenStorage.deleteToken('test-realm');

        expect(result).toBe(true);

        // precise verify of the call argument
        const callArgs = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenContent = JSON.parse(callArgs[1] as string);

        expect(writtenContent['test-realm']).toBeUndefined();
        expect(writtenContent['other-realm']).toBeDefined();
    });
});
