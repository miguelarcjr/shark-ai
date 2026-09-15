import { describe, it, expect } from 'vitest';
import { sanitizeResponseSchema } from '../../../src/core/api/schema-sanitizer.js';
import { COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA } from '../../../src/core/api/prompts.js';

describe('sanitizeResponseSchema', () => {
  it('deve remover bridge tools do enum de type se hasMcpServers for false', () => {
    const sanitized = sanitizeResponseSchema(COORDINATOR_RESPONSE_JSON_SCHEMA, { hasMcpServers: false });
    const types = sanitized.properties.action.properties.type.enum;
    expect(types).not.toContain('tool_search');
    expect(types).not.toContain('tool_describe');
    expect(types).not.toContain('tool_call');
  });

  it('deve manter bridge tools se hasMcpServers for true', () => {
    const sanitized = sanitizeResponseSchema(COORDINATOR_RESPONSE_JSON_SCHEMA, { hasMcpServers: true });
    const types = sanitized.properties.action.properties.type.enum;
    expect(types).toContain('tool_search');
    expect(types).toContain('tool_describe');
    expect(types).toContain('tool_call');
  });

  it('o schema do subagente não deve conter ferramentas de orquestração nem diálogo', () => {
    const types = SUBAGENT_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum;
    expect(types).not.toContain('talk_with_user');
    expect(types).not.toContain('invoke_subagent');
    expect(types).not.toContain('wait');
  });
});
