import { describe, it, expect, beforeAll } from 'vitest';
import { EmbeddingService } from './embedding-service.js';
import * as fs from 'fs';
import * as path from 'path';

describe('EmbeddingService', () => {
    const cacheDir = path.resolve(process.cwd(), '.vitest_cache_membox');
    
    beforeAll(() => {
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true });
        }
    });

    it('should calculate cosine similarity correctly', () => {
        const service = new EmbeddingService(cacheDir);
        const vA = [1.0, 0.0, 0.0];
        const vB = [1.0, 0.0, 0.0];
        const vC = [0.0, 1.0, 0.0];
        
        expect(service.cosineSimilarity(vA, vB)).toBeCloseTo(1.0, 5);
        expect(service.cosineSimilarity(vA, vC)).toBeCloseTo(0.0, 5);
    });

    it('should return cached embeddings or call model', async () => {
        const service = new EmbeddingService(cacheDir);
        const mockText = 'teste de unidade';
        
        // Testar vetor retornado
        const vec = await service.getEmbedding(mockText);
        expect(vec).toBeDefined();
        expect(vec.length).toBe(384);
        
        // Testar se salvou no cache JSON
        const cachePath = path.join(cacheDir, 'vectors.json');
        expect(fs.existsSync(cachePath)).toBe(true);
        const cacheContent = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        expect(Object.keys(cacheContent).length).toBe(1);
    });
});
