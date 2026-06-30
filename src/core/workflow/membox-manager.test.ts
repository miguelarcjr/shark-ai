import { describe, it, expect, beforeAll } from 'vitest';
import { MemboxManager } from './membox-manager.js';
import * as fs from 'fs';
import * as path from 'path';

describe('MemboxManager', () => {
    const testDir = path.resolve(process.cwd(), '.vitest_membox_storage');

    beforeAll(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
    });

    it('should store and retrieve boxes and traces correctly', async () => {
        const manager = new MemboxManager(testDir);
        
        const testBox = {
            box_id: 1,
            start_time: new Date().toISOString(),
            coverage: { session_id: 'sessao_1', start_step: 1, end_step: 2 },
            content_text: 'User: Como compilar o projeto?\nAssistant: Use npm run build.',
            features: {
                topic: 'Compilação do projeto',
                keywords: ['npm', 'build', 'compilar'],
                events: ['Instruiu a usar npm run build'],
                events_text: 'Instruiu a usar npm run build'
            }
        };
        
        manager.saveBox(testBox);
        
        const retrieved = await manager.retrieveContext('como buildar', []);
        expect(retrieved).toContain('Compilação do projeto');
        expect(retrieved).toContain('npm run build');
    });

    it('should isolate storage based on runId', () => {
        const manager1 = new MemboxManager('run-1');
        const manager2 = new MemboxManager('run-2');
        
        manager1.saveBox({
            box_id: 10,
            start_time: new Date().toISOString(),
            coverage: { session_id: 'sess_1', start_step: 0, end_step: 1 },
            content_text: 'Sessão 1',
            features: { topic: 'T1', keywords: [], events: [], events_text: '' }
        });
        
        manager2.saveBox({
            box_id: 20,
            start_time: new Date().toISOString(),
            coverage: { session_id: 'sess_2', start_step: 0, end_step: 1 },
            content_text: 'Sessão 2',
            features: { topic: 'T2', keywords: [], events: [], events_text: '' }
        });
        
        expect(manager1.loadBoxes().map(b => b.box_id)).toContain(10);
        expect(manager1.loadBoxes().map(b => b.box_id)).not.toContain(20);
        
        expect(manager2.loadBoxes().map(b => b.box_id)).toContain(20);
        expect(manager2.loadBoxes().map(b => b.box_id)).not.toContain(10);

        // Clean up namespaced directories
        const dir1 = path.join('.shark/membox', 'run-1');
        const dir2 = path.join('.shark/membox', 'run-2');
        if (fs.existsSync(dir1)) fs.rmSync(dir1, { recursive: true });
        if (fs.existsSync(dir2)) fs.rmSync(dir2, { recursive: true });
    });

    it('should enforce minimal-context rule and track step coverage correctly via batch loom', async () => {
        const manager = new MemboxManager(path.join(testDir, 'minimal-context'));
        
        const rawHistory = [
            { role: 'user', content: 'Mensagem 1' },
            { role: 'assistant', content: 'Mensagem 2' },
            { role: 'user', content: 'Mensagem 3' },
            { role: 'assistant', content: 'Mensagem 4' },
            { role: 'user', content: 'Tail 1' },
            { role: 'assistant', content: 'Tail 2' },
            { role: 'user', content: 'Tail 3' },
            { role: 'assistant', content: 'Tail 4' }
        ];
        
        const mockApiProvider = {
            streamChat: async (prompt: string) => {
                if (prompt.includes('segmentation assistant')) {
                    // Forçar limites válidos que cobrem todo o range do histórico linear a ser compactado (índices 0 a 3)
                    return {
                        action: {
                            content: JSON.stringify({
                                boundaries: [
                                    { start: 0, end: 1 },
                                    { start: 2, end: 3 }
                                ]
                            })
                        }
                    };
                }
                if (prompt.includes('partitioned conversation segments')) {
                    return {
                        action: {
                            content: JSON.stringify({
                                segments: [
                                    {
                                        segment_index: 0,
                                        topic: 'Tópico 1',
                                        keywords: ['k1'],
                                        explicit_mentions: ['Evento 1']
                                    },
                                    {
                                        segment_index: 1,
                                        topic: 'Tópico 2',
                                        keywords: ['k2'],
                                        explicit_mentions: ['Evento 2']
                                    }
                                ]
                            })
                        }
                    };
                }
                if (prompt.includes('narrative linking assistant')) {
                    return {
                        action: {
                            content: JSON.stringify({
                                mappings: [],
                                unmatched_events: ['Evento 1', 'Evento 2']
                            })
                        }
                    };
                }
                if (prompt.includes('coherent logical chain')) {
                    return {
                        action: {
                            content: JSON.stringify({
                                primary_chain: ['Evento Geral'],
                                isolated_events: []
                            })
                        }
                    };
                }
                return { action: { content: '' } };
            }
        };
        
        const tail = await manager.compactHistory(rawHistory, mockApiProvider, 'test-session', true);
        expect(tail.length).toBe(4);
        
        const boxes = manager.loadBoxes();
        expect(boxes.length).toBe(2); // Devem ser geradas 2 caixas com base nas boundaries
        
        // Cada caixa deve ter os índices corretos
        expect(boxes[0].coverage.start_step).toBe(0);
        expect(boxes[0].coverage.end_step).toBe(1);
        expect(boxes[1].coverage.start_step).toBe(2);
        expect(boxes[1].coverage.end_step).toBe(3);
    });

    it('should link event to multiple traces (multi-branching) and perform pre-filtering', async () => {
        const manager = new MemboxManager(path.join(testDir, 'multi-branching'));
        
        // Salvar duas traces pré-existentes com conteúdo para alta similaridade com "setup database"
        const trace1 = {
            trace_id: 0,
            box_ids: [100],
            entries: [{ box_id: 100, start_time: new Date().toISOString(), events: ['setup database'], order: 0 }],
            entries_text: 'setup database'
        };
        const trace2 = {
            trace_id: 1,
            box_ids: [101],
            entries: [{ box_id: 101, start_time: new Date().toISOString(), events: ['setup database backend'], order: 0 }],
            entries_text: 'setup database backend'
        };
        manager.saveTrace(trace1);
        manager.saveTrace(trace2);
        
        const newBox = {
            box_id: 102,
            start_time: new Date().toISOString(),
            coverage: { session_id: 'sess', start_step: 0, end_step: 1 },
            content_text: 'New database configured',
            features: {
                topic: 'Database config',
                keywords: ['db'],
                events: ['setup database'],
                events_text: 'setup database'
            }
        };
        manager.saveBox(newBox);
        
        const mockApiProvider = {
            streamChat: async (prompt: string) => {
                // LLM confirma que é relacionado para ambas as traces
                return {
                    action: {
                        content: JSON.stringify({
                            mappings: [
                                { trace_id: 0, related_events: ['setup database'] },
                                { trace_id: 1, related_events: ['setup database'] }
                            ],
                            unmatched_events: []
                        })
                    }
                };
            }
        };
        
        // Rodar linkEventsToTracesBatch diretamente
        // @ts-ignore
        await manager.linkEventsToTracesBatch(newBox, ['setup database'], mockApiProvider);
        
        const updatedTraces = manager.loadTraces();
        // Ambas as traces devem ter sido atualizadas com a nova caixa (Multi-branching!)
        expect(updatedTraces[0].box_ids).toContain(102);
        expect(updatedTraces[1].box_ids).toContain(102);
    });
});
