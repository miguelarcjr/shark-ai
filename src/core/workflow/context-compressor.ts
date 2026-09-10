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

  static async compress(
    history: ChatMessage[],
    options: CompressOptions
  ): Promise<{ history: ChatMessage[]; wasCompressed: boolean }> {
    const thresholdRatio = options.thresholdRatio ?? 0.8;
    const tailSize = options.tailSize ?? 15;
    const tokenLimit = options.tokenLimit;

    // Se o histórico não tem turnos intermediários suficientes para comprimir, retorna
    const minRequired = 2 + tailSize + 1; // Pinned (2) + Tail + Pelo menos 1 para resumir
    if (history.length <= minRequired) {
      return { history, wasCompressed: false };
    }

    const totalTokens = ContextCompressor.calculateHistoryTokens(history);
    const triggerThreshold = tokenLimit * thresholdRatio;

    if (totalTokens <= triggerThreshold) {
      return { history, wasCompressed: false };
    }

    // Particionamento inteligente com preservação de pares de ferramentas
    let tailStart = history.length - tailSize;

    // 1. Se a cauda cortar no meio de respostas de ferramentas (role: 'tool' ou tool_call_id),
    // retroceder tailStart até incluir a mensagem 'assistant' que as invocou.
    while (tailStart > 2 && (history[tailStart]?.role === 'tool' || (history[tailStart] as any)?.tool_call_id)) {
      tailStart--;
    }

    // 2. Se a mensagem logo antes da cauda for uma chamada 'assistant' com tool_calls,
    // incluí-la na cauda para que suas respostas correspondentes fiquem no mesmo bloco.
    if (tailStart > 2 && ((history[tailStart - 1] as any)?.tool_calls?.length > 0 || (history[tailStart - 1] as any)?.function_call)) {
      tailStart--;
    }

    // 3. Garantir integridade no bloco pinned (Turno 0/1)
    let pinnedEnd = 2;
    while (pinnedEnd < tailStart && (history[pinnedEnd]?.role === 'tool' || (history[pinnedEnd] as any)?.tool_call_id)) {
      pinnedEnd++;
    }

    if (tailStart <= pinnedEnd) {
      return { history, wasCompressed: false };
    }

    const pinned = history.slice(0, pinnedEnd);
    const tail = history.slice(tailStart);
    const middle = history.slice(pinnedEnd, tailStart);

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
