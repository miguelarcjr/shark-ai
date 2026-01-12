import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown-renderer.js';
import stripAnsi from 'strip-ansi';

describe('MarkdownRenderer', () => {
    it('should render headers correctly', () => {
        const output = renderMarkdown('# Title\n## Subtitle');
        const clean = stripAnsi(output);
        expect(clean).toContain('Title');
        expect(clean).toContain('Subtitle');
    });

    it('should render lists correctly', () => {
        const output = renderMarkdown('- Item 1\n- Item 2');
        const clean = stripAnsi(output);
        expect(clean).toContain('• Item 1');
        expect(clean).toContain('• Item 2');
    });

    it('should render codespans correctly', () => {
        const output = renderMarkdown('Use `code` here');
        const clean = stripAnsi(output);
        expect(clean).toContain('Use code here');
    });
});
