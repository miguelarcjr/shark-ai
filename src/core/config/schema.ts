import { z } from 'zod';

export const ConfigSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    provider: z.enum(['stackspot', 'openai-compatible']).default('stackspot'),
    embeddings: z.object({
        provider: z.enum(['local', 'openai-compatible']).default('local'),
        model: z.string().default('all-MiniLM-L6-v2'),
    }).default({}),
    stackspot: z.object({
        agentId: z.string().default('01KEQCGJ65YENRA4QBXVN1YFFX'),
        subagentId: z.string().optional(),
        useServerConversation: z.boolean().default(true),
    }).optional().default({}),
    'openai-compatible': z.object({
        baseURL: z.string().default('http://localhost:11434/v1'),
        apiKey: z.string().default('ollama'),
        model: z.string().default('llama3'),
        useStructuredOutputs: z.boolean().default(true)
    }).optional(),
    preferredStack: z.array(z.string()).default([]),
    memory: z.object({
        compactionTokenLimit: z.number().default(8000),
    }).default({}),
    apiBaseUrl: z.string().optional(),
    language: z.enum(['pt-br', 'en-us', 'es-es']).default('pt-br'),
    project: z.string().optional(),
    environment: z.string().optional(),
    activeRealm: z.string().optional(), // Currently logged-in realm
    agents: z.object({
        dev: z.string().optional(),
    }).default({}),
    agentVersions: z.object({
        dev: z.string().optional(),
    }).default({})
});

export type Config = z.infer<typeof ConfigSchema>;
