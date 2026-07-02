import { describe, it, expect } from 'vitest';
import { truncateToolOutput } from '../agents/developer-agent.js';
import { compactToolOutputRetroactively, cleanResponseObject } from './openai-compatible-provider.js';

describe('Tool Output Compaction and Truncation', () => {
    describe('truncateToolOutput', () => {
        it('should not truncate short output', () => {
            const short = 'A short output';
            expect(truncateToolOutput(short, 100)).toBe(short);
        });

        it('should truncate long output to first 40 and last 40 lines', () => {
            const lines = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`);
            const longText = lines.join('\n');
            const result = truncateToolOutput(longText, 5); // very small token budget

            expect(result).toContain('Line 1');
            expect(result).toContain('Line 40');
            expect(result).not.toContain('Line 50');
            expect(result).toContain('[TRUNCADO PARA ECONOMIZAR CONTEXTO');
            expect(result).toContain('Line 111');
            expect(result).toContain('Line 150');
        });
    });

    describe('compactToolOutputRetroactively', () => {
        it('should truncate run_command outputs retroactively if long', () => {
            const header = '[Action run_command(npm run build) Success]:\n';
            const logLines = Array.from({ length: 100 }, (_, i) => `build step ${i}`);
            const fullOutput = header + logLines.join('\n');
            
            const result = compactToolOutputRetroactively(fullOutput);
            expect(result).toContain('[TRUNCADO PARA ECONOMIZAR CONTEXTO');
            expect(result).toContain('build step 0');
            expect(result).toContain('build step 99');
        });

        it('should extract AST signatures for read_file output', () => {
            const header = '[Action read_file(src/app.ts) Success]:\n';
            const code = `import { useState } from 'react';
export class AppController {
    public start() {
        console.log("start");
    }
}
export interface User {
    name: string;
}`;
            const fullOutput = header + code;
            const result = compactToolOutputRetroactively(fullOutput);

            expect(result).toContain('class AppController');
            expect(result).toContain('interface User');
            expect(result).not.toContain('console.log');
            expect(result).toContain('Success (Signatures Only)');
        });

        it('should summarize create_file and modify_file', () => {
            const createOutput = '[Action create_file(src/index.ts) Success]\nconst x = 1;\nconsole.log(x);';
            const result = compactToolOutputRetroactively(createOutput);
            expect(result).toBe('[Action create_file(src/index.ts) Success]');
        });

        it('should summarize list_files / search matches', () => {
            const searchOutput = '[Action search_code(auth) Success]:\nmatch 1\nmatch 2\nmatch 3\nmatch 4\nmatch 5\nmatch 6\n';
            const result = compactToolOutputRetroactively(searchOutput);
            expect(result).toBe('[Action search_code(auth) Success]: - Compacted (found 6 matches/items)');
        });
    });

    describe('cleanResponseObject', () => {
        it('should remove null, undefined, empty string, empty array, and false properties recursively', () => {
            const input = {
                action: {
                    type: 'talk_with_user',
                    path: null,
                    content: 'Hello',
                    command: undefined,
                    Subagents: [],
                    enable_write_tools: false,
                    fields: {
                        name: '',
                        items: [null, undefined, { valid: true }]
                    }
                },
                emptyObj: {},
                other: 'value'
            };

            const result = cleanResponseObject(input);
            expect(result).toEqual({
                action: {
                    type: 'talk_with_user',
                    content: 'Hello',
                    fields: {
                        items: [{ valid: true }]
                    }
                },
                other: 'value'
            });
        });
    });
});
