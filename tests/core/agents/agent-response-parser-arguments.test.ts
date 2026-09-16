import { describe, it, expect } from 'vitest';
import { parseAgentResponse } from '../../../src/core/agents/agent-response-parser.js';

describe('AgentResponseParser - arguments handling', () => {
    it('deve parsear tool_call quando arguments for string JSON', () => {
        const raw = JSON.stringify({
            thought: 'Chamando ferramenta',
            action: {
                type: 'tool_call',
                args: {
                    name: 'get_weather',
                    arguments: '{"city":"Sao Paulo"}'
                }
            },
            summary: 'Chamou tool'
        });

        const parsed = parseAgentResponse(raw);
        expect(parsed.isError).toBeFalsy();
        expect(parsed.action?.type).toBe('tool_call');
        expect(parsed.action?.name).toBe('get_weather');
        expect(parsed.action?.arguments).toBe('{"city":"Sao Paulo"}');
    });

    it('deve parsear tool_call quando arguments for objeto', () => {
        const raw = JSON.stringify({
            thought: 'Chamando ferramenta objeto',
            action: {
                type: 'tool_call',
                args: {
                    name: 'get_weather',
                    arguments: { city: 'Sao Paulo' }
                }
            },
            summary: 'Chamou tool'
        });

        const parsed = parseAgentResponse(raw);
        expect(parsed.isError).toBeFalsy();
        expect(parsed.action?.type).toBe('tool_call');
        expect(parsed.action?.name).toBe('get_weather');
        expect(parsed.action?.arguments).toEqual({ city: 'Sao Paulo' });
    });
});
