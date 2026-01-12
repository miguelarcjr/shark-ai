import { z } from 'zod';

export enum ProjectParams {
    PROJECT_ID = 'projectId',
    PROJECT_NAME = 'projectName',
    TECH_STACK = 'techStack',
}

export const TechStackEnum = z.enum([
    'react',
    'nextjs',
    'angular',
    'vue',
    'node-ts',
    'python',
    'dotnet',
    'java',
    'unknown'
]);

export type TechStack = z.infer<typeof TechStackEnum>;

export const WorkflowStageEnum = z.enum([
    'business_analysis',
    'specification',
    'architecture',
    'development',
    'verification',
    'deployment'
]);

export type WorkflowStage = z.infer<typeof WorkflowStageEnum>;

export const StageStatusEnum = z.enum([
    'pending',
    'in_progress',
    'completed',
    'failed',
    'skipped'
]);

export type StageStatus = z.infer<typeof StageStatusEnum>;

export const WorkflowSchema = z.object({
    projectId: z.string().uuid(),
    projectName: z.string().min(1),
    techStack: TechStackEnum.default('unknown'),
    currentStage: WorkflowStageEnum.default('business_analysis'),
    stageStatus: StageStatusEnum.default('pending'),
    lastUpdated: z.string().datetime(), // ISO 8601
    conversationId: z.string().optional(),
    conversations: z.record(z.string(), z.string()).optional(), // agentType -> conversationId
    artifacts: z.array(z.string()).default([]),
    // Extensible metadata bag
    metadata: z.record(z.unknown()).optional(),
});

export type WorkflowState = z.infer<typeof WorkflowSchema>;
