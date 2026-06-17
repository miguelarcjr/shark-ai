import { describe, it, expect, vi, beforeEach } from 'vitest';
import { legacyCommand } from './legacy.js';
import { TaskManager } from '../core/workflow/task-manager.js';
import { interactiveDeveloperAgent } from '../core/agents/legacy-developer-agent.js';
import { tui } from '../ui/tui.js';

vi.mock('../core/workflow/task-manager.js');
vi.mock('../core/agents/legacy-developer-agent.js');
vi.mock('../ui/tui.js', () => ({
    tui: {
        intro: vi.fn(),
        outro: vi.fn(),
        log: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            success: vi.fn(),
            warning: vi.fn(),
        },
        select: vi.fn(),
        confirm: vi.fn(),
        text: vi.fn(),
        isCancel: vi.fn(),
    }
}));

describe('Legacy Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should run the legacy orchestrator loop', async () => {
        const mockTaskManager = {
            analyzeSpecState: vi.fn().mockReturnValue({
                status: 'PENDING',
                nextTask: { id: 'task-1', description: 'Test legacy task' }
            }),
            markTaskInProgress: vi.fn(),
            markTaskAsDone: vi.fn(),
        };
        vi.mocked(TaskManager).mockImplementation(() => mockTaskManager as any);

        vi.mocked(tui.select).mockResolvedValueOnce('execute').mockResolvedValueOnce('stop');
        vi.mocked(interactiveDeveloperAgent).mockResolvedValue({
            success: true,
            summary: 'Legacy task completed'
        });

        await legacyCommand.parseAsync(['node', 'shark', 'legacy']);

        expect(tui.intro).toHaveBeenCalledWith(expect.stringContaining('Shark Legacy Orchestrator'));
        expect(mockTaskManager.markTaskInProgress).toHaveBeenCalledWith('task-1');
        expect(interactiveDeveloperAgent).toHaveBeenCalledWith(expect.objectContaining({
            taskId: 'task-1',
            taskInstruction: 'Test legacy task',
        }));
        expect(mockTaskManager.markTaskAsDone).toHaveBeenCalledWith('task-1');
    });
});
