import * as fs from 'fs';
import * as path from 'path';

export class EmbeddingService {
    private cachePath: string;
    private cache: Record<string, number[]> = {};
    private writeTimeout: NodeJS.Timeout | null = null;

    private static STOP_WORDS = new Set([
        // English
        'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'arent', 'as', 'at',
        'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'cant', 'cannot', 'could',
        'couldnt', 'did', 'didnt', 'do', 'does', 'doesnt', 'doing', 'dont', 'down', 'during', 'each', 'few', 'for',
        'from', 'further', 'had', 'hadnt', 'has', 'hasnt', 'have', 'havent', 'having', 'he', 'hed', 'hell', 'hes',
        'her', 'here', 'heres', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'hows', 'i', 'id', 'im', 'ive',
        'if', 'in', 'into', 'is', 'isnt', 'it', 'its', 'itself', 'lets', 'me', 'more', 'most', 'mustnt', 'my',
        'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
        'ourselves', 'out', 'over', 'own', 'same', 'shant', 'she', 'shed', 'shell', 'shes', 'should', 'shouldnt',
        'so', 'some', 'such', 'than', 'that', 'thats', 'the', 'their', 'theirs', 'them', 'themselves', 'then',
        'there', 'theres', 'these', 'they', 'theyd', 'theyll', 'theyre', 'theyve', 'this', 'those', 'through',
        'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasnt', 'we', 'wed', 'well', 'were', 'weve', 'werent',
        'what', 'whats', 'when', 'whens', 'where', 'wheres', 'which', 'while', 'who', 'whos', 'whom', 'why', 'whys',
        'with', 'wont', 'would', 'wouldnt', 'you', 'youd', 'youll', 'youre', 'youve', 'your', 'yours', 'yourself',
        'yourselves', 'like',
        // Portuguese
        'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos',
        'nas', 'para', 'com', 'por', 'que', 'se', 'ao', 'aos', 'e', 'ou', 'como', 'para', 'em', 'no', 'na', 'um', 'uma'
    ]);

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
        // No-op now since we do not load heavy transformers models anymore
    }

    public tokenize(text: string): string[] {
        if (!text) return [];
        // Split camelCase by converting it to space separated words
        const camelSplit = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        const matches = camelSplit.toLowerCase().match(/[a-z0-9]+/g);
        if (!matches) return [];
        return matches.filter(word => !EmbeddingService.STOP_WORDS.has(word));
    }

    public scoreDocumentsBM25(query: string, documents: string[]): number[] {
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0 || documents.length === 0) {
            return new Array(documents.length).fill(0);
        }

        const N = documents.length;
        const docsTokens = documents.map(d => this.tokenize(d));
        const docLengths = docsTokens.map(t => t.length);
        const avgdl = docLengths.reduce((a, b) => a + b, 0) / N;

        // Document frequencies
        const df = new Map<string, number>();
        for (const token of queryTokens) {
            let count = 0;
            for (const doc of docsTokens) {
                if (doc.includes(token)) {
                    count++;
                }
            }
            df.set(token, count);
        }

        // IDF values
        const idf = new Map<string, number>();
        for (const token of queryTokens) {
            const count = df.get(token) || 0;
            const val = Math.max(0.0001, Math.log((N - count + 0.5) / (count + 0.5) + 1));
            idf.set(token, val);
        }

        const k1 = 1.2;
        const b = 0.75;

        return docsTokens.map((doc, idx) => {
            const docLen = docLengths[idx];
            const tf = new Map<string, number>();
            for (const token of doc) {
                tf.set(token, (tf.get(token) || 0) + 1);
            }

            let score = 0;
            for (const token of queryTokens) {
                const f = tf.get(token) || 0;
                if (f === 0) continue;
                const tokenIDF = idf.get(token) || 0;
                const numerator = f * (k1 + 1);
                const denominator = f + k1 * (1 - b + b * (docLen / (avgdl || 1)));
                score += tokenIDF * (numerator / denominator);
            }
            return score;
        });
    }

    public calculateTextSimilarity(textA: string, textB: string): number {
        const tokensA = this.tokenize(textA);
        const tokensB = this.tokenize(textB);
        if (tokensA.length === 0 || tokensB.length === 0) return 0;

        const freqA = new Map<string, number>();
        const freqB = new Map<string, number>();
        for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
        for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

        let dotProduct = 0;
        for (const [term, valA] of freqA.entries()) {
            const valB = freqB.get(term) || 0;
            dotProduct += valA * valB;
        }

        let normA = 0;
        for (const val of freqA.values()) normA += val * val;
        let normB = 0;
        for (const val of freqB.values()) normB += val * val;

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Legacy compatibility method: generates a normalized feature vector using hashing.
     */
    public async getEmbedding(text: string): Promise<number[]> {
        const tokens = this.tokenize(text);
        const vec = new Array(384).fill(0);
        
        // Return cached vector if it exists to maintain compatibility with vectors.json test checks
        const hashStr = this.getHash(text);
        if (this.cache[hashStr]) {
            return this.cache[hashStr];
        }

        if (tokens.length > 0) {
            for (const token of tokens) {
                let hash = 0;
                for (let i = 0; i < token.length; i++) {
                    hash = (hash << 5) - hash + token.charCodeAt(i);
                    hash |= 0;
                }
                const idx = Math.abs(hash) % 384;
                vec[idx] += 1;
            }

            let norm = 0;
            for (let i = 0; i < 384; i++) norm += vec[i] * vec[i];
            if (norm > 0) {
                const sqrtNorm = Math.sqrt(norm);
                for (let i = 0; i < 384; i++) vec[i] /= sqrtNorm;
            }
        }

        this.cache[hashStr] = vec;
        this.saveCache();
        return vec;
    }

    private getHash(text: string): string {
        // Simple fast string hashing for cache keys
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash << 5) - hash + text.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Legacy compatibility method for calculating vector similarity.
     */
    public cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length || vecA.length === 0) return 0;
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
