import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { skillManager } from './skill-manager.js';
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

describe('SkillManager', () => {
    const tempDir = path.join(os.tmpdir(), '.shark-test-skills-' + Date.now());
    const mockHome = path.join(tempDir, 'home');
    const mockCwd = path.join(tempDir, 'cwd');

    beforeAll(async () => {
        await fs.mkdir(mockHome, { recursive: true });
        await fs.mkdir(mockCwd, { recursive: true });

        // Set up mock home global skill
        const globalSkillDir = path.join(mockHome, '.shark', 'skills', 'test-global');
        await fs.mkdir(globalSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(globalSkillDir, 'SKILL.md'),
            '---\nname: test-global\ndescription: Global test\n---\n# Global Skill Content'
        );

        // Set up mock cwd local skill
        const localSkillDir = path.join(mockCwd, '.agents', 'skills', 'test-local');
        await fs.mkdir(localSkillDir, { recursive: true });
        await fs.writeFile(
            path.join(localSkillDir, 'SKILL.md'),
            '---\nname: test-local\ndescription: Local test\n---\n# Local Skill Content'
        );

        // Set up local skill that overrides global skill (name matches)
        const overrideLocalDir = path.join(mockCwd, '.agents', 'skills', 'test-override');
        await fs.mkdir(overrideLocalDir, { recursive: true });
        await fs.writeFile(
            path.join(overrideLocalDir, 'SKILL.md'),
            '---\nname: test-override\ndescription: Local override\n---\n# Override Local Content'
        );

        const overrideGlobalDir = path.join(mockHome, '.shark', 'skills', 'test-override');
        await fs.mkdir(overrideGlobalDir, { recursive: true });
        await fs.writeFile(
            path.join(overrideGlobalDir, 'SKILL.md'),
            '---\nname: test-override\ndescription: Global override\n---\n# Override Global Content'
        );
    });

    afterAll(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        skillManager.reset();
        vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
        vi.mocked(os.homedir).mockReturnValue(mockHome);
    });

    it('loads and parses skill instructions correctly', async () => {
        const globalSkillPath = path.join(mockHome, '.shark', 'skills', 'test-global', 'SKILL.md');
        const skillContent = await skillManager.loadSkillFromFile(globalSkillPath);
        expect(skillContent).toContain('# Global Skill Content');
        expect(skillContent).not.toContain('name: test-global');
    });

    it('activates local skill successfully', async () => {
        const prompt = await skillManager.activateSkill('test-local');
        expect(prompt).toContain('# Local Skill Content');
        
        const extension = skillManager.getSystemInstructionExtension();
        expect(extension).toContain('--- ACTIVE SKILL: test-local ---');
        expect(extension).toContain('# Local Skill Content');
    });

    it('activates global skill successfully', async () => {
        const prompt = await skillManager.activateSkill('test-global');
        expect(prompt).toContain('# Global Skill Content');

        const extension = skillManager.getSystemInstructionExtension();
        expect(extension).toContain('--- ACTIVE SKILL: test-global ---');
        expect(extension).toContain('# Global Skill Content');
    });

    it('prioritizes local skill over global skill when both exist', async () => {
        const prompt = await skillManager.activateSkill('test-override');
        expect(prompt).toContain('# Override Local Content');
        expect(prompt).not.toContain('# Override Global Content');
    });

    it('returns already active message on subsequent activations', async () => {
        const first = await skillManager.activateSkill('test-local');
        expect(first).toContain('# Local Skill Content');
        
        const second = await skillManager.activateSkill('test-local');
        expect(second).toBe('Skill test-local is already active.');
    });

    it('throws error when skill does not exist', async () => {
        await expect(skillManager.activateSkill('non-existent')).rejects.toThrow(
            "Skill 'non-existent' not found globally or locally."
        );
    });

    it('clears active skills when reset is called', async () => {
        await skillManager.activateSkill('test-local');
        expect(skillManager.getSystemInstructionExtension()).toContain('# Local Skill Content');

        skillManager.reset();
        expect(skillManager.getSystemInstructionExtension()).toBe('');
    });
});
