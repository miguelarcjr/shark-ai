import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { SessionWorkspaceManager } from './session-workspace-manager.js';

describe('SessionWorkspaceManager', () => {
    let tmpDir: string;
    let mockSkillsDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shark-ws-test-'));
        mockSkillsDir = path.join(tmpDir, 'mock-skills');
        await fs.mkdir(mockSkillsDir, { recursive: true });
        await fs.writeFile(path.join(mockSkillsDir, 'dummy-skill.md'), '# Dummy Skill');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('resolve corretamente nomes para DM e grupo sanitizando identificadores', () => {
        const manager = new SessionWorkspaceManager({ baseDir: tmpDir });

        const dm = manager.resolve('5511999999999@s.whatsapp.net');
        expect(dm.isGroup).toBe(false);
        expect(dm.dirName).toBe('user_5511999999999');
        expect(dm.fullPath).toBe(path.join(tmpDir, 'user_5511999999999'));
        expect(dm.exists).toBe(false);

        const group = manager.resolve('12036302837482910@g.us');
        expect(group.isGroup).toBe(true);
        expect(group.dirName).toBe('group_12036302837482910');
        expect(group.fullPath).toBe(path.join(tmpDir, 'group_12036302837482910'));
    });

    it('inicializa a estrutura do workspace sob demanda com skills, workflow e contexto', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        const progressMessages: string[] = [];
        const wsPath = await manager.ensureWorkspace('5511888888888@s.whatsapp.net', async (msg) => {
            progressMessages.push(msg);
        });

        expect(wsPath).toBe(path.join(tmpDir, 'user_5511888888888'));
        expect(progressMessages.length).toBeGreaterThan(0);

        // Verifica diretórios e arquivos criados
        const skillCopied = await fs.readFile(
            path.join(wsPath, '.agents', 'skills', 'dummy-skill.md'),
            'utf-8'
        );
        expect(skillCopied).toBe('# Dummy Skill');

        const gitignore = await fs.readFile(path.join(wsPath, '.gitignore'), 'utf-8');
        expect(gitignore).toContain('.shark/');

        const context = await fs.readFile(path.join(wsPath, '_sharkrc', 'project-context.md'), 'utf-8');
        expect(context).toContain('user_5511888888888');

        const workflowRaw = await fs.readFile(path.join(wsPath, '.shark', 'workflow.json'), 'utf-8');
        const workflow = JSON.parse(workflowRaw);
        expect(workflow.projectName).toBe('user_5511888888888');
        expect(workflow.techStack).toBe('node-ts');
    });

    it('reutiliza a inicialização sem recriar se o diretório já existir', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        await manager.ensureWorkspace('5511777777777@s.whatsapp.net');

        const progressMessages: string[] = [];
        await manager.ensureWorkspace('5511777777777@s.whatsapp.net', async (msg) => {
            progressMessages.push(msg);
        });

        // Não deve emitir mensagens de criação se já existe
        expect(progressMessages).toHaveLength(0);
    });

    it('gerencia concorrência com mutex compartilhado em chamadas simultâneas', async () => {
        const manager = new SessionWorkspaceManager({
            baseDir: tmpDir,
            skillsSourceDir: mockSkillsDir
        });

        const [res1, res2] = await Promise.all([
            manager.ensureWorkspace('5511666666666@s.whatsapp.net'),
            manager.ensureWorkspace('5511666666666@s.whatsapp.net')
        ]);

        expect(res1).toBe(res2);
    });
});
