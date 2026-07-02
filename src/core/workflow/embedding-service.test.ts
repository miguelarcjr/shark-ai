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

    it('should return cached embeddings or generate them', async () => {
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

    it('should tokenize text correctly, filtering stop words and splitting camelCase', () => {
        const service = new EmbeddingService(cacheDir);
        const text = 'testCamelCase splits and filters out stop words like the and parameters';
        const tokens = service.tokenize(text);
        
        expect(tokens).toContain('test');
        expect(tokens).toContain('camel');
        expect(tokens).toContain('case');
        expect(tokens).toContain('splits');
        expect(tokens).toContain('filters');
        expect(tokens).toContain('parameters');
        
        expect(tokens).not.toContain('like');
        expect(tokens).not.toContain('the');
        expect(tokens).not.toContain('and');
    });

    it('should compute BM25 document relevance scores correctly', () => {
        const service = new EmbeddingService(cacheDir);
        const documents = [
            'How to compile the typescript project and generate builds',
            'Configuring postgres database migrations and schema',
            'Some random conversation about nothing'
        ];
        
        const scores = service.scoreDocumentsBM25('compile typescript build', documents);
        expect(scores[0]).toBeGreaterThan(scores[1]);
        expect(scores[0]).toBeGreaterThan(scores[2]);
        
        const dbScores = service.scoreDocumentsBM25('database postgres schema', documents);
        expect(dbScores[1]).toBeGreaterThan(dbScores[0]);
        expect(dbScores[1]).toBeGreaterThan(dbScores[2]);
    });

    it('should calculate text similarity of short strings using Cosine similarity of tokens', () => {
        const service = new EmbeddingService(cacheDir);
        const textA = 'setup database';
        const textB = 'setup database backend';
        const textC = 'git commit -m "feat: init"';
        
        const simAB = service.calculateTextSimilarity(textA, textB);
        const simAC = service.calculateTextSimilarity(textA, textC);
        
        expect(simAB).toBeGreaterThan(0.5);
        expect(simAC).toBeLessThan(0.2);
    });
});
