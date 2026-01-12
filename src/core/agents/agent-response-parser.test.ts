import { describe, it, expect } from 'vitest';
import { parseAgentResponse, AgentResponseSchema } from './agent-response-parser.js';
import { ZodError } from 'zod';

describe('AgentResponseParser', () => {
    it('should parse complete response with all fields', () => {
        const rawResponse = {
            summary: 'Here is your solution...',
            actions: [
                { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' }
            ],
            conversation_id: 'conv-abc123',
        };

        const result = parseAgentResponse(rawResponse);

        expect(result.summary).toBe('Here is your solution...');
        expect(result.actions).toHaveLength(1);
        expect(result.conversation_id).toBe('conv-abc123');
    });

    it('should parse minimal response with only required fields', () => {
        const minimalResponse = {
            actions: [{ type: 'talk_with_user', content: 'Hello' }]
        };

        const result = parseAgentResponse(minimalResponse);

        expect(result.actions).toHaveLength(1);
        expect(result.conversation_id).toBeUndefined();
    });

    it('should throw ZodError on missing required field', () => {
        const invalidResponse = {
            summary: 'Missing actions',
            // missing 'actions'
        };

        // parseAgentResponse adds default actions if missing, 
        // but AgentResponseSchema.parse directly will fail.
        expect(() => AgentResponseSchema.parse(invalidResponse)).toThrow(ZodError);
    });

    it('should handle empty summary as valid', () => {
        const emptySummary = {
            summary: '',
            actions: []
        };

        const result = parseAgentResponse(emptySummary);
        expect(result.summary).toBe('');
    });

    it('should validate schema with optional summary', () => {
        const responseWithActions = {
            actions: [
                { type: 'talk_with_user', content: 'Test' }
            ],
        };

        const result = AgentResponseSchema.parse(responseWithActions);
        expect(result.actions).toHaveLength(1);
    });

    it('should handle complex response structure', () => {
        const response = {
            summary: 'Response with summary and actions',
            actions: [
                { type: 'talk_with_user', content: 'Step 1' },
                { type: 'create_file', path: 'file.txt', content: 'data' }
            ]
        };

        const result = parseAgentResponse(response);
        expect(result.actions).toHaveLength(2);
        expect(result.actions[0].type).toBe('talk_with_user');
    });

    it('should throw on invalid action type', () => {
        const invalidAction = {
            actions: [
                { type: 'invalid_type', content: 'Oops' }
            ],
        };

        expect(() => parseAgentResponse(invalidAction)).toThrow(ZodError);
    });
});
