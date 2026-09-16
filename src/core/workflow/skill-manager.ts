import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../config-manager.js';

export interface SkillMetadata {
    name: string;
    description: string;
    isPinned?: boolean;
}

export interface SkillUsageMetadata {
    created_by: 'user' | 'agent';
    created_at: string;
    last_used_at: string;
    use_count: number;
    version?: number;
}

export interface SkillManageParams {
    action: 'create' | 'edit' | 'patch' | 'write_file' | 'remove_file' | 'delete';
    name: string;
    content?: string;
    file_path?: string;
    old_string?: string;
    new_string?: string;
    scope?: 'local' | 'global';
}

export interface PendingSkillChange {
    id: string;
    timestamp: string;
    params: SkillManageParams;
    summary: string;
}

export interface SkillManageResult {
    status: 'success' | 'pending' | 'error';
    message: string;
    pendingId?: string;
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

    interpolateTemplateVariables(content: string, skillDir: string, sessionId?: string): string {
        const normalizedSkillDir = skillDir.replace(/\\/g, '/');
        const activeSessionId = sessionId || 'default-session';
        return content
            .replace(/\$\{SHARK_SKILL_DIR\}/g, normalizedSkillDir)
            .replace(/\$\{HERMES_SKILL_DIR\}/g, normalizedSkillDir)
            .replace(/\$\{SHARK_SESSION_ID\}/g, activeSessionId)
            .replace(/\$\{HERMES_SESSION_ID\}/g, activeSessionId);
    }

    private async resolveSkillDir(skillName: string): Promise<{ skillDir: string; isLocal: boolean }> {
        const localPath = path.join(process.cwd(), '.agents', 'skills', skillName);
        const globalPath = path.join(os.homedir(), '.shark', 'skills', skillName);

        try {
            await fs.access(localPath);
            return { skillDir: localPath, isLocal: true };
        } catch {
            try {
                await fs.access(globalPath);
                return { skillDir: globalPath, isLocal: false };
            } catch {
                throw new Error(`Skill '${skillName}' not found globally or locally.`);
            }
        }
    }

    private async updateUsageMetadata(skillDir: string, createdBy: 'user' | 'agent' = 'user'): Promise<void> {
        const usagePath = path.join(skillDir, '.usage.json');
        const now = new Date().toISOString();
        let usage: SkillUsageMetadata = {
            created_by: createdBy,
            created_at: now,
            last_used_at: now,
            use_count: 0
        };

        try {
            const raw = await fs.readFile(usagePath, 'utf-8');
            usage = JSON.parse(raw);
            usage.last_used_at = now;
            usage.use_count = (usage.use_count || 0) + 1;
        } catch {
            usage.use_count = 1;
        }

        try {
            await fs.writeFile(usagePath, JSON.stringify(usage, null, 2), 'utf-8');
        } catch {
            // Ignore error if usage cannot be written
        }
    }

    async viewSkill(name: string, filePath?: string, sessionId?: string): Promise<string> {
        const { skillDir } = await this.resolveSkillDir(name);
        const relPath = filePath || 'SKILL.md';
        const targetPath = path.resolve(skillDir, relPath);

        // Security check: ensure targetPath is within skillDir
        if (!targetPath.startsWith(path.resolve(skillDir))) {
            throw new Error(`Access denied: path '${relPath}' escapes skill directory.`);
        }

        const rawContent = await fs.readFile(targetPath, 'utf-8');
        let processedContent = rawContent;
        if (relPath === 'SKILL.md' || relPath.endsWith('/SKILL.md')) {
            processedContent = rawContent.replace(/^---[\s\S]*?---\s*/, '');
        }

        const interpolated = this.interpolateTemplateVariables(processedContent, skillDir, sessionId);
        await this.updateUsageMetadata(skillDir);
        return interpolated;
    }

