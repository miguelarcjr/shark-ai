import { describe, it, expect, vi } from 'vitest';
import { ForkReviewAgent } from './fork-review-agent.js';

describe('ForkReviewAgent Integration Logic', () => {
  it('should handle /refine manual command and report busy if reviewing', async () => {
    const mockProvider = {
      streamChat: vi.fn().mockResolvedValue({ actions: [] })
    };
    const agent = new ForkReviewAgent({
      memoryStore: { updateFile: vi.fn(), readFile: vi.fn() } as any,
      skillManager: { manageSkill: vi.fn(), viewSkill: vi.fn(), listSkills: vi.fn() } as any,
      provider: mockProvider as any
    });

    const history = [{ role: 'user', content: 'remember my preference' }];
    const success = await agent.triggerManualReview(history, 'remember my preference');
    expect(success).toBe(true);
    expect(mockProvider.streamChat).toHaveBeenCalled();

    agent.isReviewing = true;
    const busyResult = await agent.triggerManualReview(history);
    expect(busyResult).toBe(false);
  });
});
