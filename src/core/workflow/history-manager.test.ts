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

    describe('Logical Turn Rewind', () => {
        const testRewindId = 'test-rewind-conv';

        afterEach(async () => {
            await HistoryManager.deleteHistory(testRewindId);
            const rawPath = HistoryManager.getRawHistoryPath(testRewindId);
            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        });

        it('should identify logical user turn start indexes correctly', () => {
            const history = [
                { role: 'system' as const, content: 'System instruction' },
                { role: 'user' as const, content: 'First user prompt' },
                { role: 'assistant' as const, content: '{"action":{"type":"read_file"}}' },
                { role: 'user' as const, content: '[Action read_file Success]: content' },
                { role: 'assistant' as const, content: 'Assistant final response 1' },
                { role: 'user' as const, content: 'Second user prompt' },
                { role: 'assistant' as const, content: 'Assistant final response 2' }
            ];

            const indexes = HistoryManager.getLogicalTurnIndexes(history);
            expect(indexes).toEqual([1, 5]);
        });

        it('should rewind 1 logical turn properly', async () => {
            const history = [
                { role: 'system' as const, content: 'System instruction' },
                { role: 'user' as const, content: 'First user prompt' },
                { role: 'assistant' as const, content: 'Assistant response 1' },
                { role: 'user' as const, content: 'Second user prompt' },
                { role: 'assistant' as const, content: '{"message":"An unexpected error occurred"}' }
            ];

            await HistoryManager.saveRawHistory(testRewindId, history);
            await HistoryManager.saveHistory(testRewindId, history);

            const res = await HistoryManager.rewindLogicalTurns(testRewindId, 1);
            expect(res.success).toBe(true);

            const updatedRaw = await HistoryManager.getRawHistory(testRewindId);
            expect(updatedRaw.length).toBe(3);
            expect(updatedRaw[updatedRaw.length - 1].content).toBe('Assistant response 1');
        });
    });
});


