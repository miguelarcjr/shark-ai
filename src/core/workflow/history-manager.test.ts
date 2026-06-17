import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryManager } from './history-manager.js';
import fs from 'node:fs';
import path from 'node:path';

describe('HistoryManager', () => {
    const testId = 'test-conversation-uuid';
    const historyDir = path.resolve(process.cwd(), '_sharkrc', 'history');
    const filePath = path.resolve(historyDir, `${testId}.json`);

    beforeEach(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    afterEach(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    it('should read empty array if history file does not exist', async () => {
        const history = await HistoryManager.getHistory(testId);
        expect(history).toEqual([]);
    });

    it('should save and load message history array', async () => {
        const messages = [{ role: 'user', content: 'hello' } as const];
        await HistoryManager.saveHistory(testId, messages);
        const loaded = await HistoryManager.getHistory(testId);
        expect(loaded).toEqual(messages);
    });

    it('should append a message to history', async () => {
        const initial = [{ role: 'user', content: 'hello' } as const];
        await HistoryManager.saveHistory(testId, initial);

        const newMessage = { role: 'assistant', content: 'hi' } as const;
        await HistoryManager.appendMessage(testId, newMessage);

        const loaded = await HistoryManager.getHistory(testId);
        expect(loaded).toEqual([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'hi' }
        ]);
    });

    it('should return empty array if history file exists but does not contain an array', async () => {
        fs.writeFileSync(filePath, JSON.stringify({ invalid: true }), 'utf-8');
        const history = await HistoryManager.getHistory(testId);
        expect(history).toEqual([]);
    });
});
