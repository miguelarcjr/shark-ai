import { describe, it, expect } from 'vitest';
// Review prompts tests
import {
  buildReviewSystemPrompt,
  MEMORY_REVIEW_PROMPT,
  SKILL_REVIEW_PROMPT,
  COMBINED_REVIEW_PROMPT
} from './review-prompts.js';

describe('Review Prompts', () => {
  it('should return MEMORY_REVIEW_PROMPT when only reviewMemory is true', () => {
    const prompt = buildReviewSystemPrompt({ reviewMemory: true, reviewSkills: false });
    expect(prompt).toBe(MEMORY_REVIEW_PROMPT);
    expect(prompt).toContain('USER.md');
    expect(prompt).toContain('MEMORY.md');
    expect(prompt).not.toContain('Skill Hierarchy');
  });

  it('should return SKILL_REVIEW_PROMPT when only reviewSkills is true', () => {
    const prompt = buildReviewSystemPrompt({ reviewMemory: false, reviewSkills: true });
    expect(prompt).toBe(SKILL_REVIEW_PROMPT);
    expect(prompt).toContain('Skill Hierarchy');
    expect(prompt).toContain('Read-Before-Write Handshake');
    expect(prompt).not.toContain('target: \'user\'');
  });

  it('should return COMBINED_REVIEW_PROMPT when both are true', () => {
    const prompt = buildReviewSystemPrompt({ reviewMemory: true, reviewSkills: true });
    expect(prompt).toBe(COMBINED_REVIEW_PROMPT);
    expect(prompt).toContain('## Memory Guidance');
    expect(prompt).toContain('## Skills Guidance');
  });

  it('should append user refinement focus when refineFocus is provided', () => {
    const prompt = buildReviewSystemPrompt({
      reviewMemory: true,
      reviewSkills: true,
      refineFocus: 'remember that I prefer pnpm'
    });
    expect(prompt).toContain(COMBINED_REVIEW_PROMPT);
    expect(prompt).toContain('## User Refinement Focus (Highest Priority)');
    expect(prompt).toContain('remember that I prefer pnpm');
  });

  it('should ignore empty or whitespace-only refineFocus', () => {
    const prompt = buildReviewSystemPrompt({
      reviewMemory: true,
      reviewSkills: false,
      refineFocus: '   '
    });
    expect(prompt).toBe(MEMORY_REVIEW_PROMPT);
    expect(prompt).not.toContain('User Refinement Focus');
  });
});
