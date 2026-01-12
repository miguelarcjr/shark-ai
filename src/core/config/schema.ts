import { z } from 'zod';

export const ConfigSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
        scan: z.string().optional()
    }).default({})
});

export type Config = z.infer<typeof ConfigSchema>;
