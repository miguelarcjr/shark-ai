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
});
