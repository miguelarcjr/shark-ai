import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrateContext, generateAbstract } from './ace-context-orchestrator.js';
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

describe('ACE Context Orchestrator & Parser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Universal Signature Extractor', () => {
        it('should extract TypeScript signatures using AST parser', () => {
            const code = `
                import { x } from './x';
                // Comment here
                export class MyClass {
                    constructor(public a: number) {}
                    public test() {
                        console.log("hello");
                    }
                }
                export function add(a: number, b: number): number {
                    return a + b;
                }
            `;
            const msg: ChatMessage = {
                role: 'user',
                content: '[Action read_file(src/index.ts) Success]:\n' + code
            };
            const abstract = generateAbstract(msg);
            expect(abstract).toContain('import { x } from');
            expect(abstract).toContain('export class MyClass {');
            expect(abstract).toContain('constructor(public a: number);');
            expect(abstract).toContain('public test();');
            expect(abstract).toContain('export function add(a: number, b: number): number;');
            expect(abstract).not.toContain('console.log');
        });

        it('should extract Python signatures using lexical fallback scanner', () => {
            const code = `
                # A python comment
                import sys
                class Calculator:
                    """docstring"""
                    def add(self, x, y):
                        return x + y
                def test_func():
                    pass
            `;
            const msg: ChatMessage = {
                role: 'user',
                content: '[Action read_file(main.py) Success]:\n' + code
            };
            const abstract = generateAbstract(msg);
            expect(abstract).toContain('import sys');
            expect(abstract).toContain('class Calculator:');
            expect(abstract).toContain('def add(self, x, y):');
            expect(abstract).toContain('def test_func():');
            expect(abstract).not.toContain('docstring');
        });
    });

    describe('Orchestration and Pinning', () => {
        it('should always pin Turn 0, Turn 1, Turn T, and Turn T-1 as RAW', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System Prompt' }, // 0: Pinned (Turn 0)
                { role: 'user', content: 'Original Task Instruction' }, // 1: Pinned (Turn 1)
                { role: 'assistant', content: '{"thought":"t1","summary":"s1"}' }, // 2: Intermediate
                { role: 'user', content: '[Action read_file(x) Success]' }, // 3: Intermediate
                { role: 'assistant', content: '{"thought":"t2","summary":"s2"}' }, // 4: Intermediate
                { role: 'user', content: '[Action run_command Success]' }, // 5: Pinned (Turn T-1)
                { role: 'user', content: 'current prompt' } // 6: Pinned (Turn T)
            ];

            // Mock BM25 scores to return very low scores for intermediates
            mockScoreDocumentsBM25.mockReturnValue([0.01, 0.01, 0.01]);

            // Pass a small token limit (10) to force orchestration
            const result = await orchestrateContext(rawHistory, 'current prompt', 10);

            // Turn 0, Turn 1, Turn T-1 (5), and Turn T (6) must remain RAW
            expect(result[0]).toEqual(rawHistory[0]);
            expect(result[1]).toEqual(rawHistory[1]);
            
            // Check that T-1 and T are present as raw
            const tMinus1 = result.find(m => m.content === '[Action run_command Success]');
            const tTurn = result[result.length - 1];
            expect(tMinus1).toBeDefined();
            expect(tTurn.content).toBe('current prompt');
        });

        it('should expand intermediate turns to RAW if normalized score is high (> 0.5)', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System Prompt' }, // 0
                { role: 'user', content: 'Original Task' }, // 1
                { role: 'assistant', content: '{"thought":"Keep me RAW","summary":"important"}' }, // 2: Intermediate
                { role: 'user', content: 'Drop me' }, // 3: Intermediate
                { role: 'assistant', content: 'Drop me too' }, // 4: Intermediate
                { role: 'user', content: 'last action' }, // 5
                { role: 'user', content: 'current prompt' } // 6
            ];

            // Mock BM25 scores: turn 2 gets 10.0, turn 3 gets 1.0, turn 4 gets 0.5 (max is 10.0)
            // Normalized: turn 2 is 1.0 (>0.5), turn 3 is 0.1 (<0.2), turn 4 is 0.05 (<0.2)
            mockScoreDocumentsBM25.mockReturnValue([10.0, 1.0, 0.5]);

            // Pass limit = 10 to force orchestration
            const result = await orchestrateContext(rawHistory, 'current prompt', 10);

            const importantTurn = result.find(m => m.content.includes('Keep me RAW'));
            expect(importantTurn).toBeDefined();
            expect(importantTurn?.content).toContain('Keep me RAW'); // RAW

            const droppedTurn = result.find(m => m.content.includes('Drop me'));
            expect(droppedTurn).toBeUndefined(); // Dropped
        });

        it('should compact intermediate turns to Abstract if normalized score is medium (0.2 - 0.5)', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System' }, // 0
                { role: 'user', content: 'Task' }, // 1
                { role: 'assistant', content: '{"thought":"Compact me","summary":"medium relevance","action":{"type":"read_file","path":"x.ts","content":"long details here"}}' }, // 2: Intermediate
                { role: 'user', content: 'last action' }, // 3
                { role: 'user', content: 'current prompt' } // 4
            ];

            // Turn 2 is the only intermediate
            // Score 3.0, Max 10.0 -> Normalized score is 0.3 (medium)
            mockScoreDocumentsBM25.mockReturnValue([3.0]);

            // Pass limit = 10 to force orchestration
            const result = await orchestrateContext(rawHistory, 'current prompt', 10);

            const compacted = result.find(m => m.role === 'assistant' && m.content.includes('Compact me'));
            expect(compacted).toBeDefined();
            // It should be abstracted/compacted JSON
            expect(compacted?.content).toContain('Compact me');
            expect(compacted?.content).not.toContain('long details here'); // Abstract format of assistant reduces details
        });

        it('should drop intermediate turns if normalized score is low (< 0.2)', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System' }, // 0
                { role: 'user', content: 'Task' }, // 1
                { role: 'assistant', content: '{"thought":"Irrelevant","summary":"low"}' }, // 2
                { role: 'user', content: 'last action' }, // 3
                { role: 'user', content: 'current prompt' } // 4
            ];

            mockScoreDocumentsBM25.mockReturnValue([0.1]);

            // Pass limit = 10 to force orchestration
            const result = await orchestrateContext(rawHistory, 'current prompt', 10);

            // Turn 2 is dropped. Only pinned turns remain: 0, 1, 3, 4
            expect(result).toHaveLength(4);
            expect(result.find(m => m.content.includes('Irrelevant'))).toBeUndefined();
        });
    });
});
