import { z } from 'zod';

export const ConfigSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    preferredStack: z.array(z.string()).default([]),
    apiBaseUrl: z.string().optional(),
    language: z.enum(['pt-br', 'en-us']).default('pt-br'),
    project: z.string().optional(),
    environment: z.string().optional(),
    activeRealm: z.string().optional(), // Currently logged-in realm
});

export type Config = z.infer<typeof ConfigSchema>;
