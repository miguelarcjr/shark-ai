import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleSearchCode } from './agent-tools.js';
import fs from 'fs';
import path from 'path';

describe('handleSearchCode - VS Code Style', () => {
    const testDir = path.resolve(process.cwd(), 'temp_test_search');

    beforeEach(() => {
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
        fs.writeFileSync(path.join(testDir, 'sample1.ts'), 'const RedirectAreaConfig = 123;');
        fs.mkdirSync(path.join(testDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'sub', 'sample2.ts'), 'function getRedirectAreaConfig() {}');
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should search recursively when path is "."', () => {
        const result = handleSearchCode('.', 'RedirectAreaConfig');
        expect(result).toContain('sample1.ts');
        expect(result).toContain('sample2.ts');
    });

    it('should search recursively when path is a directory without wildcard', () => {
        const result = handleSearchCode('temp_test_search/sub', 'RedirectAreaConfig');
        expect(result).toContain('Found 1 match(es)');
        expect(result).toContain('sample2.ts');
    });

    it('should return error when query is empty', () => {
        const result = handleSearchCode('temp_test_search', '');
        expect(result).toBe("Error: 'query' parameter is required for search_code");
    });
});
