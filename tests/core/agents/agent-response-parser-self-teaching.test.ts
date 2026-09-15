import { describe, it, expect } from 'vitest';
import { parseAgentResponse } from '../../../src/core/agents/agent-response-parser.js';

describe('Self-Teaching Errors in AgentResponseParser', () => {
  it('deve formatar erro instrucional para modify_file sem âncoras', () => {
    const rawResponse = JSON.stringify({
      thought: 'Editando...',
      action: {
        type: 'modify_file',
        args: { path: 'src/index.ts', novo_codigo: 'console.log(1);' }
      },
      summary: 'Editado.'
    });

    const parsed = parseAgentResponse(rawResponse);
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toContain('[Action modify_file Failed]');
    expect(parsed.errorMessage).toContain('start_anchor');
    expect(parsed.errorMessage).toContain('read_file');
  });

  it('deve aceitar payload válido com { type, args }', () => {
    const rawResponse = JSON.stringify({
      thought: 'Lendo...',
      action: {
        type: 'read_file',
        args: { path: 'src/index.ts' }
      },
      summary: 'Lendo index.'
    });

    const parsed = parseAgentResponse(rawResponse);
    expect(parsed.isError).toBe(false);
    expect(parsed.action?.type).toBe('read_file');
    expect((parsed.action as any)?.args?.path).toBe('src/index.ts');
  });
});
