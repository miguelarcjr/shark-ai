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

    it('should save raw history to a raw.json file distinct from standard history', async () => {
        const testRawId = 'test-raw-session';
        const messages = [{ role: 'user', content: 'hello raw' } as const];
        
        const rawPath = path.resolve(process.cwd(), '_sharkrc', 'history', `${testRawId}.raw.json`);
        const stdPath = path.resolve(process.cwd(), '_sharkrc', 'history', `${testRawId}.json`);
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        if (fs.existsSync(stdPath)) fs.unlinkSync(stdPath);

        await HistoryManager.saveRawHistory(testRawId, messages);
        
        const rawExists = fs.existsSync(rawPath);
        const stdExists = fs.existsSync(stdPath);
        
        expect(rawExists).toBe(true);
        expect(stdExists).toBe(false);
        
        // Cleanup
        if (rawExists) fs.unlinkSync(rawPath);
    });
});

