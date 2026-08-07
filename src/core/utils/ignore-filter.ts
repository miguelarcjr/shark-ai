import ignore, { type Ignore } from 'ignore';
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';

export class IgnoreFilterManager {
    private ig: Ignore;

    constructor(workspaceRoot: string = process.cwd()) {
        this.ig = ignore();
        this.initialize(workspaceRoot);
    }

    private initialize(workspaceRoot: string): void {
        const defaultIgnores = [
            '.shark',
            '.shark/**',
            '**/.shark/**',
            '.git',
            '**/.git/**',
            'node_modules',
            '**/node_modules/**',
            'dist',
            '**/dist/**',
            'build',
            '**/build/**',
            '.next',
            '**/.next/**',
            'coverage',
            '**/coverage/**'
        ];
        this.ig.add(defaultIgnores);

        try {
            const gitignoreFiles = fg.sync('**/.gitignore', {
                cwd: workspaceRoot,
                dot: true,
                ignore: ['**/node_modules/**', '**/.git/**', '**/.shark/**']
            });

            for (const file of gitignoreFiles) {
                const fullPath = path.join(workspaceRoot, file);
                const dir = path.dirname(file).replace(/\\/g, '/');
                const content = fs.readFileSync(fullPath, 'utf-8');
                const lines = content.split(/\r?\n/);

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) continue;

                    if (dir === '.' || dir === '') {
                        this.ig.add(trimmed);
                    } else {
                        const scopedRule = trimmed.startsWith('!')
                            ? `!${dir}/${trimmed.slice(1)}`
                            : `${dir}/${trimmed}`;
                        this.ig.add(scopedRule);
                    }
                }
            }
        } catch {
            // Fallback silently if discovery fails
        }
    }

    public isIgnored(relativePath: string): boolean {
        const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
        return this.ig.ignores(normalized);
    }
}
