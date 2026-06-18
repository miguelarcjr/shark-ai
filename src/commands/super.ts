import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export const superCommandAction = async () => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const packageRoot = path.resolve(__dirname, '../../');
    const internalSkillsPath = path.join(packageRoot, 'skills');

    const globalSkillsPath = path.join(os.homedir(), '.shark', 'skills');

    try {
        await fs.mkdir(globalSkillsPath, { recursive: true });
        await fs.cp(internalSkillsPath, globalSkillsPath, { recursive: true });
        console.log(`🚀 Superpowers skills installed successfully to ${globalSkillsPath}`);
    } catch (error: any) {
        console.error(`❌ Failed to install superpowers skills: ${error.message}`);
        process.exit(1);
    }
};

export const superCommand = new Command('super')
    .description('Install Superpowers skills globally')
    .action(superCommandAction);
