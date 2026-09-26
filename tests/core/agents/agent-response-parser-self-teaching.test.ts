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

  it('deve rejeitar formato plano {"action": "read_file", ...} com [SYSTEM ERROR] e isError: true', () => {
    const raw = JSON.stringify({
      action: 'read_file',
      path: 'src/routes/index.tsx',
      start_line: 0,
      end_line: 250
    });

    const parsed = parseAgentResponse(raw);
    expect(parsed.isError).toBe(true);
    expect(parsed.action?.type).toBe('talk_with_user');
    expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
    expect(parsed.action?.content).toContain('Formato de envelope de ação inválido');
    expect(parsed.action?.content).toContain('"type": "read_file"');
  });

  it('deve manter o loop ativo sem retornar texto cru no fallback silencioso', () => {
    const raw = JSON.stringify({
      action: 'unknown_tool_xyz',
      foo: 'bar'
    });

    const parsed = parseAgentResponse(raw);
    expect(parsed.isError).toBe(true);
    expect(parsed.action?.type).toBe('talk_with_user');
    expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
  });
});

