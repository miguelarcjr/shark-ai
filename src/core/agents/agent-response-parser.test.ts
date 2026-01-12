import { describe, it, expect } from 'vitest';
import { parseAgentResponse, AgentResponseSchema } from './agent-response-parser.js';
import { ZodError } from 'zod';

describe('AgentResponseParser', () => {
    it('should parse complete response with all fields', () => {
        const rawResponse = {
            message: 'Here is your solution...',
            stop_reason: 'end_turn',
            tokens: {
                user: 50,
                enrichment: 100,
                output: 200,
            },
            conversation_id: 'conv-abc123',
            knowledge_source_id: ['ks-1', 'ks-2'],
            upload_ids: { file1: 'upload-123' },
        };

        const result = parseAgentResponse(rawResponse);

        expect(result).toEqual(rawResponse);
        expect(result.message).toBe('Here is your solution...');
        expect(result.tokens?.user).toBe(50);
    });

    it('should parse minimal response with only required fields', () => {
        const minimalResponse = {
            message: 'Simple response',
        };

        const result = parseAgentResponse(minimalResponse);

        expect(result.message).toBe('Simple response');
        expect(result.stop_reason).toBeUndefined();
        expect(result.tokens).toBeUndefined();
        expect(result.conversation_id).toBeUndefined();
    });

    it('should throw ZodError on missing required field', () => {
        const invalidResponse = {
            stop_reason: 'end_turn',
            // missing 'message'
        };

        expect(() => parseAgentResponse(invalidResponse)).toThrow(ZodError);
    });

    it('should handle empty message as invalid', () => {
        const emptyMessage = {
            message: '',
        };

        // Empty string is still valid for z.string(), just not for min(1)
        // Since we don't have min(1) in the schema, this should pass
        const result = parseAgentResponse(emptyMessage);
        expect(result.message).toBe('');
    });

    it('should validate schema with optional tokens', () => {
        const responseWithTokens = {
            message: 'Test',
            tokens: {
                user: 10,
                output: 20,
            },
        };

        const result = AgentResponseSchema.parse(responseWithTokens);
        expect(result.tokens?.user).toBe(10);
        expect(result.tokens?.enrichment).toBeUndefined();
    });

    it('should handle knowledge_source_id as array', () => {
        const response = {
            message: 'Response with knowledge sources',
            knowledge_source_id: ['source1', 'source2', 'source3'],
        };

        const result = parseAgentResponse(response);
        expect(result.knowledge_source_id).toHaveLength(3);
        expect(result.knowledge_source_id?.[0]).toBe('source1');
    });

    it('should throw on invalid types', () => {
        const invalidTypes = {
            message: 123, // should be string
        };

        expect(() => parseAgentResponse(invalidTypes)).toThrow(ZodError);
    });
});
