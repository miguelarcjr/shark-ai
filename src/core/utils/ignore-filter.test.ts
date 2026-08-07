import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { IgnoreFilterManager } from './ignore-filter.js';

describe('IgnoreFilterManager', () => {
    const testDir = path.resolve(process.cwd(), '.vitest_ignore_test');

    beforeEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
        fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should ignore default paths like .shark and node_modules even without .gitignore', () => {
        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('.shark/membox/graph.json')).toBe(true);
        expect(filter.isIgnored('node_modules/express/index.js')).toBe(true);
        expect(filter.isIgnored('.git/config')).toBe(true);
        expect(filter.isIgnored('src/index.ts')).toBe(false);
    });

    it('should respect root .gitignore rules', () => {
        fs.writeFileSync(path.join(testDir, '.gitignore'), '*.log\ntmp/\n');
        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('debug.log')).toBe(true);
        expect(filter.isIgnored('tmp/cache.json')).toBe(true);
        expect(filter.isIgnored('src/main.ts')).toBe(false);
    });

    it('should respect nested .gitignore rules', () => {
        fs.mkdirSync(path.join(testDir, 'packages', 'app'), { recursive: true });
        fs.writeFileSync(path.join(testDir, 'packages', 'app', '.gitignore'), 'build/\n*.tmp\n');

        const filter = new IgnoreFilterManager(testDir);
        expect(filter.isIgnored('packages/app/build/output.js')).toBe(true);
        expect(filter.isIgnored('packages/app/cache.tmp')).toBe(true);
        expect(filter.isIgnored('packages/other/cache.tmp')).toBe(false);
    });
});
