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

    it('preserves path in action.args for file tools (read_file, list_files, modify_file)', () => {
        const input = {
            thought: 'Reading file',
            action: {
                type: 'read_file',
                args: { path: 'src/routes/index.tsx' }
            },
            summary: 'Reading index'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({ path: 'src/routes/index.tsx' });
    });

    it('hoists top-level action.path into args.path when args is missing', () => {
        const input = {
            thought: 'Listing directory',
            action: {
                type: 'list_files',
                path: 'src/components'
            },
            summary: 'Listing components'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({ path: 'src/components' });
    });

    it('preserves arbitrary tool arguments for commands, search, and MCP tools', () => {
        const input = {
            thought: 'Searching code',
            action: {
                type: 'search_code',
                args: { query: 'export function', path: 'src/**/*', is_regex: false }
            },
            summary: 'Searching'
        };

        const result = toCanonicalAssistantMessage(input);
        const parsed = JSON.parse(result);

        expect(parsed.action.args).toEqual({
            query: 'export function',
            path: 'src/**/*',
            is_regex: false
        });
    });
});
