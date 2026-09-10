import { z } from 'zod';
import { StateDB, SearchResult } from '../memory/state-db.js';

export const sessionSearchToolSchema = z.object({
  query: z.string().describe('Termos de busca textual para encontrar mensagens em sessões anteriores'),
  limit: z.number().int().min(1).max(20).default(5).optional()
});

export type SessionSearchToolArgs = z.infer<typeof sessionSearchToolSchema>;

export function executeSessionSearchTool(
  db: StateDB,
  args: SessionSearchToolArgs
): { query: string; totalFound: number; results: SearchResult[] } {
  const results = db.search(args.query, { limit: args.limit });
  return {
    query: args.query,
    totalFound: results.length,
    results
  };
}
