import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tui } from '../../src/ui/tui.js';

describe('TUI Non-TTY Fallback', () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;

    beforeEach(() => {
        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    });

    afterEach(() => {
        Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
        vi.restoreAllMocks();
    });

    it('creates a non-throwing spinner in non-tty mode', () => {
        const spinner = tui.spinner();
        expect(() => {
            spinner.start('Starting task');
            spinner.message('In progress');
            spinner.stop('Done');
        }).not.toThrow();
    });

    it('reads text input via readline fallback in non-tty mode', async () => {
        const promise = tui.text({ message: 'Enter your name:' });
        setTimeout(() => {
            process.stdin.emit('data', Buffer.from('Shark Tester\n'));
        }, 20);
        const result = await promise;
        expect(result).toBe('Shark Tester');
    });

    it('reads confirmation via readline fallback in non-tty mode', async () => {
        const promise = tui.confirm({ message: 'Proceed?' });
        setTimeout(() => {
            process.stdin.emit('data', Buffer.from('y\n'));
        }, 20);
        const result = await promise;
        expect(result).toBe(true);
    });

    it('reads select choice via readline fallback in non-tty mode', async () => {
        const promise = tui.select({
            message: 'Select an option:',
            options: [
                { value: 'opt1', label: 'Option 1' },
                { value: 'opt2', label: 'Option 2' }
            ]
        });
        setTimeout(() => {
            process.stdin.emit('data', Buffer.from('2\n'));
        }, 20);
        const result = await promise;
        expect(result).toBe('opt2');
    });
});