    async listSkills(query?: string): Promise<string> {
        const skillsMetadata = await this.getAvailableSkillsMetadata();
        let filtered = skillsMetadata;
        if (query && query.trim()) {
            const q = query.toLowerCase().trim();
            filtered = skillsMetadata.filter(s =>
                s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            return 'No skills found.';
        }

        return filtered
            .map(s => {
                const shortDesc = s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description;
                const descPart = shortDesc ? `: ${shortDesc}` : '';
                const pinnedPart = s.isPinned ? ' [pinned]' : '';
                return `- **${s.name}**${descPart}${pinnedPart}`;
            })
            .join('\n');
    }

    private getPinnedSkills(): string[] {
        try {
            const config = ConfigManager.getInstance().getConfig();
            return (config.skills as any)?.pinned || [];
        } catch {
            return [];
        }
    }

    private isWriteApprovalEnabled(): boolean {
        try {
            const config = ConfigManager.getInstance().getConfig();
            return (config.skills as any)?.write_approval === true;
        } catch {
            return false;
        }
    }

    async manageSkill(params: SkillManageParams): Promise<SkillManageResult> {
        if (!params.name || !/^[a-zA-Z0-9_-]+$/.test(params.name)) {
            return { status: 'error', message: `Invalid skill name '${params.name}'. Must be alphanumeric with dashes or underscores.` };
        }

        const targetScope = params.scope || 'local';
        const baseDir = targetScope === 'global'
            ? path.join(os.homedir(), '.shark', 'skills')
            : path.join(process.cwd(), '.agents', 'skills');

        const skillDir = path.join(baseDir, params.name);

        // Check pinned status
        const pinnedList = this.getPinnedSkills();
        if (pinnedList.includes(params.name)) {
            if (params.action === 'delete') {
                return {
                    status: 'error',
                    message: `Skill '${params.name}' is pinned and protected against deletion.`
                };
            }
        }

        // Check write approval
        if (this.isWriteApprovalEnabled()) {
            const pendingId = `chg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const pendingDir = path.join(process.cwd(), '.shark', 'pending', 'skills', pendingId);
            await fs.mkdir(pendingDir, { recursive: true });

            const pendingChange: PendingSkillChange = {
                id: pendingId,
                timestamp: new Date().toISOString(),
                params,
                summary: this.generateChangeSummary(params)
            };

            await fs.writeFile(path.join(pendingDir, 'request.json'), JSON.stringify(pendingChange, null, 2), 'utf-8');

            return {
                status: 'pending',
                pendingId,
                message: `Skill modification for '${params.name}' staged with ID '${pendingId}'. Waiting for user approval via '/skills approve ${pendingId}'.`
            };
        }

        // Execute immediately
        return this.executeSkillChange(params, baseDir, skillDir);
    }

    private generateChangeSummary(params: SkillManageParams): string {
        switch (params.action) {
            case 'create':
                return `Create new skill '${params.name}'`;
            case 'edit':
                return `Rewrite SKILL.md for '${params.name}'`;
            case 'patch':
                return `Patch SKILL.md for '${params.name}'`;
            case 'write_file':
                return `Write auxiliary file '${params.file_path}' in '${params.name}'`;
            case 'remove_file':
                return `Remove auxiliary file '${params.file_path}' from '${params.name}'`;
            case 'delete':
                return `Archive skill '${params.name}'`;
            default:
                return `Modify skill '${params.name}'`;
        }
    }

    private async executeSkillChange(
        params: SkillManageParams,
        baseDir: string,
        skillDir: string
    ): Promise<SkillManageResult> {
        try {
            switch (params.action) {
                case 'create': {
                    await fs.mkdir(skillDir, { recursive: true });
                    const skillMdPath = path.join(skillDir, 'SKILL.md');
                    await fs.writeFile(skillMdPath, params.content || '', 'utf-8');
                    await this.updateUsageMetadata(skillDir, 'agent');
                    return { status: 'success', message: `Skill '${params.name}' created successfully.` };
                }

                case 'edit': {
                    await fs.mkdir(skillDir, { recursive: true });
                    const skillMdPath = path.join(skillDir, 'SKILL.md');
                    await fs.writeFile(skillMdPath, params.content || '', 'utf-8');
                    await this.updateUsageMetadata(skillDir);
                    return { status: 'success', message: `Skill '${params.name}' updated successfully.` };
                }

                case 'patch': {
                    const skillMdPath = path.join(skillDir, 'SKILL.md');
                    let content = '';
                    try {
                        content = await fs.readFile(skillMdPath, 'utf-8');
                    } catch {
                        return { status: 'error', message: `SKILL.md not found in '${skillDir}'.` };
                    }

                    if (!params.old_string || !content.includes(params.old_string)) {
                        return { status: 'error', message: `old_string not found in SKILL.md of '${params.name}'.` };
                    }

                    const patched = content.replace(params.old_string, params.new_string || '');
                    await fs.writeFile(skillMdPath, patched, 'utf-8');
                    await this.updateUsageMetadata(skillDir);
                    return { status: 'success', message: `Skill '${params.name}' patched successfully.` };
                }

                case 'write_file': {
                    if (!params.file_path) {
                        return { status: 'error', message: 'file_path is required for write_file action.' };
                    }
                    const targetPath = path.resolve(skillDir, params.file_path);
                    if (!targetPath.startsWith(path.resolve(skillDir))) {
                        return { status: 'error', message: `Access denied: '${params.file_path}' escapes skill directory.` };
                    }

                    await fs.mkdir(path.dirname(targetPath), { recursive: true });
                    await fs.writeFile(targetPath, params.content || '', 'utf-8');
                    await this.updateUsageMetadata(skillDir);
                    return { status: 'success', message: `File '${params.file_path}' in skill '${params.name}' saved successfully.` };
                }

                case 'remove_file': {
                    if (!params.file_path) {
                        return { status: 'error', message: 'file_path is required for remove_file action.' };
                    }
                    const targetPath = path.resolve(skillDir, params.file_path);
                    if (!targetPath.startsWith(path.resolve(skillDir))) {
                        return { status: 'error', message: `Access denied: '${params.file_path}' escapes skill directory.` };
                    }

                    try {
                        await fs.unlink(targetPath);
                    } catch (e: any) {
                        return { status: 'error', message: `Failed to remove '${params.file_path}': ${e.message}` };
                    }
                    return { status: 'success', message: `File '${params.file_path}' removed from skill '${params.name}'.` };
                }

                case 'delete': {
                    try {
                        await fs.access(skillDir);
                    } catch {
                        return { status: 'error', message: `Skill '${params.name}' does not exist.` };
                    }

                    const archiveDir = path.join(baseDir, '.archive');
                    await fs.mkdir(archiveDir, { recursive: true });
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    const archiveTarget = path.join(archiveDir, `${params.name}_${timestamp}`);
                    await fs.rename(skillDir, archiveTarget);
                    return { status: 'success', message: `Skill '${params.name}' archived to .archive/${params.name}_${timestamp}.` };
                }

                default:
                    return { status: 'error', message: `Unknown skill action '${(params as any).action}'.` };
            }
        } catch (error: any) {
            return { status: 'error', message: `Failed to execute skill action '${params.action}': ${error.message}` };
        }
    }

    async listPending(): Promise<PendingSkillChange[]> {
        const pendingBase = path.join(process.cwd(), '.shark', 'pending', 'skills');
        const results: PendingSkillChange[] = [];
        try {
            const entries = await fs.readdir(pendingBase, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const reqFile = path.join(pendingBase, entry.name, 'request.json');
                    try {
                        const raw = await fs.readFile(reqFile, 'utf-8');
                        results.push(JSON.parse(raw));
                    } catch {
                        // Skip corrupted/empty pending request
                    }
                }
            }
        } catch {
            // Pending directory does not exist
        }
        return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    }

    async approvePending(id: string): Promise<string> {
        const pendingBase = path.join(process.cwd(), '.shark', 'pending', 'skills', id);
        const reqFile = path.join(pendingBase, 'request.json');
        let change: PendingSkillChange;
        try {
            const raw = await fs.readFile(reqFile, 'utf-8');
            change = JSON.parse(raw);
        } catch {
            throw new Error(`Pending skill change '${id}' not found.`);
        }

        const targetScope = change.params.scope || 'local';
        const baseDir = targetScope === 'global'
            ? path.join(os.homedir(), '.shark', 'skills')
            : path.join(process.cwd(), '.agents', 'skills');
        const skillDir = path.join(baseDir, change.params.name);

        const execResult = await this.executeSkillChange(change.params, baseDir, skillDir);
        if (execResult.status === 'error') {
            throw new Error(execResult.message);
        }

        await fs.rm(pendingBase, { recursive: true, force: true });
        return `Change '${id}' for skill '${change.params.name}' approved and applied: ${execResult.message}`;
    }

    async rejectPending(id: string): Promise<string> {
        const pendingBase = path.join(process.cwd(), '.shark', 'pending', 'skills', id);
        try {
            await fs.rm(pendingBase, { recursive: true, force: true });
            return `Change '${id}' rejected and removed from staging.`;
        } catch (e: any) {
            throw new Error(`Failed to reject pending change '${id}': ${e.message}`);
        }
    }

    async activateSkill(skillName: string): Promise<string> {
        if (this.activeSkills.has(skillName)) {
            return `Skill ${skillName} is already active.`;
        }

        // Backward compatibility: use viewSkill
        const prompt = await this.viewSkill(skillName);
        this.activeSkills.add(skillName);
        this.skillPrompts.set(skillName, prompt);
        return prompt;
    }

    getSystemInstructionExtension(): string {
        // Preserving prompt caching: return active skill extension if any, but default to empty string
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
        const pinnedList = this.getPinnedSkills();

        const scanDir = async (dir: string) => {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
                        try {
                            const content = await fs.readFile(skillMdPath, 'utf-8');
                            const parsed = this.parseSkillFrontmatter(content);
                            const name = parsed.name || entry.name;
                            const description = parsed.description || '';
                            const isPinned = pinnedList.includes(name) || pinnedList.includes(entry.name);
                            skillsMap.set(entry.name, isPinned ? { name, description, isPinned: true } : { name, description });
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
            .map(s => {
                const shortDesc = s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description;
                const descPart = shortDesc ? `: ${shortDesc}` : '';
                const pinnedPart = s.isPinned ? ' [pinned]' : '';
                return `- **${s.name}**${descPart}${pinnedPart}`;
            })
            .join('\n');
    }

    reset() {
        this.activeSkills.clear();
        this.skillPrompts.clear();
    }
}

export const skillManager = new SkillManager();
