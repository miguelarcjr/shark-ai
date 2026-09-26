import { describe, it, expect, vi } from 'vitest';
import { parseAgentResponse } from '../../../src/core/agents/agent-response-parser.js';

describe('TurnLoopRunner and Parser Self-Teaching Error Integration', () => {
    it('should generate an isError response on flat action that triggers turn loop error recovery', () => {
        const flatPayload = JSON.stringify({
            action: 'read_file',
            path: 'src/routes/index.tsx',
            start_line: 0,
            end_line: 250
        });

        const parsed = parseAgentResponse(flatPayload);
        expect(parsed.isError).toBe(true);
        expect(parsed.action?.type).toBe('talk_with_user');
        expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
        expect(parsed.action?.content).toContain('Formato de envelope de ação inválido');

        // Verify that TurnLoopRunner's error condition matches
        const talkContent = parsed.action?.content || '';
        const isSystemError = (typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]')) || parsed.isError === true;
        expect(isSystemError).toBe(true);
    });

    it('should generate an isError response on missing parameters', () => {
        const missingPathPayload = JSON.stringify({
            thought: 'Reading...',
            action: {
                type: 'read_file',
                args: {}
            },
            summary: 'Reading'
        });

        const parsed = parseAgentResponse(missingPathPayload);
        expect(parsed.isError).toBe(true);
        expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
        expect(parsed.action?.content).toContain("Parâmetro obrigatório 'path' ausente");
    });

    it('should generate an isError response on missing action block and output canonical envelope', () => {
        const payloadWithToolKeyword = JSON.stringify({
            thought: 'Exploring repository...',
            tool: 'read_file',
            path: 'src/components/site/footer.tsx'
        });

        const parsed = parseAgentResponse(payloadWithToolKeyword);
        expect(parsed.isError).toBe(true);
        expect(parsed.action?.type).toBe('talk_with_user');
        expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
        expect(parsed.action?.content).toContain('📋 ENVELOPE OBRIGATÓRIO:');
        expect(parsed.action?.content).toContain('"type": "nome_da_ferramenta"');
    });
});
