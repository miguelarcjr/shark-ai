import { env, pipeline } from '@xenova/transformers';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Configuração offline estrita
env.allowRemoteModels = false;
env.localModelPath = path.resolve(process.cwd(), 'src/resources/models/');

export class EmbeddingService {
    private static extractor: any = null;
    private cachePath: string;
    private cache: Record<string, number[]> = {};

    constructor(cacheDir: string = '.shark/membox') {
        this.cachePath = path.join(cacheDir, 'vectors.json');
        this.loadCache();
    }

    private loadCache() {
        if (fs.existsSync(this.cachePath)) {
            try {
                this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
            } catch {
                this.cache = {};
            }
        }
    }

    private saveCache() {
        const dir = path.dirname(this.cachePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
    }

    private getHash(text: string): string {
        return crypto.createHash('sha1').update(text).digest('hex').substring(0, 16);
    }

    public async getEmbedding(text: string): Promise<number[]> {
        if (!text) return new Array(384).fill(0);
        const hash = this.getHash(text);
        if (this.cache[hash]) {
            return this.cache[hash];
        }

        try {
            if (!EmbeddingService.extractor) {
                EmbeddingService.extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', {
                    quantized: true
                });
            }

            const output = await EmbeddingService.extractor(text, {
                pooling: 'mean',
                normalize: true
            });

            const embedding = Array.from(output.data) as number[];
            this.cache[hash] = embedding;
            this.saveCache();
            return embedding;
        } catch (error) {
            console.warn('Erro ao gerar embedding local, retornando vetor nulo:', error);
            return new Array(384).fill(0);
        }
    }

    public cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return -1;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
