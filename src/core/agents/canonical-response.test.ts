import { describe, it, expect } from 'vitest';
import { toCanonicalAssistantMessage } from './canonical-response.js';

describe('toCanonicalAssistantMessage', () => {
    it('strips redundant aliases and produces canonical { thought, action, summary }', () => {
        const bloated = {
            thought: 'Explicação detalhada',
            action: {
                type: 'talk_with_user',
                args: { content: 'Olá usuário!' },
                content: 'Olá usuário!',
                isSynthetic: true,
                path: ''
            },
            actions: [
                {
                    type: 'talk_with_user',
                    args: { content: 'Olá usuário!' },
                    content: 'Olá usuário!'
                }
            ],
            summary: 'Respondi ao usuário',
            message: 'Respondi ao usuário',
            conversation_id: 'conv-12345'
        };

        const result = toCanonicalAssistantMessage(bloated);
        const parsed = JSON.parse(result);

        expect(parsed).toEqual({
            thought: 'Explicação detalhada',
            action: {
                type: 'talk_with_user',
                args: { content: 'Olá usuário!' }
            },
            summary: 'Respondi ao usuário'
        });

        expect(parsed.actions).toBeUndefined();
        expect(parsed.message).toBeUndefined();
        expect(parsed.conversation_id).toBeUndefined();
        expect(parsed.action.content).toBeUndefined();
        expect(parsed.action.isSynthetic).toBeUndefined();
        expect(parsed.action.path).toBeUndefined();
    });

    it('handles JSON string inputs and consolidates action.content into args.content', () => {
        const jsonStr = JSON.stringify({
            thought: 'Test thought',
            action: {
                type: 'talk_with_user',
                content: 'Direct content'
            },
            summary: 'Summary text'
        });

        const result = toCanonicalAssistantMessage(jsonStr);
        const parsed = JSON.parse(result);

        expect(parsed).toEqual({
            thought: 'Test thought',
            action: {
                type: 'talk_with_user',
                args: { content: 'Direct content' }
            },
            summary: 'Summary text'
        });
    });

    it('returns raw text unchanged if input is plain text and not valid JSON', () => {
        const plain = 'Simple plain text response from agent';
        expect(toCanonicalAssistantMessage(plain)).toBe(plain);
    });
});
