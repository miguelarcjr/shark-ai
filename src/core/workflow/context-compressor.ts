import { encode } from 'gpt-tokenizer';
import { ChatMessage } from './history-manager.js';

export interface CompressOptions {
  tokenLimit: number;
  thresholdRatio?: number; // default: 0.8
  tailSize?: number; // default: 15
  summarizer?: (messages: ChatMessage[]) => Promise<string>;
}

export class ContextCompressor {
  static countTokens(text: string): number {
    if (!text) return 0;
    try {
      return encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }

  static calculateHistoryTokens(history: ChatMessage[]): number {
    return history.reduce((sum, msg) => sum + ContextCompressor.countTokens(msg.content), 0);
  }

  static applyStructuralReadDeduplication(rawHistory: ChatMessage[]): ChatMessage[] {
    if (rawHistory.length <= 2) {
      return rawHistory;
    }

    const pinnedIndices = new Set<number>();
    pinnedIndices.add(0); // Turn 0 (system message)
    pinnedIndices.add(rawHistory.length - 1); // Turn T (current prompt)
    if (rawHistory.length > 2) {
      pinnedIndices.add(rawHistory.length - 2); // Turn T-1 (previous tool output or assistant thought)
    }

    const firstUserMsgIdx = rawHistory.findIndex(
      (m, idx) => m.role === 'user' && !m.content.startsWith('[Action ') && idx > 0
    );
    if (firstUserMsgIdx !== -1) {
      pinnedIndices.add(firstUserMsgIdx); // Turn 1 (original task instruction)
    }

    let latestHumanUserMsgIdx = -1;
    for (let i = rawHistory.length - 1; i >= 0; i--) {
      const msg = rawHistory[i];
      if (msg.role === 'user' && !msg.content.startsWith('[Action ') && !msg.content.startsWith('[MEMÓRIA')) {
        latestHumanUserMsgIdx = i;
        break;
      }
    }
    if (latestHumanUserMsgIdx !== -1) {
      pinnedIndices.add(latestHumanUserMsgIdx);
    }

    const seenReadFiles = new Set<string>();
    const forceDropIndices = new Set<number>();

    for (let i = rawHistory.length - 1; i >= 0; i--) {
      const msg = rawHistory[i];
      if (msg.role === 'user' || msg.role === 'system') {
        if (msg.content.startsWith('[Action read_file(')) {
          const pathMatch = msg.content.match(/\[Action read_file\(([^)]+)\)/);
          const filePath = pathMatch ? pathMatch[1] : '';
          if (filePath) {
            if (seenReadFiles.has(filePath)) {
              if (!pinnedIndices.has(i)) {
                forceDropIndices.add(i);
                // Drop preceding assistant message if it called read_file to keep turn pairs clean
                if (i > 0 && !pinnedIndices.has(i - 1) && rawHistory[i - 1].role === 'assistant') {
                  forceDropIndices.add(i - 1);
                }
              }
            } else {
              seenReadFiles.add(filePath);
            }
          }
        }
      }
    }

    return rawHistory.filter((_, idx) => !forceDropIndices.has(idx));
  }

  static async compress(
    history: ChatMessage[],
    options: CompressOptions
  ): Promise<{ history: ChatMessage[]; wasCompressed: boolean }> {
    // 1. Always-on structural deduplication of redundant read_file calls
    const deduplicatedHistory = ContextCompressor.applyStructuralReadDeduplication(history);
    const wasDeduplicated = deduplicatedHistory.length !== history.length;

    const thresholdRatio = options.thresholdRatio ?? 0.8;
    const tailSize = options.tailSize ?? 15;
    const tokenLimit = options.tokenLimit;

    // Se o histórico não tem turnos intermediários suficientes para comprimir, retorna
    const minRequired = 2 + tailSize + 1; // Pinned (2) + Tail + Pelo menos 1 para resumir
    if (deduplicatedHistory.length <= minRequired) {
      return { history: deduplicatedHistory, wasCompressed: wasDeduplicated };
    }

    const totalTokens = ContextCompressor.calculateHistoryTokens(deduplicatedHistory);
    const triggerThreshold = tokenLimit * thresholdRatio;

    if (totalTokens <= triggerThreshold) {
      return { history: deduplicatedHistory, wasCompressed: wasDeduplicated };
    }

    // Particionamento inteligente com preservação de pares de ferramentas
    let tailStart = deduplicatedHistory.length - tailSize;

    // 1. Se a cauda cortar no meio de respostas de ferramentas (role: 'tool' ou tool_call_id),
    // retroceder tailStart até incluir a mensagem 'assistant' que as invocou.
    while (tailStart > 2 && ((deduplicatedHistory[tailStart] as any)?.role === 'tool' || (deduplicatedHistory[tailStart] as any)?.tool_call_id)) {
      tailStart--;
    }

    // 2. Se a mensagem logo antes da cauda for uma chamada 'assistant' com tool_calls,
    // incluí-la na cauda para que suas respostas correspondentes fiquem no mesmo bloco.
    if (tailStart > 2 && ((deduplicatedHistory[tailStart - 1] as any)?.tool_calls?.length > 0 || (deduplicatedHistory[tailStart - 1] as any)?.function_call)) {
      tailStart--;
    }

    // 3. Garantir integridade no bloco pinned (Turno 0/1)
    let pinnedEnd = 2;
    while (pinnedEnd < tailStart && ((deduplicatedHistory[pinnedEnd] as any)?.role === 'tool' || (deduplicatedHistory[pinnedEnd] as any)?.tool_call_id)) {
      pinnedEnd++;
    }

    if (tailStart <= pinnedEnd) {
      return { history: deduplicatedHistory, wasCompressed: wasDeduplicated };
    }

    const pinned = deduplicatedHistory.slice(0, pinnedEnd);
    const tail = deduplicatedHistory.slice(tailStart);
    const middle = deduplicatedHistory.slice(pinnedEnd, tailStart);

    let summaryBlock = '';

    if (options.summarizer) {
      try {
        summaryBlock = await options.summarizer(middle);
      } catch {
        summaryBlock = ContextCompressor.generateDeterministicFallback(middle);
      }
    } else {
      summaryBlock = ContextCompressor.generateDeterministicFallback(middle);
    }

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: summaryBlock
    };

    const orchestratedHistory: ChatMessage[] = [
      ...pinned,
      summaryMessage,
      ...tail
    ];

    return { history: orchestratedHistory, wasCompressed: true };
  }

