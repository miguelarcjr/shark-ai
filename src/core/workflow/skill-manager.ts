import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface SkillMetadata {
    name: string;
    description: string;
}

export class SkillManager {
    private activeSkills: Set<string> = new Set();
    private skillPrompts: Map<string, string> = new Map();

    parseSkillFrontmatter(content: string): Partial<SkillMetadata> {
        const match = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
        if (!match) return {};
        const yamlBlock = match[1];
        const result: Partial<SkillMetadata> = {};

        const nameMatch = yamlBlock.match(/(?:^|\n)name:\s*["']?([^"'\r\n]+)["']?/);
        if (nameMatch) {
            result.name = nameMatch[1].trim();
        }

        const descMatch = yamlBlock.match(/(?:^|\n)description:\s*(?:["']([\s\S]*?)["']|([^\r\n]+))/);
        if (descMatch) {
            result.description = (descMatch[1] || descMatch[2] || '').trim();
        }

        return result;
    }

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

        // Reset previous active skills to avoid collision/token waste
        this.reset();

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

    async listAvailableSkills(): Promise<string[]> {
        const metadata = await this.getAvailableSkillsMetadata();
        return metadata.map(m => m.name);
    }

    async getAvailableSkillsMetadata(): Promise<SkillMetadata[]> {
        const globalSkillsDir = path.join(os.homedir(), '.shark', 'skills');
        const localSkillsDir = path.join(process.cwd(), '.agents', 'skills');

        const skillsMap = new Map<string, SkillMetadata>();

        const scanDir = async (dir: string) => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
                        try {
                            const content = await fs.readFile(skillMdPath, 'utf-8');
                            const parsed = this.parseSkillFrontmatter(content);
                            const name = parsed.name || entry.name;
                            const description = parsed.description || '';
                            // Insert or update (local directory scanned later will override global)
                            skillsMap.set(entry.name, { name, description });
                        } catch {
                            // No SKILL.md or read error — silently skip
                        }
                    }
                }
            } catch {
                // Directory doesn't exist — silently skip
            }
        };

        // Scan global first, then local so local overrides global
        await scanDir(globalSkillsDir);
        await scanDir(localSkillsDir);

        return Array.from(skillsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }

    formatSkillsIndex(skills: SkillMetadata[]): string {
        if (!skills || skills.length === 0) return '';
        return skills
            .map(s => s.description ? `- **${s.name}**: ${s.description}` : `- **${s.name}**`)
            .join('\n');
    }

    reset() {
        this.activeSkills.clear();
        this.skillPrompts.clear();
    }
}

export const skillManager = new SkillManager();

