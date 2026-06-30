import { env, pipeline } from '@xenova/transformers';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let packageRoot = __dirname;
while (packageRoot && packageRoot !== path.parse(packageRoot).root) {
    if (fs.existsSync(path.join(packageRoot, 'package.json'))) {
        break;
    }
    packageRoot = path.dirname(packageRoot);
}

// Configuração offline estrita
env.allowRemoteModels = false;
env.localModelPath = path.resolve(packageRoot, 'src/resources/models/');

export class EmbeddingService {
    private static extractor: any = null;
    private cachePath: string;
    private cache: Record<string, number[]> = {};
    private writeTimeout: NodeJS.Timeout | null = null;

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
        if (process.env.VITEST || process.env.NODE_ENV === 'test') {
            const dir = path.dirname(this.cachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8');
            return;
        }

        if (this.writeTimeout) {
            clearTimeout(this.writeTimeout);
        }
        this.writeTimeout = setTimeout(() => {
            const dir = path.dirname(this.cachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2), 'utf8', (err) => {
                if (err) {
                    console.warn('Erro ao salvar cache de embeddings:', err);
                }
            });
            this.writeTimeout = null;
        }, 100);
    }

    public static async warmup(): Promise<void> {
        if (!EmbeddingService.extractor) {
            try {
                EmbeddingService.extractor = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', {
                    quantized: true
                });
            } catch (error) {
                console.warn('Falha no warmup do extractor de embeddings:', error);
            }
        }
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
            await EmbeddingService.warmup();

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
