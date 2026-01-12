import { z } from 'zod';

// Zod Schema for Agent Request Payload
export const AgentRequestSchema = z.object({
    user_prompt: z.string().min(1, 'User prompt cannot be empty'),
    streaming: z.boolean().default(true),
    stackspot_knowledge: z.boolean().default(true),
    return_ks_in_response: z.boolean().default(false),
    use_conversation: z.boolean().default(true),
    conversation_id: z.string().optional(),
});

// TypeScript type derived from schema
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

// Options for building agent request (all fields optional except prompt)
export interface AgentRequestOptions {
    streaming?: boolean;
    stackspot_knowledge?: boolean;
    return_ks_in_response?: boolean;
    use_conversation?: boolean;
    conversation_id?: string;
}

/**
 * Builds a validated agent request payload.
 * 
 * @param prompt - The user's prompt/message to send to the agent
 * @param options - Optional configuration overrides
 * @returns Validated AgentRequest object
 * @throws ZodError if validation fails
 */
export function buildAgentRequest(
    prompt: string,
    options: AgentRequestOptions = {}
): AgentRequest {
    const payload = {
        user_prompt: prompt,
        streaming: options.streaming ?? true,
        stackspot_knowledge: options.stackspot_knowledge ?? true,
        return_ks_in_response: options.return_ks_in_response ?? false,
        use_conversation: options.use_conversation ?? true,
        conversation_id: options.conversation_id,
    };

    // Validate and return
    return AgentRequestSchema.parse(payload);
}
