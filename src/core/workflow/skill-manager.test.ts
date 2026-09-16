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

    describe('listAvailableSkills', () => {
        it('returns a sorted list of skills from both global and local directories', async () => {
            const skills = await skillManager.listAvailableSkills();
            expect(skills).toContain('test-global');
            expect(skills).toContain('test-local');
            expect(skills).toContain('test-override');
            // Verify sorted order
            const sorted = [...skills].sort();
            expect(skills).toEqual(sorted);
        });

        it('deduplicates skills present in both global and local directories', async () => {
            const skills = await skillManager.listAvailableSkills();
            const occurrences = skills.filter(s => s === 'test-override').length;
            expect(occurrences).toBe(1);
        });

        it('returns an empty array when no skill directories exist', async () => {
            // Point cwd and home to a directory with no skills
            const emptyDir = path.join(tempDir, 'empty');
            await fs.mkdir(emptyDir, { recursive: true });
            vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);
            vi.mocked(os.homedir).mockReturnValue(emptyDir);

            const skills = await skillManager.listAvailableSkills();
            expect(skills).toEqual([]);
        });
    });

    describe('getAvailableSkillsMetadata and formatSkillsIndex', () => {
        it('extracts metadata (name and description) from skills with frontmatter and respects local precedence', async () => {
            const metadata = await skillManager.getAvailableSkillsMetadata();
            expect(metadata).toEqual([
                { name: 'test-global', description: 'Global test' },
                { name: 'test-local', description: 'Local test' },
                { name: 'test-override', description: 'Local override' }
            ]);
        });

        it('formats skills index into rich markdown bullet points', () => {
            const skills = [
                { name: 'brainstorming', description: 'Explora ideias antes de codificar' },
                { name: 'tdd', description: 'Test driven development' }
            ];
            const formatted = skillManager.formatSkillsIndex(skills);
            expect(formatted).toBe(
                '- **brainstorming**: Explora ideias antes de codificar\n- **tdd**: Test driven development'
            );
        });

        it('returns empty string when formatting empty skills list', () => {
            expect(skillManager.formatSkillsIndex([])).toBe('');
        });
    });

    describe('Hermes Progressive Disclosure & Template Interpolation', () => {
        it('interpolates ${SHARK_SKILL_DIR} and ${SHARK_SESSION_ID}', () => {
            const template = 'Run: bash ${SHARK_SKILL_DIR}/scripts/test.sh --session ${SHARK_SESSION_ID}';
            const result = skillManager.interpolateTemplateVariables(template, '/path/to/skill', 'sess-123');
            expect(result).toBe('Run: bash /path/to/skill/scripts/test.sh --session sess-123');
        });

        it('listSkills returns compact 1-line index with pinned indicators and query filtering', async () => {
            // Mock pinned skill in ConfigManager
            const { ConfigManager } = await import('../config-manager.js');
            vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
                skills: {
                    pinned: ['test-local'],
                    write_approval: false,
                }
            } as any);

            const allSkills = await skillManager.listSkills();
            expect(allSkills).toContain('- **test-local**: Local test [pinned]');
            expect(allSkills).toContain('- **test-global**: Global test');

            const filtered = await skillManager.listSkills('global');
            expect(filtered).toContain('test-global');
            expect(filtered).not.toContain('test-local');
        });

        it('viewSkill loads SKILL.md, strips frontmatter, replaces template variables and updates .usage.json', async () => {
            // Add a skill with template variables
            const templatedSkillDir = path.join(mockCwd, '.agents', 'skills', 'test-templated');
            await fs.mkdir(templatedSkillDir, { recursive: true });
            await fs.writeFile(
                path.join(templatedSkillDir, 'SKILL.md'),
                '---\nname: test-templated\ndescription: Templated test\n---\nRun ${SHARK_SKILL_DIR}/run.sh in ${SHARK_SESSION_ID}'
            );

            const content = await skillManager.viewSkill('test-templated', undefined, 'sess-abc');
            const normalizedPath = templatedSkillDir.replace(/\\/g, '/');
            expect(content).toContain(`Run ${normalizedPath}/run.sh in sess-abc`);
            expect(content).not.toContain('---');

            // Verify .usage.json was created
            const usageRaw = await fs.readFile(path.join(templatedSkillDir, '.usage.json'), 'utf-8');
            const usage = JSON.parse(usageRaw);
            expect(usage.use_count).toBe(1);
            expect(usage.last_used_at).toBeDefined();
        });

        it('viewSkill loads auxiliary files from references/ or scripts/', async () => {
            const skillDir = path.join(mockCwd, '.agents', 'skills', 'test-aux');
            await fs.mkdir(path.join(skillDir, 'references'), { recursive: true });
            await fs.writeFile(
                path.join(skillDir, 'SKILL.md'),
                '---\nname: test-aux\ndescription: Aux test\n---\nMain content'
            );
            await fs.writeFile(
                path.join(skillDir, 'references', 'guide.md'),
                '# Auxiliary Guide'
            );

            const refContent = await skillManager.viewSkill('test-aux', 'references/guide.md');
            expect(refContent).toBe('# Auxiliary Guide');
        });
    });

    describe('Hermes skill_manage and Governance', () => {
        it('creates a new skill with create action including SKILL.md and .usage.json', async () => {
            const res = await skillManager.manageSkill({
                action: 'create',
                name: 'new-skill',
                content: '---\nname: new-skill\ndescription: A new skill\n---\n# New Skill Content',
                scope: 'local'
            });

            expect(res.status).toBe('success');
            const skillDir = path.join(mockCwd, '.agents', 'skills', 'new-skill');
            const skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
            expect(skillMd).toContain('# New Skill Content');

            const usage = JSON.parse(await fs.readFile(path.join(skillDir, '.usage.json'), 'utf-8'));
            expect(usage.created_by).toBe('agent');
        });

        it('patches SKILL.md surgically with old_string and new_string', async () => {
            const res = await skillManager.manageSkill({
                action: 'patch',
                name: 'new-skill',
                old_string: '# New Skill Content',
                new_string: '# Patched Skill Content',
                scope: 'local'
            });

            expect(res.status).toBe('success');
            const skillDir = path.join(mockCwd, '.agents', 'skills', 'new-skill');
            const skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
            expect(skillMd).toContain('# Patched Skill Content');
            expect(skillMd).not.toContain('# New Skill Content');
        });

        it('writes and removes auxiliary files with write_file and remove_file', async () => {
            const writeRes = await skillManager.manageSkill({
                action: 'write_file',
                name: 'new-skill',
                file_path: 'references/api.md',
                content: '# API Docs',
                scope: 'local'
            });
            expect(writeRes.status).toBe('success');

            const skillDir = path.join(mockCwd, '.agents', 'skills', 'new-skill');
            const apiContent = await fs.readFile(path.join(skillDir, 'references', 'api.md'), 'utf-8');
            expect(apiContent).toBe('# API Docs');

            const removeRes = await skillManager.manageSkill({
                action: 'remove_file',
                name: 'new-skill',
                file_path: 'references/api.md',
                scope: 'local'
            });
            expect(removeRes.status).toBe('success');
            await expect(fs.access(path.join(skillDir, 'references', 'api.md'))).rejects.toThrow();
        });

        it('blocks deletion of pinned skills', async () => {
            const { ConfigManager } = await import('../config-manager.js');
            vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
                skills: {
                    pinned: ['test-local'],
                    write_approval: false,
                }
            } as any);

            const res = await skillManager.manageSkill({
                action: 'delete',
                name: 'test-local',
                scope: 'local'
            });

            expect(res.status).toBe('error');
            expect(res.message).toContain('pinned and protected against deletion');
        });

        it('deletes unpinned skill by moving it to .archive/<name>_<timestamp>', async () => {
            const { ConfigManager } = await import('../config-manager.js');
            vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
                skills: {
                    pinned: [],
                    write_approval: false,
                }
            } as any);

            const res = await skillManager.manageSkill({
                action: 'delete',
                name: 'new-skill',
                scope: 'local'
            });

            expect(res.status).toBe('success');
            const skillDir = path.join(mockCwd, '.agents', 'skills', 'new-skill');
            await expect(fs.access(skillDir)).rejects.toThrow();

            const archiveDir = path.join(mockCwd, '.agents', 'skills', '.archive');
            const entries = await fs.readdir(archiveDir);
            expect(entries.some(e => e.startsWith('new-skill_'))).toBe(true);
        });

        it('stages modification in quarantine when write_approval: true and supports approval/rejection', async () => {
            const { ConfigManager } = await import('../config-manager.js');
            vi.spyOn(ConfigManager.getInstance(), 'getConfig').mockReturnValue({
                skills: {
                    pinned: [],
                    write_approval: true,
                }
            } as any);

            const res = await skillManager.manageSkill({
                action: 'create',
                name: 'quarantine-skill',
                content: '# Staged Content',
                scope: 'local'
            });

            expect(res.status).toBe('pending');
            expect(res.pendingId).toBeDefined();

            const pendingList = await skillManager.listPending();
            expect(pendingList.length).toBeGreaterThan(0);
            expect(pendingList.some(p => p.id === res.pendingId)).toBe(true);

            // Approve pending change
            const approveRes = await skillManager.approvePending(res.pendingId!);
            expect(approveRes).toContain('approved and applied');

            // Verify skill now exists
            const skillDir = path.join(mockCwd, '.agents', 'skills', 'quarantine-skill');
            const content = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
            expect(content).toContain('# Staged Content');
        });
    });
});

