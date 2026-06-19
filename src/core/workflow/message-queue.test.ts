import { describe, it, expect } from 'vitest';
import { MessageQueue } from './message-queue.js';

describe('MessageQueue', () => {
    it('should handle sequential push and pop', async () => {
        const queue = new MessageQueue();
        queue.push({ type: 'user', content: 'hello', timestamp: 123 });
        const next = await queue.next();
        expect(next.content).toBe('hello');
    });

    it('should block pop until pushed', async () => {
        const queue = new MessageQueue();
        const promise = queue.next();
        queue.push({ type: 'user', content: 'delayed', timestamp: 456 });
        const next = await promise;
        expect(next.content).toBe('delayed');
    });

    it('should correctly report isEmpty status', async () => {
        const queue = new MessageQueue();
        expect(queue.isEmpty()).toBe(true);

        queue.push({ type: 'user', content: 'item', timestamp: 123 });
        expect(queue.isEmpty()).toBe(false);

        await queue.next();
        expect(queue.isEmpty()).toBe(true);
    });

    it('should support multiple concurrent readers', async () => {
        const queue = new MessageQueue();
        const p1 = queue.next();
        const p2 = queue.next();
        
        queue.push({ type: 'user', content: 'first', timestamp: 1 });
        queue.push({ type: 'user', content: 'second', timestamp: 2 });
        
        const r1 = await p1;
        const r2 = await p2;
        
        expect(r1.content).toBe('first');
        expect(r2.content).toBe('second');
    });
});
