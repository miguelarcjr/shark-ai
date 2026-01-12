import { describe, it, expect } from 'vitest';
import { WorkflowSchema, WorkflowStageEnum, StageStatusEnum } from './shark-workflow.schema.js';

describe('Workflow Schema', () => {
    it('should validate a correct workflow state', () => {
        const validState = {
            projectId: '123e4567-e89b-12d3-a456-426614174000',
            projectName: 'my-project',
            techStack: 'node-ts',
            currentStage: 'specification',
            stageStatus: 'in_progress',
            lastUpdated: new Date().toISOString(),
            artifacts: ['file1.md', 'file2.ts']
        };

        const result = WorkflowSchema.safeParse(validState);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.projectName).toBe('my-project');
        }
    });

    it('should fail on invalid uuid', () => {
        const invalidState = {
            projectId: 'not-a-uuid',
            projectName: 'my-project',
            lastUpdated: new Date().toISOString()
        };

        const result = WorkflowSchema.safeParse(invalidState);
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].code).toBe('invalid_string');
        }
    });

    it('should use default values', () => {
        const minimalState = {
            projectId: '123e4567-e89b-12d3-a456-426614174000',
            projectName: 'defaults',
            lastUpdated: new Date().toISOString()
        };

        const result = WorkflowSchema.safeParse(minimalState);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.currentStage).toBe('business_analysis');
            expect(result.data.stageStatus).toBe('pending');
            expect(result.data.techStack).toBe('unknown');
            expect(result.data.artifacts).toEqual([]);
        }
    });
});
