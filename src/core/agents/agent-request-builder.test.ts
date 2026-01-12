import { describe, it, expect } from 'vitest';
import { buildAgentRequest, AgentRequestSchema } from './agent-request-builder.js';
import { ZodError } from 'zod';

describe('AgentRequestBuilder', () => {
    it('should build request with default values', () => {
        const result = buildAgentRequest('Test prompt');

        expect(result).toEqual({
            user_prompt: 'Test prompt',
            streaming: true,
            stackspot_knowledge: true,
            return_ks_in_response: false,
            use_conversation: true,
            conversation_id: undefined,
        });
    });

    it('should override defaults with provided options', () => {
        const result = buildAgentRequest('Test prompt', {
            streaming: false,
            stackspot_knowledge: false,
            conversation_id: 'conv-123',
        });

        expect(result).toEqual({
            user_prompt: 'Test prompt',
            streaming: false,
            stackspot_knowledge: false,
            return_ks_in_response: false,
            use_conversation: true,
            conversation_id: 'conv-123',
        });
    });

    it('should throw ZodError on empty prompt', () => {
        expect(() => buildAgentRequest('')).toThrow(ZodError);
    });

    it('should validate schema correctly', () => {
        const validPayload = {
            user_prompt: 'Valid prompt',
            streaming: true,
            stackspot_knowledge: true,
            return_ks_in_response: false,
            use_conversation: true,
        };

        const result = AgentRequestSchema.parse(validPayload);
        expect(result).toEqual(validPayload);
    });

    it('should apply defaults when fields are missing', () => {
        const minimalPayload = {
            user_prompt: 'Minimal prompt',
        };

        const result = AgentRequestSchema.parse(minimalPayload);

        expect(result.streaming).toBe(true);
        expect(result.stackspot_knowledge).toBe(true);
        expect(result.return_ks_in_response).toBe(false);
        expect(result.use_conversation).toBe(true);
    });

    it('should handle all options set to false', () => {
        const result = buildAgentRequest('Test', {
            streaming: false,
            stackspot_knowledge: false,
            return_ks_in_response: false,
            use_conversation: false,
        });

        expect(result.streaming).toBe(false);
        expect(result.stackspot_knowledge).toBe(false);
        expect(result.return_ks_in_response).toBe(false);
        expect(result.use_conversation).toBe(false);
    });
});
