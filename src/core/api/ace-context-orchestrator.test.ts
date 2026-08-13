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

        it('should drop duplicate read_file and run_command executions, keeping only the latest', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System' }, // 0: Pinned
                { role: 'user', content: 'Task' }, // 1: Pinned
                { role: 'user', content: '[Action read_file(src/main.ts) Success]:\nold content' }, // 2: Duplicate read (dropped)
                { role: 'user', content: '[Action run_command(npm test) Success]:\nold output' }, // 3: Duplicate command (dropped)
                { role: 'user', content: 'hello '.repeat(300) }, // 4: Large dummy to trigger compaction
                { role: 'user', content: '[Action read_file(src/main.ts) Success]:\nnew content' }, // 5: Latest read (kept RAW/Abstract)
                { role: 'user', content: '[Action run_command(npm test) Success]:\nnew output' }, // 6: Pinned (T-1)
                { role: 'user', content: 'current prompt' } // 7: Pinned (T)
            ];

            mockScoreDocumentsBM25.mockReturnValue([0.1, 10.0]); // Turn 4 gets 0.1 (low), Turn 5 gets 10.0 (high)

            const result = await orchestrateContext(rawHistory, 'current prompt', 200);

            // Verify Turn 2, Turn 3, and Turn 4 are dropped
            const oldRead = result.find(m => m.content && m.content.includes('old content'));
            const oldCmd = result.find(m => m.content && m.content.includes('old output'));
            const dummy = result.find(m => m.content && m.content.includes('hello '.repeat(300)));
            expect(oldRead).toBeUndefined();
            expect(oldCmd).toBeUndefined();
            expect(dummy).toBeUndefined();

            // Verify Turn 5 is kept
            const newRead = result.find(m => m.content && m.content.includes('src/main.ts'));
            expect(newRead).toBeDefined();
        });

        it('should expand intermediate turns to RAW if normalized score is high (> 0.5)', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System Prompt' }, // 0
                { role: 'user', content: 'Original Task' }, // 1
                { role: 'assistant', content: '{"thought":"Keep me RAW","summary":"important"}' }, // 2: Intermediate
                { role: 'user', content: 'Drop me ' + 'hello '.repeat(300) }, // 3: Large dummy intermediate
                { role: 'assistant', content: 'Drop me too' }, // 4: Intermediate
                { role: 'user', content: 'last action' }, // 5
                { role: 'user', content: 'current prompt' } // 6
            ];

            mockScoreDocumentsBM25.mockReturnValue([10.0, 0.1, 0.05]);

            const result = await orchestrateContext(rawHistory, 'current prompt', 200);

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
                { role: 'user', content: 'High relevance reference' }, // 3: High relevance intermediate
                { role: 'user', content: 'Large dummy ' + 'hello '.repeat(300) }, // 4: Large intermediate
                { role: 'user', content: 'last action' }, // 5
                { role: 'user', content: 'current prompt' } // 6
            ];

            mockScoreDocumentsBM25.mockReturnValue([3.0, 10.0, 0.1]);

            const result = await orchestrateContext(rawHistory, 'current prompt', 200);

            const compacted = result.find(m => m.role === 'assistant' && m.content.includes('Compact me'));
            expect(compacted).toBeDefined();
            expect(compacted?.content).toContain('Compact me');
            expect(compacted?.content).not.toContain('long details here'); // Abstract format of assistant reduces details
        });

        it('should drop intermediate turns if normalized score is low (< 0.2)', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System' }, // 0
                { role: 'user', content: 'Task' }, // 1
                { role: 'assistant', content: '{"thought":"Irrelevant","summary":"low"}' }, // 2
                { role: 'user', content: 'Large dummy ' + 'hello '.repeat(300) }, // 3
                { role: 'user', content: 'last action' }, // 4
                { role: 'user', content: 'current prompt' } // 5
            ];

            mockScoreDocumentsBM25.mockReturnValue([0.1, 0.1]);

            const result = await orchestrateContext(rawHistory, 'current prompt', 200);

            // Turn 2 and 3 are dropped. Only pinned turns remain: 0, 1, 4, 5
            expect(result).toHaveLength(4);
            expect(result.find(m => m.content.includes('Irrelevant'))).toBeUndefined();
        });

        it('should allocate context budget slots using weighted priority score and drop remaining abstracts', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System' }, // 0: Pinned
                { role: 'user', content: 'Task' }, // 1: Pinned
                { role: 'user', content: 'Intermediate 2' }, // 2: Oldest intermediate
                { role: 'user', content: 'Intermediate 3' }, // 3: Middle intermediate
                { role: 'user', content: 'Intermediate 4' }, // 4: Newest intermediate
                { role: 'user', content: 'last action' }, // 5: Pinned (T-1)
                { role: 'user', content: 'current prompt' } // 6: Pinned (T)
            ];

            mockScoreDocumentsBM25.mockReturnValue([2.0, 1.5, 0.5]);

            const result = await orchestrateContext(rawHistory, 'current prompt', 10);

            expect(result.length).toBeLessThan(7);
        });

        it('should always pin the latest human user message as RAW', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System Prompt' }, // 0: Pinned (Turn 0)
                { role: 'user', content: 'Original Task' }, // 1: Pinned (Turn 1)
                { role: 'user', content: 'Please modify the X function' }, // 2: Latest human user message (must be pinned!)
                { role: 'assistant', content: '{"thought":"t1","summary":"s1"}' }, // 3: Intermediate assistant thought (subject to drop/abstract)
                { role: 'user', content: '[Action read_file(x) Success]' }, // 4: Tool output (Pinned Turn T-1)
                { role: 'user', content: '[Action run_command(npm test) Success]' } // 5: Tool output (Pinned Turn T)
            ];

            mockScoreDocumentsBM25.mockReturnValue([0.01, 0.01]);

            const result = await orchestrateContext(rawHistory, '[Action run_command(npm test) Success]', 10);

            // Verify Turn 2 (latest human message) remains RAW
            const latestHuman = result.find(m => m.content === 'Please modify the X function');
            expect(latestHuman).toBeDefined();
        });

        it('should perform structural deduplication of read_file even when total tokens are below budget limit', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'Help me fix a bug' },
                { role: 'user', content: '[Action read_file(src/index.ts) Success]:\nconst x = 1;' },
                { role: 'assistant', content: '{"thought":"looking","summary":"analyzing","action":null}' },
                { role: 'user', content: '[Action read_file(src/index.ts) Success]:\nconst x = 2;' },
                { role: 'user', content: 'What next?' }
            ];

            const result = await orchestrateContext(rawHistory, 'Current user question', 200000);
            const readTurns = result.filter(m => m.content.startsWith('[Action read_file(src/index.ts)'));
            expect(readTurns.length).toBe(1);
            expect(readTurns[0].content).toContain('const x = 2;');
        });

        it('should not drop run_command entries during structural deduplication', async () => {
            const rawHistory: ChatMessage[] = [
                { role: 'system', content: 'System prompt' },
                { role: 'user', content: 'Initial prompt' },
                { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed at assertion A' },
                { role: 'assistant', content: '{"thought":"fixing","summary":"modified code","action":null}' },
                { role: 'user', content: '[Action run_command(npm test) Success]:\nTest failed at assertion B' },
                { role: 'user', content: 'Check status' }
            ];

            const result = await orchestrateContext(rawHistory, 'Latest prompt', 200000);
            const cmdTurns = result.filter(m => m.content.startsWith('[Action run_command(npm test)'));
            expect(cmdTurns.length).toBe(2);
        });
    });
});
