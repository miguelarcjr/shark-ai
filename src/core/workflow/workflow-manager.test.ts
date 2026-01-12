import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkflowManager } from './workflow-manager.js';
import fs from 'fs/promises';
import path from 'path';

// Mock fs/promises
vi.mock('fs/promises');

describe('WorkflowManager', () => {
    const manager = WorkflowManager.getInstance();
    const mockState = {
        projectId: '123e4567-e89b-12d3-a456-426614174000',
        projectName: 'test-project',
        techStack: 'node-ts',
        currentStage: 'specification',
        stageStatus: 'in_progress',
        lastUpdated: new Date().toISOString(),
        artifacts: []
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(process, 'cwd').mockReturnValue('/app');
    });

    it('should save workflow state atomically', async () => {
        await manager.save(mockState as any);

        const expectedTmpPath = path.join('/app', '.shark-workflow.tmp');
        const expectedFinalPath = path.join('/app', 'shark-workflow.json');

        // Check validation (implicit by reaching here)
        // Check write to tmp
        expect(fs.writeFile).toHaveBeenCalledWith(
            expectedTmpPath,
            expect.stringContaining('"projectName": "test-project"'),
            'utf-8'
        );

        // Check rename
        expect(fs.rename).toHaveBeenCalledWith(expectedTmpPath, expectedFinalPath);
    });

    it('should throw error on invalid state save', async () => {
        const invalidState = { ...mockState, projectId: 'invalid-id' };

        await expect(manager.save(invalidState as any)).rejects.toThrow('Invalid workflow state');
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should load valid workflow state', async () => {
        const filePath = path.join('/app', 'shark-workflow.json');

        vi.mocked(fs.access).mockResolvedValue(undefined);
        vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockState));

        const state = await manager.load();
        expect(state).toEqual(mockState);
    });

    it('should return null if file does not exist', async () => {
        vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

        const state = await manager.load();
        expect(state).toBeNull();
    });

    it('should return null (and warn) if file is corrupted', async () => {
        const filePath = path.join('/app', 'shark-workflow.json');

        vi.mocked(fs.access).mockResolvedValue(undefined);
        vi.mocked(fs.readFile).mockResolvedValue('{ "invalid": "json" }'); // Missing required fields

        const state = await manager.load();
        expect(state).toBeNull();
    });
});
