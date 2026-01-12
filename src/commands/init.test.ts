import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initAction } from './init.js';
import { tui } from '../ui/tui.js';
import { workflowManager } from '../core/workflow/workflow-manager.js';

// Mocks
vi.mock('../ui/tui.js', () => ({
    tui: {
        intro: vi.fn(),
        outro: vi.fn(),
        text: vi.fn(),
        select: vi.fn(),
        confirm: vi.fn(),
        isCancel: vi.fn(),
        spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            success: vi.fn(),
            message: vi.fn()
        }
    }
}));
vi.mock('../core/workflow/workflow-manager.js');

describe('Init Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Default mocks
        vi.mocked(tui.isCancel).mockReturnValue(false);
        vi.mocked(tui.spinner).mockReturnValue({
            start: vi.fn(),
            stop: vi.fn(),
            message: vi.fn()
        });
    });

    it('should initialize a new project successfully', async () => {
        // Mock no existing file
        vi.mocked(workflowManager.load).mockResolvedValue(null);

        // Mock Inputs
        vi.mocked(tui.text).mockResolvedValue('My new App');
        vi.mocked(tui.select).mockResolvedValue('react');

        await initAction();

        // Verify Save
        expect(workflowManager.save).toHaveBeenCalledWith(expect.objectContaining({
            projectName: 'My new App',
            techStack: 'react',
            currentStage: 'business_analysis',
            stageStatus: 'pending'
        }));

        expect(tui.outro).toHaveBeenCalledWith(expect.stringContaining('Ready to start'));
    });

    it('should allow resuming an existing project', async () => {
        vi.mocked(workflowManager.load).mockResolvedValue({
            projectName: 'Existing App',
            currentStage: 'specification',
            lastUpdated: new Date().toISOString()
        } as any);

        // Mock Select -> Resume
        vi.mocked(tui.select).mockResolvedValue('resume');

        await initAction();

        expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('Resuming work'));
        expect(workflowManager.save).not.toHaveBeenCalled();
    });

    it('should prompt to overwrite if user selects overwrite', async () => {
        vi.mocked(workflowManager.load).mockResolvedValue({
            projectName: 'Old Project',
            lastUpdated: new Date().toISOString()
        } as any);

        // Mock Select -> Overwrite
        vi.mocked(tui.select).mockResolvedValueOnce('overwrite');
        // Mock Name Input (Step 2)
        vi.mocked(tui.text).mockResolvedValue('New Project');
        // Mock Stack Input
        vi.mocked(tui.select).mockResolvedValue('node-ts');

        await initAction();

        expect(workflowManager.save).toHaveBeenCalledWith(expect.objectContaining({
            projectName: 'New Project'
        }));
    });

    it('should exit if user selects exit', async () => {
        vi.mocked(workflowManager.load).mockResolvedValue({
            projectName: 'Old Project',
            lastUpdated: new Date().toISOString()
        } as any);

        // Mock Select -> Exit
        vi.mocked(tui.select).mockResolvedValue('exit');

        await initAction();

        expect(workflowManager.save).not.toHaveBeenCalled();
        expect(tui.outro).toHaveBeenCalledWith(expect.stringContaining('See you later'));
    });

    it('should cancel if user cancels name input', async () => {
        vi.mocked(workflowManager.load).mockResolvedValue(null);

        vi.mocked(tui.text).mockResolvedValue(Symbol('cancel') as any);
        vi.mocked(tui.isCancel).mockReturnValue(true);

        await initAction();

        expect(workflowManager.save).not.toHaveBeenCalled();
        expect(tui.outro).toHaveBeenCalledWith('Initialization cancelled.');
    });
});
