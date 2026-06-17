import { describe, it, expect } from 'vitest';
import { parseAgentResponse, AgentResponseSchema } from './agent-response-parser.js';
import { ZodError } from 'zod';

describe('AgentResponseParser', () => {
    it('should parse complete response with all fields', () => {
        const rawResponse = {
            summary: 'Here is your solution...',
            action: { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' },
            conversation_id: 'conv-abc123',
        };

        const result = parseAgentResponse(rawResponse);

        expect(result.summary).toBe('Here is your solution...');
        expect(result.action?.type).toBe('create_file');
        expect(result.conversation_id).toBe('conv-abc123');
    });

    it('should parse minimal response with only required fields', () => {
        const minimalResponse = {
            action: { type: 'talk_with_user', content: 'Hello' }
        };

        const result = parseAgentResponse(minimalResponse);

        expect(result.action?.type).toBe('talk_with_user');
        expect(result.conversation_id).toBeUndefined();
    });

    it('should throw ZodError on missing action type', () => {
        const invalidResponse = {
            action: { path: 'test.ts' } // missing 'type'
        };

        expect(() => AgentResponseSchema.parse(invalidResponse)).toThrow(ZodError);
    });

    it('should handle empty summary as valid', () => {
        const emptySummary = {
            summary: '',
            action: null
        };

        const result = parseAgentResponse(emptySummary);
        expect(result.summary).toBe('');
    });

    it('should validate schema with optional summary', () => {
        const responseWithAction = {
            action: { type: 'talk_with_user', content: 'Test' }
        };

        const result = AgentResponseSchema.parse(responseWithAction);
        expect(result.action?.type).toBe('talk_with_user');
    });

    it('should handle legacy actions array and map to single action', () => {
        const response = {
            summary: 'Response with actions array',
            actions: [
                { type: 'create_file', path: 'file.txt', content: 'data' }
            ]
        };

        const result = parseAgentResponse(response);
        expect(result.action?.type).toBe('create_file');
        expect(result.action?.path).toBe('file.txt');
    });

    it('should throw on invalid action type', () => {
        const invalidAction = {
            action: { type: 'invalid_type', content: 'Oops' }
        };

        expect(() => parseAgentResponse(invalidAction)).toThrow(ZodError);
    });

    it('should parse response with a single action', () => {
        const raw = {
            summary: 'Created test file',
            action: { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' }
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('create_file');
        expect(result.action?.path).toBe('test.ts');
    });

    it('should fallback to talk_with_user action for raw text', () => {
        const result = parseAgentResponse('Hello user');
        expect(result.action?.type).toBe('talk_with_user');
        expect(result.action?.content).toBe('Hello user');
    });
});
