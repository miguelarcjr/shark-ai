import { describe, it, expect } from 'vitest';
import { renderDiff } from './diff-viewer.js';
import stripAnsi from 'strip-ansi';

describe('DiffViewer', () => {
    it('should render added lines with +', () => {
        const output = renderDiff('line1\n', 'line1\nline2\n');
        const clean = stripAnsi(output);
        expect(clean).toContain('+ line2');
        expect(clean).toContain('  line1');
    });

    it('should render removed lines with -', () => {
        const output = renderDiff('line1\nline2\n', 'line1\n');
        const clean = stripAnsi(output);
        expect(clean).toContain('- line2');
        expect(clean).toContain('  line1');
    });
});
