import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrateContext } from './ace-context-orchestrator.js';
import { ChatMessage } from '../workflow/history-manager.js';
import { EmbeddingService } from '../workflow/embedding-service.js';

const mockScoreDocumentsBM25 = vi.fn();
const mockCalculateTextSimilarity = vi.fn();

vi.mock('../workflow/embedding-service.js', () => {
    return {
        EmbeddingService: vi.fn().mockImplementation(() => {
            return {
                scoreDocumentsBM25: mockScoreDocumentsBM25,
                calculateTextSimilarity: mockCalculateTextSimilarity
            };
        })
    };
});

describe('ACE Context Orchestrator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should always keep Turn 0 (system prompt) and Turn T-1 as RAW', async () => {
        const rawHistory: ChatMessage[] = [
            { role: 'system', content: 'You are Shark Dev.' },
            { role: 'user', content: 'Read auth.ts' },
            { role: 'assistant', content: JSON.stringify({ thought: 'Read file', action: { type: 'read_file', path: 'auth.ts' }, summary: 'Reading auth.ts' }) },
            { role: 'user', content: '[Action read_file(auth.ts) Success]:\nconst x = 10;' }
        ];

        // Mock BM25 scores to return very low scores (so they would normally be dropped)
        mockScoreDocumentsBM25.mockReturnValue([0.01, 0.01]);

        const result = await orchestrateContext(rawHistory, 'new prompt', 8000);

        // Turn 0 (system) and Turn T-1 (last user msg) must remain RAW
        expect(result[0]).toEqual(rawHistory[0]);
        expect(result[result.length - 1]).toEqual(rawHistory[rawHistory.length - 1]);
    });

    it('should expand intermediate turns to RAW if normalized score is high (> 0.5)', async () => {
        const rawHistory: ChatMessage[] = [
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Touch auth.ts' },
            { role: 'assistant', content: JSON.stringify({ thought: 'Touch auth', action: { type: 'modify_file', path: 'auth.ts' }, summary: 'Modifying auth' }) },
            { role: 'user', content: '[Action modify_file(auth.ts) Success]' },
            { role: 'user', content: 'new prompt' }
        ];

        // Mock BM25 scores: turn 1 has 10.0, turn 2 has 1.0 (max is 10.0, so turn 1 normalizes to 1.0, turn 2 to 0.1)
        mockScoreDocumentsBM25.mockReturnValue([10.0, 1.0, 0.1]);

        const result = await orchestrateContext(rawHistory, 'new prompt', 10);

        // Turn 1 (idx 1) is raw
        expect(result[1].content).toBe('Touch auth.ts');
        // Turn 2 (idx 2) is abstracted/dropped because it normalizes to 0.1
        expect(result[2].content).not.toContain('Touch auth');
    });

    it('should compact intermediate turns to Abstract if normalized score is medium (0.2 - 0.5)', async () => {
        const rawHistory: ChatMessage[] = [
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Read code' },
            { role: 'assistant', content: JSON.stringify({ thought: 'Read file', action: { type: 'read_file', path: 'src/main.ts' }, summary: 'Read main' }) },
            { role: 'user', content: '[Action read_file(src/main.ts) Success]:\nimport { foo } from "./foo";\nexport class Bar {}' },
            { role: 'user', content: 'new prompt' }
        ];

        // Normalizes to 0.3 (medium)
        mockScoreDocumentsBM25.mockReturnValue([1.0, 3.0, 1.0]);

        const result = await orchestrateContext(rawHistory, 'new prompt', 10);

        // Turn 2 (assistant) is Abstract
        expect(result[2].content).toContain('Read main');
    });

    it('should drop intermediate turns if normalized score is low (< 0.2)', async () => {
        const rawHistory: ChatMessage[] = [
            { role: 'system', content: 'System' },
            { role: 'user', content: 'Unrelated action' },
            { role: 'assistant', content: JSON.stringify({ thought: 'Unrelated thought', action: { type: 'list_files' }, summary: 'List' }) },
            { role: 'user', content: '[Action list_files Success]:\na.ts\nb.ts' },
            { role: 'user', content: 'new prompt' }
        ];

        // Normalizes to 0.05 (low)
        mockScoreDocumentsBM25.mockReturnValue([0.1, 0.1, 0.1]);

        const result = await orchestrateContext(rawHistory, 'new prompt', 10);

        // Turn 1 (user) and Turn 2 (assistant) and Turn 3 (tool) are dropped
        // Only Turn 0 (system) and last prompt (user) are kept (since T-1 is user, and Turn 0 is system)
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe('system');
        expect(result[1].content).toBe('new prompt');
    });
});
