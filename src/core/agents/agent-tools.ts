
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { colors } from '../../ui/colors.js';
import { tui } from '../../ui/tui.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execa, type ExecaChildProcess } from 'execa';

const execAsync = promisify(exec);


/**
 * Shared tools for Agent interaction (File System, etc.)
 */


export function detectLineEnding(content: string): string {
    const crlf = content.split('\r\n').length - 1;
    const lf = content.split('\n').length - 1 - crlf;
    return crlf > lf ? '\r\n' : '\n';
}

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

export function handleReadFile(filePath: string, showLineNumbers: boolean = true): string {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) return `Error: File ${filePath} does not exist.`;

        // Limit size?
        const stats = fs.statSync(fullPath);
        if (stats.size > 100 * 1024) return `Error: File too large to read (${stats.size} bytes). Limit is 100KB.`;

        const content = fs.readFileSync(fullPath, 'utf-8');

        if (showLineNumbers) {
            const lines = content.split('\n');
            return lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
        }

        return content;
    } catch (e: any) {
        return `Error reading file: ${e.message}`;
    }
}

export function replaceLineRange(
    filePath: string,
    startLine: number, // 1-indexed
    endLine: number,   // 1-indexed
    newContent: string,
    tui: any
): boolean {
    try {
        if (!fs.existsSync(filePath)) {
            tui.log.error(`❌ File not found for modification: ${filePath}`);
            return false;
        }

        const currentFileContent = fs.readFileSync(filePath, 'utf-8');
        const lineEnding = detectLineEnding(currentFileContent);
        const lines = currentFileContent.split(lineEnding);

        // Validation
        if (startLine < 1 || startLine > lines.length) {
            tui.log.error(`❌ Invalid start line: ${startLine}. File has ${lines.length} lines.`);
            return false;
        }

        if (endLine < startLine || endLine > lines.length) {
            tui.log.error(`❌ Invalid end line: ${endLine}. Must be >= startLine and <= file length.`);
            return false;
        }

        // Replace lines [startLine-1, endLine-1]
        // Note: lines array is 0-indexed
        const before = lines.slice(0, startLine - 1);
        const after = lines.slice(endLine);
        const newLines = newContent.split(lineEnding); // Use detected line ending for new content splitting if provided with one, usually agent provides \n

        // If newContent comes from LLM, it likely has \n. We should split by \n and join by detected.
        // But wait, if newContent has \n and we join by \r\n, it works if we split newContent by \n.
        // If newContent already has \r\n, splitting by \n leaves \r.
        // Safe approach: Normalized split of new code.
        const normalizedNewLines = newContent.replace(/\r\n/g, '\n').split('\n');

        const result = [...before, ...normalizedNewLines, ...after].join(lineEnding);

        const BOM = '\uFEFF';
        const finalContent = result.startsWith(BOM) ? result : BOM + result;
        fs.writeFileSync(filePath, finalContent, { encoding: 'utf-8' });

        tui.log.success(`✅ Replaced lines ${startLine}-${endLine} in ${filePath}`);
        return true;

    } catch (e: any) {
        tui.log.error(`❌ Error replacing line range: ${e.message}`);
        return false;
    }
}

