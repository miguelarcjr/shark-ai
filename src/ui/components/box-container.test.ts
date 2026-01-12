import { describe, it, expect } from 'vitest';
import { renderBox } from './box-container';
import stripAnsi from 'strip-ansi';

describe('BoxContainer', () => {
    it('should render a box with title in standard mode', () => {
        const output = renderBox('Test', 'Content', { width: 100 });
        const clean = stripAnsi(output);
        expect(clean).toContain('┌─ Test ─');
        expect(clean).toContain('│ Content');
        expect(clean).toContain('└──');
    });

    it('should render simplified view in compact mode', () => {
        const output = renderBox('Test', 'Content', { width: 50 });
        const clean = stripAnsi(output);
        // Compact mode expectation: Title uppercase, no box chars
        expect(clean).toContain('TEST');
        expect(clean).not.toContain('┌');
        expect(clean).toContain('  Content');
    });

    it('should handle array content', () => {
        const output = renderBox('List', ['Item 1', 'Item 2'], { width: 100 });
        expect(output).toContain('Item 1');
        expect(output).toContain('Item 2');
    });
});
