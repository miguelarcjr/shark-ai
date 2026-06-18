import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export class SkillManager {
    private activeSkills: Set<string> = new Set();
    private skillPrompts: Map<string, string> = new Map();

    async loadSkillFromFile(filePath: string): Promise<string> {
        const content = await fs.readFile(filePath, 'utf-8');
        // Strip frontmatter
        const cleanContent = content.replace(/^---[\s\S]*?---\s*/, '');
        return cleanContent;
    }

    async activateSkill(skillName: string): Promise<string> {
        if (this.activeSkills.has(skillName)) {
            return `Skill ${skillName} is already active.`;
        }

        const globalPath = path.join(os.homedir(), '.shark', 'skills', skillName, 'SKILL.md');
        const localPath = path.join(process.cwd(), '.agents', 'skills', skillName, 'SKILL.md');

        let skillPath = '';
        try {
            await fs.access(localPath);
            skillPath = localPath;
        } catch {
            try {
                await fs.access(globalPath);
                skillPath = globalPath;
            } catch {
                throw new Error(`Skill '${skillName}' not found globally or locally.`);
            }
        }

        const prompt = await this.loadSkillFromFile(skillPath);
        this.activeSkills.add(skillName);
        this.skillPrompts.set(skillName, prompt);
        return prompt;
    }

    getSystemInstructionExtension(): string {
        if (this.activeSkills.size === 0) return '';
        let extension = '\n\n<EXTREMELY_IMPORTANT>\n';
        for (const [name, prompt] of this.skillPrompts.entries()) {
            extension += `\n--- ACTIVE SKILL: ${name} ---\n${prompt}\n`;
        }
        extension += '\n</EXTREMELY_IMPORTANT>\n';
        return extension;
    }

    reset() {
        this.activeSkills.clear();
        this.skillPrompts.clear();
    }
}

export const skillManager = new SkillManager();
