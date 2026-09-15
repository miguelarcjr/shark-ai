export interface DeferredToolEntry {
  name: string;
  source: string; // nome do servidor MCP ou plugin
  description: string;
  parameters?: Record<string, any>;
}

export interface ToolSearchResult {
  name: string;
  source: string;
  description: string;
  score: number;
}

export class ToolCatalogSearch {
  private tools: DeferredToolEntry[];
  private docTokens: Map<string, string[]> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgdl: number = 0;
  private dfMap: Map<string, number> = new Map();

  constructor(tools: DeferredToolEntry[]) {
    this.tools = tools;
    this.buildIndex();
  }

  private normalizeToken(token: string): string {
    let t = token.toLowerCase().trim();
    if (t.length <= 2) return t;

    if (t.endsWith('ies') && t.length > 4) {
      return t.slice(0, -3) + 'y';
    }
    if (t.endsWith('sses')) {
      return t.slice(0, -2);
    }
    if (t.endsWith('ing') && t.length > 5) {
      const stem = t.slice(0, -3);
      return stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz') ? stem + 'e' : stem;
    }
    if (t.endsWith('ed') && t.length > 4) {
      const stem = t.slice(0, -2);
      return stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz') ? stem + 'e' : stem;
    }
    // "issues" -> "issue", "creates" -> "create"
    if (t.endsWith('s') && !t.endsWith('ss')) {
      return t.slice(0, -1);
    }
    return t;
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .split(/[^a-zA-Z0-9_]+/)
      .map(t => this.normalizeToken(t))
      .filter(t => t.length > 1);
  }

  private buildIndex(): void {
    let totalLength = 0;
    const termDocCounts: Map<string, Set<string>> = new Map();

    for (const tool of this.tools) {
      const nameTokens = this.tokenize(tool.name);
      const sourceTokens = this.tokenize(tool.source);
      const descTokens = this.tokenize(tool.description);
      const paramTokens = tool.parameters ? this.tokenize(Object.keys(tool.parameters).join(' ')) : [];

      // Ponderar tokens: name x3, source x2, params x1.5, desc x1
      const weightedTokens: string[] = [
        ...nameTokens, ...nameTokens, ...nameTokens,
        ...sourceTokens, ...sourceTokens,
        ...paramTokens,
        ...descTokens
      ];

      this.docTokens.set(tool.name, weightedTokens);
      this.docLengths.set(tool.name, weightedTokens.length);
      totalLength += weightedTokens.length;

      const uniqueTerms = new Set(weightedTokens);
      for (const term of uniqueTerms) {
        if (!termDocCounts.has(term)) {
          termDocCounts.set(term, new Set());
        }
        termDocCounts.get(term)!.add(tool.name);
      }
    }

    this.avgdl = this.tools.length > 0 ? totalLength / this.tools.length : 1;
    for (const [term, docSet] of termDocCounts.entries()) {
      this.dfMap.set(term, docSet.size);
    }
  }

  public search(queries: string[], limit: number = 5): { results: ToolSearchResult[]; available_sources?: string[] } {
    if (!this.tools || this.tools.length === 0) {
      return { results: [], available_sources: [] };
    }

    const queryTokens: string[] = [];
    for (const q of queries) {
      queryTokens.push(...this.tokenize(q));
    }

    const N = this.tools.length;
    const k1 = 1.5;
    const b = 0.75;
    const scores: Map<string, number> = new Map();

    for (const tool of this.tools) {
      const docLen = this.docLengths.get(tool.name) || 0;
      const tokens = this.docTokens.get(tool.name) || [];
      let score = 0;

      // Calcular frequência de termos no documento
      const tfMap: Map<string, number> = new Map();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
      }

      for (const qTerm of queryTokens) {
        const tf = tfMap.get(qTerm) || 0;
        if (tf > 0) {
          const df = this.dfMap.get(qTerm) || 0;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const num = tf * (k1 + 1);
          const den = tf + k1 * (1 - b + b * (docLen / this.avgdl));
          score += idf * (num / den);
        }
      }

      if (score > 0) {
        scores.set(tool.name, score);
      }
    }

    // Fallback: busca literal de substring caso a busca BM25 não retorne nada
    if (scores.size === 0) {
      for (const rawQ of queries) {
        const cleanQ = rawQ.toLowerCase().trim();
        if (!cleanQ) continue;
        for (const tool of this.tools) {
          if (
            tool.name.toLowerCase().includes(cleanQ) ||
            tool.source.toLowerCase().includes(cleanQ)
          ) {
            scores.set(tool.name, (scores.get(tool.name) || 0) + 1.0);
          }
        }
      }
    }

    const sortedResults = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, score]) => {
        const tool = this.tools.find(t => t.name === name)!;
        return {
          name: tool.name,
          source: tool.source,
          description: tool.description,
          score
        };
      });

    if (sortedResults.length === 0) {
      const uniqueSources = Array.from(new Set(this.tools.map(t => t.source))).filter(Boolean);
      return { results: [], available_sources: uniqueSources };
    }

    return { results: sortedResults };
  }
}
