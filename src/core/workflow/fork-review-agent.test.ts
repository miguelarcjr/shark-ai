import { describe, it, expect, vi, beforeEach } from 'vitest';
// ForkReviewAgent unit tests
import { ForkReviewAgent } from './fork-review-agent.js';

describe('ForkReviewAgent', () => {
  let mockMemoryStore: any;
  let mockSkillManager: any;
  let mockProvider: any;
  let notifications: string[];

  beforeEach(() => {
    notifications = [];
    mockMemoryStore = {
      updateFile: vi.fn().mockResolvedValue({ success: true, usage: '100/2200' }),
      readFile: vi.fn().mockResolvedValue('existing memory')
    };
    mockSkillManager = {
      manageSkill: vi.fn().mockResolvedValue({ status: 'success', message: 'Skill created' }),
      viewSkill: vi.fn().mockResolvedValue('# Skill content'),
      listSkills: vi.fn().mockResolvedValue('- skill-1')
    };
    mockProvider = {
      streamChat: vi.fn()
    };
  });

  it('should track turns and tool iterations and trigger at threshold', () => {
    const agent = new ForkReviewAgent({
      memoryStore: mockMemoryStore,
      skillManager: mockSkillManager,
      provider: mockProvider
    });

    for (let i = 0; i < 9; i++) {
      agent.onUserTurn();
    }
    expect(agent.shouldTrigger().trigger).toBe(false);

    agent.onUserTurn(); // 10th
    const check1 = agent.shouldTrigger();
    expect(check1.trigger).toBe(true);
    expect(check1.reviewMemory).toBe(true);
    expect(check1.reviewSkills).toBe(false);

    for (let i = 0; i < 10; i++) {
      agent.onToolIteration();
    }
    const check2 = agent.shouldTrigger();
    expect(check2.trigger).toBe(true);
    expect(check2.reviewMemory).toBe(true);
    expect(check2.reviewSkills).toBe(true);
  });

  it('should prevent concurrent reviews using isReviewing lock', async () => {
    const agent = new ForkReviewAgent({
      memoryStore: mockMemoryStore,
      skillManager: mockSkillManager,
      provider: mockProvider
    });

    agent.isReviewing = true;
    const history = [{ role: 'user', content: 'test' }];
    await agent.maybeTriggerReview(history);
    expect(mockProvider.streamChat).not.toHaveBeenCalled();

    const manualResult = await agent.triggerManualReview(history);
    expect(manualResult).toBe(false);
  });

  it('should execute multi-turn tool loop and exit when no more actions', async () => {
    mockProvider.streamChat
      // Turn 1: request read_file
      .mockResolvedValueOnce({
        thought: 'Let me view the skill first',
        actions: [{ type: 'skill_view', name: 'git-commit' }]
      })
      // Turn 2: update skill
      .mockResolvedValueOnce({
        thought: 'Now patching skill',
        actions: [{ type: 'skill_manage', action: 'patch', name: 'git-commit', old_string: 'a', new_string: 'b' }]
      })
      // Turn 3: completed, plain text (no actions)
      .mockResolvedValueOnce({
        thought: 'Done reviewing',
        actions: []
      });

    const agent = new ForkReviewAgent({
      memoryStore: mockMemoryStore,
      skillManager: mockSkillManager,
      provider: mockProvider,
      onNotification: (msg: string) => notifications.push(msg)
    });

    for (let i = 0; i < 10; i++) agent.onToolIteration();

    const history = [{ role: 'user', content: 'commit message guideline' }];
    await agent.maybeTriggerReview(history);
    await agent.currentReviewPromise;

    expect(mockProvider.streamChat).toHaveBeenCalledTimes(3);
    expect(mockSkillManager.viewSkill).toHaveBeenCalledWith('git-commit', undefined, expect.any(String));
    expect(mockSkillManager.manageSkill).toHaveBeenCalledWith(expect.objectContaining({
      action: 'patch',
      name: 'git-commit'
    }));
    expect(agent.itersSinceSkill).toBe(0);
    expect(agent.isReviewing).toBe(false);
    expect(notifications.some(n => n.includes('Skill'))).toBe(true);
  });

  it('should enforce Delete Gate on memory(remove)', async () => {
    mockProvider.streamChat.mockResolvedValueOnce({
      thought: 'Cleaning old memory',
      actions: [{ type: 'memory', action: 'remove', target: 'memory', content: 'outdated' }]
    }).mockResolvedValueOnce({
      thought: 'Done',
      actions: []
    });

    const agent = new ForkReviewAgent({
      memoryStore: mockMemoryStore,
      skillManager: mockSkillManager,
      provider: mockProvider
    });

    const history = [{ role: 'user', content: 'test' }];
    await agent.triggerManualReview(history);

    expect(mockMemoryStore.updateFile).not.toHaveBeenCalled();
    expect(agent.isReviewing).toBe(false);
  });

  it('should halt execution if token budget is exceeded', async () => {
    mockProvider.streamChat.mockResolvedValue({
      thought: 'A very large response that consumes budget',
      actions: [{ type: 'skill_view', name: 'large-skill' }]
    });

    const agent = new ForkReviewAgent({
      memoryStore: mockMemoryStore,
      skillManager: mockSkillManager,
      provider: mockProvider,
      tokenBudget: 50 // very small budget
    });

    const history = [{ role: 'user', content: 'test conversation with tokens' }];
    await agent.triggerManualReview(history);

    // Should stop before looping infinitely
    expect(mockProvider.streamChat.mock.calls.length).toBeLessThanOrEqual(2);
    expect(agent.isReviewing).toBe(false);
  });
});