  static generateDeterministicFallback(middleMessages: ChatMessage[]): string {
    const modifiedFiles = new Set<string>();
    const actionsTaken: string[] = [];

    for (const msg of middleMessages) {
      if (msg.role === 'assistant') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.action?.path) {
            modifiedFiles.add(parsed.action.path);
          }
          if (parsed.summary) {
            actionsTaken.push(parsed.summary);
          }
        } catch {
          // fallback regex search
          const fileMatch = msg.content.match(/(?:create_file|modify_file|path)["':\s]+([^"'\s,}]+)/);
          if (fileMatch) modifiedFiles.add(fileMatch[1]);
        }
      }
    }

    const filesStr = modifiedFiles.size > 0 ? Array.from(modifiedFiles).join(', ') : 'Arquivos do workspace';
    const recentActions = actionsTaken.slice(-3).join('; ') || 'Progresso acumulado de execução da tarefa';

    return [
      `[Summary of earlier turns]`,
      `- Objetivo Principal: Continuidade da execução da tarefa solicitada pelo usuário`,
      `- Decisões Técnicas: ${recentActions}`,
      `- Arquivos Modificados: ${filesStr}`,
      `- Próximo Passo: Prosseguir com os turnos imediatos da conversa`
    ].join('\n');
  }
}
