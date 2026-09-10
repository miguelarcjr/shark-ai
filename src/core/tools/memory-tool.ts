import { z } from 'zod';
import { MemoryStore } from '../memory/memory-store.js';

export const memoryToolSchema = z.object({
  action: z.enum(['add', 'replace', 'remove', 'read']),
  target: z.enum(['memory', 'user']).describe("Alvo da memória: 'memory' (MEMORY.md local) ou 'user' (USER.md global)"),
  content: z.string().optional().describe('Conteúdo a adicionar ou novo conteúdo em substituição'),
  old_str: z.string().optional().describe('Trecho exato a ser substituído ou removido')
});

export type MemoryToolArgs = z.infer<typeof memoryToolSchema>;

export async function executeMemoryTool(
  store: MemoryStore,
  args: MemoryToolArgs
): Promise<{ success: boolean; usage?: string; content?: string; current_entries?: string[] }> {
  if (args.action === 'read') {
    const content = await store.readFile(args.target);
    return { success: true, content };
  }

  if (!args.content && args.action !== 'remove') {
    throw new Error(`Ação '${args.action}' exige o parâmetro 'content'.`);
  }

  return store.updateFile(args.target, args.action, args.content || '', args.old_str);
}
