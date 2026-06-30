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

    it('should enforce minimal-context rule and track step coverage correctly', async () => {
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
                if (prompt.includes('continuity')) {
                    // Forçar que a Mensagem 3 mude o tópico, mas a regra de contexto mínimo deve garantir pelo menos 2 mensagens por segmento
                    if (prompt.includes('Mensagem 3')) {
                        return { action: { content: 'No' } };
                    }
                    return { action: { content: 'Yes' } };
                }
                return {
                    action: {
                        content: JSON.stringify({
                            topic: 'Test Topic',
                            keywords: ['test'],
                            explicit_mentions: ['test_event']
                        })
                    }
                };
            }
        };
        
        const tail = await manager.compactHistory(rawHistory, mockApiProvider, 'test-session', true);
        expect(tail.length).toBe(4);
        
        const boxes = manager.loadBoxes();
        expect(boxes.length).toBeGreaterThan(0);
        
        // Cada caixa deve ter pelo menos 2 mensagens e cobrir os índices corretos
        for (const box of boxes) {
            expect(box.coverage.end_step - box.coverage.start_step + 1).toBeGreaterThanOrEqual(2);
            expect(box.coverage.session_id).toBe('test-session');
            // Os steps de cobertura devem ser rastreados de forma absoluta
            expect(box.coverage.start_step).toBeLessThanOrEqual(box.coverage.end_step);
        }
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
                            related_events: ['setup database'],
                            unrelated_events: []
                        })
                    }
                };
            }
        };
        
        // Rodar linkEventsToTraces diretamente
        // @ts-ignore
        await manager.linkEventsToTraces(newBox, ['setup database'], mockApiProvider);
        
        const updatedTraces = manager.loadTraces();
        // Ambas as traces devem ter sido atualizadas com a nova caixa (Multi-branching!)
        expect(updatedTraces[0].box_ids).toContain(102);
        expect(updatedTraces[1].box_ids).toContain(102);
    });
});
