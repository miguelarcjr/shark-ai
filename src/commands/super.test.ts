import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { superCommand, superCommandAction } from './super.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

vi.mock('node:os', async (importOriginal) => {
    const original = await importOriginal<typeof import('node:os')>();
    const mockHomedir = vi.fn();
    return {
        ...original,
        homedir: mockHomedir,
        default: {
            ...original,
            homedir: mockHomedir,
        }
    };
});

describe('superCommand', () => {
    const tempDir = path.join(os.tmpdir(), '.shark-test-super-' + Date.now());
    const mockHome = path.join(tempDir, 'home');

    beforeAll(async () => {
        await fs.mkdir(mockHome, { recursive: true });
        vi.mocked(os.homedir).mockReturnValue(mockHome);
    });

    afterAll(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('is registered as a Commander Command with correct name and description', () => {
        expect(superCommand.name()).toBe('super');
        expect(superCommand.description()).toBe('Install Superpowers skills globally or locally');
    });

    it('copies the internal skills to the global home directory', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await superCommandAction();

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Superpowers skills installed successfully')
        );

        // Verify that global skills directory was created and contains brainstorming skill
        const targetPath = path.join(mockHome, '.shark', 'skills', 'brainstorming', 'SKILL.md');
        await expect(fs.access(targetPath)).resolves.not.toThrow();

        const content = await fs.readFile(targetPath, 'utf-8');
        expect(content).toContain('name: brainstorming');

        consoleLogSpy.mockRestore();
    });

    it('copies the internal skills to the local project directory when local option is true', async () => {
        const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const mockCwd = path.join(tempDir, 'project');
        await fs.mkdir(mockCwd, { recursive: true });
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);

        await superCommandAction({ local: true });

        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining('Superpowers skills installed successfully')
        );

        // Verify that local skills directory was created and contains brainstorming skill
        const targetPath = path.join(mockCwd, '.agents', 'skills', 'brainstorming', 'SKILL.md');
        await expect(fs.access(targetPath)).resolves.not.toThrow();

        cwdSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });
});