export async function generateFilePreview(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string
): Promise<string> {
    try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) return `Error: File ${filePath} does not exist.`;

        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split(/\r\n|\r|\n/);

        // 0-indexed adjustment
        const startIdx = startLine - 1;
        const endIdx = endLine - 1;

        if (startIdx < 0 || startIdx >= lines.length) return `Error: Start line ${startLine} is out of bounds (File has ${lines.length} lines).`;
        if (endIdx < startIdx || endIdx >= lines.length) return `Error: End line ${endLine} is invalid.`;

        const contextBefore = lines.slice(Math.max(0, startIdx - 3), startIdx).map((l, i) => `${Math.max(1, startLine - 3) + i} | ${l}`).join('\n');
        const contentReplacing = lines.slice(startIdx, endIdx + 1).map((l, i) => `${startLine + i} | - ${l}`).join('\n');
        const contextAfter = lines.slice(endIdx + 1, Math.min(lines.length, endIdx + 4)).map((l, i) => `${endLine + 1 + i} | ${l}`).join('\n');

        const newLines = newContent.split('\n').map(l => `+ ${l}`).join('\n');

        return `PREVIEW OF CHANGES to ${filePath}:
--------------------------------------------------
CONTEXT BEFORE:
${contextBefore}

CHANGES:
${contentReplacing}
${newLines}

CONTEXT AFTER:
${contextAfter}
--------------------------------------------------

IMPORTANT: Please verify that the lines being replaced (marked with -) are exactly what you intend to remove.
If the context looks wrong, DO NOT CONFIRM. Re-read the file to check line numbers.
`;
    } catch (e: any) {
        return `Error generating preview: ${e.message}`;
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

/**
 * Searches for a string or regex pattern within files matching a glob.
 * Works like VSCode's "Find in Files" — returns matching lines with file path and line number.
 * Use this instead of read_file when you only need to find specific symbols,
 * exports, method names, or patterns — avoiding flooding the context with full file contents.
 *
 * @param globPattern  Glob pattern to select files (e.g., "src/**‌/*.ts")
 * @param query        String or regex pattern to search for
 * @param isRegex      If true, treats query as a regular expression
 */
export function handleSearchCode(
    globPattern: string,
    query: string,
    isRegex: boolean = false
): string {
    const MAX_MATCHES = 50;
    const MAX_FILE_SIZE_BYTES = 500 * 1024; // skip files > 500KB

    if (!query || query.trim() === '') {
        return "Error: 'query' parameter is required for search_code";
    }

    try {
        // 1. Normalize slashes
        let pattern = (globPattern || '**/*').replace(/\\/g, '/').trim();

        // 2. Default to **/* if empty or "."
        if (pattern === '' || pattern === '.' || pattern === './') {
            pattern = '**/*';
        } else {
            // Check if pattern is a directory or lacks wildcards
            const fullPath = path.resolve(process.cwd(), pattern);
            if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                pattern = pattern.endsWith('/') ? `${pattern}**/*` : `${pattern}/**/*`;
            } else if (!pattern.includes('*') && !pattern.includes('?') && !fs.existsSync(fullPath)) {
                pattern = `${pattern}/**/*`;
            }
        }

        const defaultIgnores = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/coverage/**'
        ];

        const files = fg.sync(pattern, { dot: true, absolute: false, ignore: defaultIgnores });
        if (files.length === 0) return `No files found matching pattern: "${pattern}"`;

        let searchRegex: RegExp;
        try {
            searchRegex = isRegex
                ? new RegExp(query, 'gi')
                : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        } catch {
            return `Error: Invalid regex pattern: "${query}"`;
        }

        const results: string[] = [];
        let totalMatches = 0;

        for (const filePath of files) {
            if (totalMatches >= MAX_MATCHES) break;

            try {
                const fullPath = path.resolve(process.cwd(), filePath);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory() || stats.size > MAX_FILE_SIZE_BYTES) continue;

                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    if (totalMatches >= MAX_MATCHES) break;
                    searchRegex.lastIndex = 0; // reset for 'g' flag
                    if (searchRegex.test(lines[i])) {
                        results.push(`${filePath}:${i + 1}: ${lines[i].trim()}`);
                        totalMatches++;
                    }
                }
            } catch {
                // skip unreadable files silently
            }
        }

        if (results.length === 0) {
            return `No matches found for "${query}" in files matching "${pattern}"`;
        }

        const limited = totalMatches >= MAX_MATCHES ? ` (limited to ${MAX_MATCHES})` : '';
        return `Found ${totalMatches} match(es) for "${query}" in "${pattern}"${limited}:\n${results.join('\n')}`;

    } catch (e: any) {
        return `Error searching code: ${e.message}`;
    }
}

export function startSmartReplace(filePath: string, newContent: string, targetContent: string, tui: any): boolean {
    if (!fs.existsSync(filePath)) {
        tui.log.error(`❌ File not found for modification: ${filePath}`);
        return false;
    }

    const currentFileContent = fs.readFileSync(filePath, 'utf-8');

    // 1. Validation: Does target exist?
    // Normalize string for comparison to avoid CRLF issues during check
    const normalizedTarget = targetContent.replace(/\r\n/g, '\n');
    const normalizedContent = currentFileContent.replace(/\r\n/g, '\n');

    if (!normalizedContent.includes(normalizedTarget)) {
        tui.log.error(`❌ Target content not found in ${filePath} (checked with normalized line endings). Modification aborted.`);
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

let nextShellProcess: ExecaChildProcess | null = null;

export function prewarmShell() {
    const isWindows = process.platform === 'win32';
    const shell = isWindows
        ? (process.env.COMSPEC || 'cmd.exe')
        : (process.env.SHELL || 'sh');

    nextShellProcess = execa(shell, [], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        reject: false,
        buffer: true,
        cwd: process.cwd(),
        env: process.env
    });
}

// Clean up background shell on Node process exit
process.on('exit', () => {
    if (nextShellProcess) {
        try {
            nextShellProcess.kill();
        } catch {
            // Ignore errors on shutdown
        }
    }
});

export async function handleRunCommand(command: string): Promise<string> {
    try {
        tui.log.info(`💻 Executing: ${colors.dim(command)}`);

        if (!nextShellProcess) {
            prewarmShell();
        }
        const currentShell = nextShellProcess!;

        // Pre-warm the next process immediately in background
        prewarmShell();

        currentShell.stdin?.write(`${command}\nexit\n`);

        const { stdout, stderr } = await currentShell;
        const output = stdout.trim() || stderr.trim();
        return output || 'Command executed successfully (no output).';
    } catch (e: any) {
        return `Error executing command: ${e.message}`;
    }
}
