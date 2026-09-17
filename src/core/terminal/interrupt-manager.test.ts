import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InterruptManager } from './interrupt-manager.js';
import { EventEmitter } from 'node:events';

describe('InterruptManager', () => {
    let mockStdin: EventEmitter & { isTTY?: boolean; setRawMode?: any; resume?: any; pause?: any };

    beforeEach(() => {
        mockStdin = new EventEmitter() as any;
        mockStdin.isTTY = true;
        mockStdin.setRawMode = vi.fn();
        mockStdin.resume = vi.fn();
        mockStdin.pause = vi.fn();
    });

    it('should trigger interrupt on single Esc key (27)', () => {
        const manager = new InterruptManager(mockStdin as any);
        const onInterrupt = vi.fn();
        const signal = manager.start(onInterrupt);

        expect(signal.aborted).toBe(false);
        expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);

        // Emit single Esc byte
        mockStdin.emit('data', Buffer.from([27]));

        expect(manager.isInterrupted()).toBe(true);
        expect(signal.aborted).toBe(true);
        expect(onInterrupt).toHaveBeenCalledTimes(1);
        expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('should NOT trigger interrupt on multi-byte ANSI escape sequence (e.g. arrow keys)', () => {
        const manager = new InterruptManager(mockStdin as any);
        const onInterrupt = vi.fn();
        const signal = manager.start(onInterrupt);

        // Arrow Up is \x1b[A -> [27, 91, 65]
        mockStdin.emit('data', Buffer.from([27, 91, 65]));

        expect(manager.isInterrupted()).toBe(false);
        expect(signal.aborted).toBe(false);
        expect(onInterrupt).not.toHaveBeenCalled();

        manager.stop();
    });

    it('should be safe in non-TTY environments', () => {
        mockStdin.isTTY = false;
        const manager = new InterruptManager(mockStdin as any);
        const signal = manager.start();

        expect(mockStdin.setRawMode).not.toHaveBeenCalled();
        expect(signal.aborted).toBe(false);
        manager.stop();
    });

    it('should terminate process on Ctrl+C (3)', () => {
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
        const manager = new InterruptManager(mockStdin as any);
        manager.start();

        mockStdin.emit('data', Buffer.from([3]));

        expect(exitSpy).toHaveBeenCalledWith(130);
        exitSpy.mockRestore();
    });
});
