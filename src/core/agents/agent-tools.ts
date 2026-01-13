
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { colors } from '../../ui/colors.js';
import { tui } from '../../ui/tui.js';

/**
 * Shared tools for Agent interaction (File System, etc.)
 */

export function handleListFiles(dirPath: string): string {
    try {
        const fullPath = path.resolve(process.cwd(), dirPath);
        if (!fs.existsSync(fullPath)) return `Error: Directory ${dirPath} does not exist.`;

        const items = fs.readdirSync(fullPath, { withFileTypes: true });
        return items.map(item => {
            return `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`;
        }).join('\n');
    } catch (e: any) {
        return `Error listing files: ${e.message}`;
    }
}

export function handleReadFile(filePath: string): string {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) return `Error: File ${filePath} does not exist.`;

        // Limit size?
        const stats = fs.statSync(fullPath);
        if (stats.size > 100 * 1024) return `Error: File too large to read (${stats.size} bytes). Limit is 100KB.`;

        return fs.readFileSync(fullPath, 'utf-8');
    } catch (e: any) {
        return `Error reading file: ${e.message}`;
    }
}

export function handleSearchFile(pattern: string): string {
    try {
        // Limit scope to current directory for safety?
        // Patterns are relative to process.cwd()
        const entries = fg.sync(pattern, { dot: true });
        if (entries.length === 0) return 'No files found matching pattern.';
        return entries.slice(0, 50).join('\n');
    } catch (e: any) {
        return `Error searching files: ${e.message}`;
    }
}

export function startSmartReplace(filePath: string, newContent: string, targetContent: string, tui: any): boolean {
    if (!fs.existsSync(filePath)) {
        tui.log.error(`❌ File not found for modification: ${filePath}`);
        return false;
    }

    const currentFileContent = fs.readFileSync(filePath, 'utf-8');

    // 1. Validation: Does target exist?
    // Normalize line endings?
    if (!currentFileContent.includes(targetContent)) {
        tui.log.error(`❌ Target content not found in ${filePath}. Modification aborted.`);
        console.log(colors.dim('--- Target Content Expected ---'));
        console.log(targetContent.substring(0, 200) + '...');
        return false;
    }

    // 2. Validation: Is it unique?
    const occurrences = currentFileContent.split(targetContent).length - 1;
    if (occurrences > 1) {
        tui.log.error(`❌ Ambiguous target: Found ${occurrences} occurrences in ${filePath}. Modification aborted.`);
        return false;
    }

    // 3. Apply Replacement
    const BOM = '\uFEFF';
    const updatedContent = currentFileContent.replace(targetContent, newContent);
    const finalContent = updatedContent.startsWith(BOM) ? updatedContent : BOM + updatedContent;
    fs.writeFileSync(filePath, finalContent, { encoding: 'utf-8' });
    tui.log.success(`✅ Smart Replace Applied: ${filePath}`);
    return true;
}

export async function handleRunCommand(command: string): Promise<string> {
    const { spawn } = await import('node:child_process');
    try {
        tui.log.info(`💻 Executing: ${colors.dim(command)}`);

        // Split command into cmd and args (naive split, use specific parser if needed for complex quotes)
        // For simplicity in Agent usage, we might act as a shell?
        // Let's use shell: true option for ease of piping/env usage.

        return new Promise((resolve) => {
            const child = spawn(command, {
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: process.cwd()
            });

            let stdout = '';
            let stderr = '';

            // Timeout safety: 5 minutes
            const timer = setTimeout(() => {
                child.kill();
                resolve(`Error: Command timed out after 5 minutes.\nOutput so far:\n${stdout}\n${stderr}`);
            }, 5 * 60 * 1000);

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                // Optional: Stream to TUI if verbose?
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout.trim() || 'Command executed successfully (no output).');
                } else {
                    resolve(`Command failed with exit code ${code}.\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`);
                }
            });

            child.on('error', (err) => {
                clearTimeout(timer);
                resolve(`Error executing command: ${err.message}`);
            });
        });

    } catch (e: any) {
        return `Error launching command: ${e.message}`;
    }
}
