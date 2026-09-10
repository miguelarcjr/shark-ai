import { describe, it, expect } from 'vitest';
import { ContextCompressor } from '../../../src/core/workflow/context-compressor.js';
import { ChatMessage } from '../../../src/core/workflow/history-manager.js';

describe('ContextCompressor with Tail Protection', () => {
  it('should not compress if total tokens are below threshold ratio (80%)', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'start task' },
      { role: 'assistant', content: 'working' }
    ];

    const result = await ContextCompressor.compress(history, { tokenLimit: 10000 });
    expect(result.wasCompressed).toBe(false);
    expect(result.history).toHaveLength(3);
  });

  it('should preserve Pinned Turn 0/1 and Tail (last 15 messages) when compressing', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM_PINNED' },
      { role: 'user', content: 'INITIAL_GOAL' }
    ];

    // Gerar 30 mensagens intermediárias
    for (let i = 0; i < 30; i++) {
      history.push({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `Middle message ${i}: ` + 'detalhes técnicos '.repeat(50)
      });
    }

    const lastMsg = history[history.length - 1];

    const result = await ContextCompressor.compress(history, {
      tokenLimit: 1000,
      thresholdRatio: 0.8,
      tailSize: 15
    });

    expect(result.wasCompressed).toBe(true);
    // Pinned
    expect(result.history[0].content).toBe('SYSTEM_PINNED');
    expect(result.history[1].content).toBe('INITIAL_GOAL');
    // Summary no meio
    expect(result.history[2].content).toContain('[Summary of earlier turns]');
    // Cauda preservada (última mensagem deve ser idêntica)
    expect(result.history[result.history.length - 1]).toEqual(lastMsg);
    // Tamanho total: 2 (pinned) + 1 (summary) + 15 (tail) = 18
    expect(result.history).toHaveLength(18);
  });

  it('should use deterministic fallback when custom summarizer throws error', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'goal' },
      { role: 'assistant', content: 'action: edit file src/app.ts' },
      { role: 'user', content: 'ok' }
    ];

    for (let i = 0; i < 20; i++) {
      history.push({ role: 'assistant', content: `extra message ${i} ` + 'texto '.repeat(30) });
    }

    const failingSummarizer = async () => {
      throw new Error('LLM Rate limit / Timeout');
    };

    const result = await ContextCompressor.compress(history, {
      tokenLimit: 500,
      thresholdRatio: 0.5,
      tailSize: 5,
      summarizer: failingSummarizer
    });

    expect(result.wasCompressed).toBe(true);
    const summaryMessage = result.history.find(m => m.content.includes('[Summary of earlier turns]'));
    expect(summaryMessage).toBeDefined();
    expect(summaryMessage?.content).toContain('- Objetivo Principal:');
    expect(summaryMessage?.content).toContain('- Decisões Técnicas:');
  });

  it('should preserve tool_call and tool_result pairs across compression boundaries', async () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'SYSTEM_PINNED' },
      { role: 'user', content: 'INITIAL_GOAL' }
    ];

    // Adiciona mensagens normais intermediárias
    for (let i = 0; i < 20; i++) {
      history.push({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `Long middle turn ${i} ` + 'palavras chave '.repeat(40)
      });
    }

    // Logo antes da cauda padrão (tailSize = 5), insere uma chamada de ferramenta assistant e sua resposta tool
    // Isso simula o corte exatamente no meio do par de ferramenta!
    const assistantWithTool: any = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'run_command', arguments: '{"cmd":"ls"}' } }]
    };
    const toolResponse: any = {
      role: 'tool',
      tool_call_id: 'call_123',
      content: 'file1.txt\nfile2.txt'
    };

    history.push(assistantWithTool);
    history.push(toolResponse);

    // E adiciona mais 4 mensagens para compor a cauda
    for (let j = 0; j < 4; j++) {
      history.push({ role: 'user', content: `Final question ${j}` });
    }

    const result = await ContextCompressor.compress(history, {
      tokenLimit: 1000,
      thresholdRatio: 0.8,
      tailSize: 5
    });

    expect(result.wasCompressed).toBe(true);

    // Verifica que a resposta 'tool' NÃO ficou órfã: o 'assistant' com tool_calls DEVE estar presente antes dela
    const toolIndex = result.history.findIndex(m => m.role === 'tool');
    expect(toolIndex).toBeGreaterThan(0);
    const precedingMsg = result.history[toolIndex - 1];
    expect(precedingMsg.role).toBe('assistant');
    expect((precedingMsg as any).tool_calls).toBeDefined();
  });
});
