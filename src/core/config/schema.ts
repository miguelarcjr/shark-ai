import { z } from 'zod';

export const ConfigSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    provider: z.enum(['stackspot', 'openai-compatible']).default('stackspot'),
    'openai-compatible': z.object({
        baseURL: z.string().default('http://localhost:11434/v1'),
        apiKey: z.string().default('ollama'),
        model: z.string().default('llama3'),
        useStructuredOutputs: z.boolean().default(true)
    }).optional(),
    preferredStack: z.array(z.string()).default([]),
    apiBaseUrl: z.string().optional(),
    language: z.enum(['pt-br', 'en-us', 'es-es']).default('pt-br'),
    project: z.string().optional(),
    environment: z.string().optional(),
    activeRealm: z.string().optional(), // Currently logged-in realm
    agents: z.object({
        dev: z.string().optional(),
        ba: z.string().optional(),
        spec: z.string().optional(),
        qa: z.string().optional(),
        scan: z.string().optional(),
        codeReview: z.string().optional()
    }).default({}),
    agentVersions: z.object({
        dev: z.string().optional(),
        ba: z.string().optional(),
        spec: z.string().optional(),
        qa: z.string().optional(),
        scan: z.string().optional(),
        codeReview: z.string().optional()
    }).default({}),
    validation: z.object({
        llmReviewExtensions: z.array(z.string()).default(['.ts', '.tsx']),
        syntaxCheckExtensions: z.array(z.string()).default(['*']),
        enablePostSaveValidation: z.boolean().default(true)
    }).default({})
});

export type Config = z.infer<typeof ConfigSchema>;
