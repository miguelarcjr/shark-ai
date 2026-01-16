
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { colors } from '../../ui/colors.js';
import { tui } from '../../ui/tui.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CodeEditorFactory } from '../ast-editing/editors/code-editor-factory.js';
import { CodeStructure } from '../ast-editing/interfaces/structure.types.js';

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

import { CodeReviewService } from '../services/code-review.service.js';

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

        // INTEGRATE CODE REVIEW AGENT
        let reviewFeedback = '';
        try {
            reviewFeedback = await CodeReviewService.reviewCode(filePath, newContent);
        } catch (err) {
            reviewFeedback = `⚠️ Code Review Service Unavailable: ${(err as any).message}`;
        }

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
${reviewFeedback}

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


/**
 * Resolves the ast-grep command to use.
 * Priorities:
 * 1. Package-local node_modules binary (for global installs)
 * 2. CWD node_modules binary (for local dev)
 * 3. Fallback to 'npx sg'
 */
function resolveAstGrepCommand(): string {
    const isWin = process.platform === 'win32';
    const binName = isWin ? 'sg.cmd' : 'sg';

    // 1. Try to find binary relative to THIS file (package root)
    try {
        const currentFile = fileURLToPath(import.meta.url);
        // Go up until we find package root or hit root
        let dir = path.dirname(currentFile);

        // Simple heuristic: walk up up to 5 levels to find node_modules
        // When bundled, we might be in dist/ or dist/bin/
        for (let i = 0; i < 5; i++) {
            const candidate = path.join(dir, 'node_modules', '.bin', binName);
            if (fs.existsSync(candidate)) {
                return `"${candidate}"`;
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    } catch (e) {
        // Ignore errors resolving path
    }

    // 2. Try CWD (User's project)
    const cwdBin = path.resolve(process.cwd(), 'node_modules', '.bin', binName);
    if (fs.existsSync(cwdBin)) {
        return `"${cwdBin}"`;
    }

    // 3. Fallback
    return 'npx sg';
}

/**
 * Executes ast-grep search via local CLI.
 * Returns the raw output (JSON usually requested by consumer) or error message.
 */
export async function astGrepSearch(
    pattern: string,
    filePath: string,
    language: string,
    tui: any
): Promise<string> {
    const { spawn } = await import('node:child_process');
    try {
        if (!fs.existsSync(filePath)) {
            return `❌ File not found: ${filePath}`;
        }

        // Resolve sg command robustly
        const sgCmd = resolveAstGrepCommand();
        const cmd = `${sgCmd} run -p "${pattern}" -l ${language} --json ${filePath}`;

        tui.log.info(`🔍 [AST-GREP] Searching: ${cmd}`);

        return new Promise((resolve) => {
            const child = spawn(cmd, {
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: process.cwd(),
                env: { ...process.env, NO_COLOR: 'true' } // Avoid ANSI codes in JSON output
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => stdout += data.toString());
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                if (code === 0 && stdout) {
                    resolve(stdout);
                } else if (code === 1 && !stderr) {
                    // ast-grep finds simply nothing
                    resolve("No structural matches found.");
                } else {
                    // Real error or no matches with empty stdout
                    if (!stdout && !stderr) resolve("No structural matches found.");
                    else {
                        tui.log.error(`❌ ast-grep search error (code ${code}): ${stderr}`);
                        resolve(`Error executing ast-grep search: ${stderr || stdout}`);
                    }
                }
            });

            child.on('error', (err) => {
                resolve(`Error executing ast-grep search: ${err.message}`);
            });
        });

    } catch (e: any) {
        tui.log.error(`❌ ast-grep search exception: ${e.message}`);
        return `Error executing ast-grep search: ${e.message}`;
    }
}

/**
 * Executes ast-grep rewrite via local CLI.
 * Returns boolean success/failure.
 */
export async function astGrepRewrite(
    pattern: string,
    fix: string,
    filePath: string,
    language: string,
    tui: any
): Promise<boolean> {
    const { spawn } = await import('node:child_process');
    try {
        if (!fs.existsSync(filePath)) {
            tui.log.error(`❌ File not found for AST modification: ${filePath}`);
            return false;
        }

        // Resolve sg command robustly
        const sgCmd = resolveAstGrepCommand();
        const cmd = `${sgCmd} run -p "${pattern}" -r "${fix}" -l ${language} ${filePath} --update-all`;

        tui.log.info(`✏️ [AST-GREP] Rewriting: pattern="${pattern}" fix="${fix.substring(0, 50)}..."`);

        return new Promise((resolve) => {
            const child = spawn(cmd, {
                shell: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                cwd: process.cwd()
            });

            let stderr = '';
            child.stderr.on('data', (data) => stderr += data.toString());

            child.on('close', (code) => {
                if (code === 0) {
                    tui.log.success(`✅ AST Rewrite applied to ${filePath}`);
                    resolve(true);
                } else {
                    tui.log.error(`❌ AST Rewrite failed (code ${code}): ${stderr}`);
                    resolve(false);
                }
            });

            child.on('error', (err) => {
                tui.log.error(`❌ AST Rewrite spawn error: ${err.message}`);
                resolve(false);
            });
        });

    } catch (e: any) {
        tui.log.error(`❌ Unexpected error in astGrepRewrite: ${e.message}`);
        return false;
    }
}

// ═══════════════════════════════════════════════════════
// AST TOOLS IMPLEMENTATION
// ═══════════════════════════════════════════════════════

/**
 * AST Tool: List file structure
 */
export async function astListStructure(filePath: string): Promise<string> {
    try {
        const editor = CodeEditorFactory.getEditor(filePath);

        if (!editor) {
            return `[AST Error] File type not supported: ${filePath}. Use read_file instead.`;
        }

        const structure: CodeStructure = await editor.listStructure(filePath);

        // Format for LLM consumption
        let output = `[AST Structure of ${filePath}]\n\n`;

        // Classes
        if (structure.classes.length > 0) {
            output += `CLASSES:\n`;
            structure.classes.forEach(cls => {
                output += `  - ${cls.name}`;
                if (cls.extendsClass) output += ` extends ${cls.extendsClass}`;
                if (cls.implementsInterfaces.length > 0) {
                    output += ` implements ${cls.implementsInterfaces.join(', ')}`;
                }
                output += `\n`;

                if (cls.decorators.length > 0) {
                    output += `    Decorators: ${cls.decorators.join(', ')}\n`;
                }

                if (cls.properties.length > 0) {
                    output += `    Properties:\n`;
                    cls.properties.forEach(prop => {
                        output += `      - ${prop.visibility} ${prop.name}: ${prop.type}\n`;
                    });
                }

                if (cls.methods.length > 0) {
                    output += `    Methods:\n`;
                    cls.methods.forEach(method => {
                        const params = method.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
                        output += `      - ${method.visibility} ${method.name}(${params}): ${method.returnType}\n`;
                    });
                }
                output += `\n`;
            });
        }

        // Interfaces
        if (structure.interfaces.length > 0) {
            output += `INTERFACES:\n`;
            structure.interfaces.forEach(iface => {
                output += `  - ${iface.name}\n`;
                iface.properties.forEach(prop => {
                    output += `      ${prop.name}: ${prop.type}\n`;
                });
            });
            output += `\n`;
        }

        // Functions
        if (structure.functions.length > 0) {
            output += `FUNCTIONS:\n`;
            structure.functions.forEach(fn => {
                const params = fn.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
                output += `  - ${fn.name}(${params}): ${fn.returnType}\n`;
            });
            output += `\n`;
        }

        // Imports
        if (structure.imports.length > 0) {
            output += `IMPORTS:\n`;
            structure.imports.forEach(imp => {
                output += `  - from "${imp.modulePath}": ${imp.namedImports.join(', ')}\n`;
            });
        }

        return output;
    } catch (error: any) {
        return `[AST Error] ${error.message}`;
    }
}

export async function astAddMethod(
    filePath: string,
    className: string,
    methodCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addMethod(filePath, className, methodCode);
}

export async function astAddClass(
    filePath: string,
    className: string,
    extendsClass?: string,
    implementsInterfaces?: string[]
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addClass(filePath, className, { extendsClass, implementsInterfaces });
}

export async function astAddProperty(
    filePath: string,
    className: string,
    propertyCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addProperty(filePath, className, propertyCode);
}

export async function astRemoveProperty(
    filePath: string,
    className: string,
    propertyName: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.removeProperty(filePath, className, propertyName);
}

export async function astModifyMethod(
    filePath: string,
    className: string,
    methodName: string,
    newBody: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.modifyMethod(filePath, className, methodName, newBody);
}

export async function astRemoveMethod(
    filePath: string,
    className: string,
    methodName: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.removeMethod(filePath, className, methodName);
}

export async function astAddDecorator(
    filePath: string,
    className: string,
    decoratorCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addDecorator(filePath, className, decoratorCode);
}

export async function astAddInterface(
    filePath: string,
    interfaceCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addInterface(filePath, interfaceCode);
}

export async function astAddTypeAlias(
    filePath: string,
    typeCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addTypeAlias(filePath, typeCode);
}

export async function astAddFunction(
    filePath: string,
    functionCode: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addFunction(filePath, functionCode);
}

export async function astRemoveFunction(
    filePath: string,
    functionName: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.removeFunction(filePath, functionName);
}

export async function astAddImport(
    filePath: string,
    importStatement: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.addImport(filePath, importStatement);
}

export async function astRemoveImport(
    filePath: string,
    modulePath: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.removeImport(filePath, modulePath);
}

export async function astOrganizeImports(
    filePath: string
): Promise<boolean> {
    const editor = CodeEditorFactory.getEditor(filePath);
    if (!editor) throw new Error(`AST editing not supported for: ${filePath}`);

    return await editor.organizeImports(filePath);
}
