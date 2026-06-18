import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export interface SuperCommandOptions {
    local?: boolean;
}

export const superCommandAction = async (options: SuperCommandOptions = {}) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageRoot = path.resolve(__dirname, '../../');
    const internalSkillsPath = path.join(packageRoot, 'skills');

    const targetPath = options.local 
        ? path.join(process.cwd(), '.agents', 'skills')
        : path.join(os.homedir(), '.shark', 'skills');

    try {
        try {
            await fs.rm(targetPath, { recursive: true, force: true });
        } catch {
            // Ignore if it doesn't exist
        }
        await fs.mkdir(targetPath, { recursive: true });
        await fs.cp(internalSkillsPath, targetPath, { recursive: true, force: true });
        console.log(`🚀 Superpowers skills installed successfully to ${targetPath}`);
    } catch (error: any) {
        console.error(`❌ Failed to install superpowers skills: ${error.message}`);
        process.exit(1);
    }
};

export const superCommand = new Command('super')
    .description('Install Superpowers skills globally or locally')
    .option('-l, --local', 'Install skills locally in the current project under .agents/skills')
    .action(superCommandAction);
