# Hermes-Inspired Fork Review Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Hermes-inspired Fork Review Agent in Shark Dev, providing an autonomous, asynchronous background learning loop that extracts durable factual memories into `MEMORY.md`/`USER.md` and procedural skills into `SKILL.md` via an isolated multi-turn Agent Loop.

**Architecture:** Create dedicated review prompts (`review-prompts.ts`) with dynamic selection based on trigger counters and `/refine` user focus. Implement `ForkReviewAgent` managing `turnsSinceMemory` and `itersSinceSkill` counters, single-flight lock, deep-copy message snapshot, isolated token-budgeted multi-turn tool loop against the active `AIProvider`, strict toolset whitelist (`memory`, `skill_manage`, `skill_view`, `skills_list`, `read_file`, `search_files`), Delete Gate, and non-blocking integration into `developer-agent.ts` with TUI notifications and `/refine` slash command.

**Tech Stack:** TypeScript (ESM), Node.js `fs/promises`, `crypto`, `path`, Vitest.

## Global Constraints

- Never mutate the active session's conversation history or `StateDB` with review agent turns (`_persist_disabled`).
- Never allow background review to execute arbitrary commands (`run_command` and MCP tools are blocked).
- Prohibit autonomous deletion in background mode via Delete Gate (reject `memory(remove)`).
- Bound execution strictly by token budget (`_review_input_token_budget`), without an artificial action count limit.
- Mark all skills created/patched in background mode with `created_by: 'agent'` in `.usage.json`.
- Preserve Prompt Caching parity by reusing the active provider and system prompt configuration.

---

### Task 1: Review Prompts and Dynamic Prompt Selector

**Files:**
- Create: `src/core/api/review-prompts.ts`
- Test: `src/core/api/review-prompts.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export const MEMORY_REVIEW_PROMPT: string;
  export const SKILL_REVIEW_PROMPT: string;
  export const COMBINED_REVIEW_PROMPT: string;
  export interface ReviewPromptOptions {
    reviewMemory: boolean;
    reviewSkills: boolean;
    refineFocus?: string;
  }
  export function buildReviewSystemPrompt(options: ReviewPromptOptions): string;
  ```

- [x] **Step 1: Write unit tests for `buildReviewSystemPrompt`**

Create `src/core/api/review-prompts.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/api/review-prompts.test.ts`  
Expected: FAIL (module not found).

- [x] **Step 3: Implement `src/core/api/review-prompts.ts`**

```typescript
export const MEMORY_REVIEW_PROMPT = `
You write durable memory entries by inspecting recent conversation history.

## Memory Guidance
Review the conversation snapshot and extract durable facts:
- Save developer preferences, communication style, or stack choices to USER.md (target: 'user').
- Save project conventions, port numbers, build steps, and environment quirks to MEMORY.md (target: 'memory').
- Keep entries compact, plain, and factual.

## Critical Constraints
- Do NOT capture transient setup or environment errors (e.g., "command not found", "missing binary", "tool uninstalled").
- Do NOT capture negative-claim phrasings or temporary failure states. Always capture the FIX/SOLUTION, not the failure.
- Do NOT capture one-off task narratives or specific code refactors tied strictly to a single file.
- Do NOT attempt to delete existing memories in background mode.
`.trim();

export const SKILL_REVIEW_PROMPT = `
You create and maintain procedural skills (SKILL.md) by inspecting recent conversation history.

## Active Stance
Be proactive: if the conversation demonstrates a multi-step workflow, debugging technique, or complex procedure that solved a task, capture or refine it as a skill. Omission of a skill update when a clear workflow was established is a missed learning opportunity.

## Skill Hierarchy & Selection Rules
Before creating a new skill, follow this strict priority:
1. Update a currently-loaded skill if the new instructions refine the active procedure.
2. Update an existing umbrella skill in the library if one exists for this domain.
3. Add or update support files in \`references/\` inside an existing umbrella skill.
4. Create a new umbrella skill only if no existing skill or category matches the domain.

## First-Class Signals
Treat developer corrections and feedback regarding style, format, verbosity, readability, or tone (e.g., "stop doing X", "don't Y", "I dislike Z") as first-class signals to immediately update or create a skill.

## Read-Before-Write Handshake
Mandatory rule: You MUST invoke \`skill_view(name)\` (or \`skill_view(name, file_path=...)\`) to read the exact current contents of an existing skill file BEFORE calling \`skill_manage\` with \`action="patch"\`, \`action="edit"\`, \`action="write_file"\`, or \`action="remove_file"\`.
*(Exemption: Creating a brand new skill does not require a prior read_file).*

## Critical Constraints
- Do NOT capture transient setup errors or failed tool executions. Capture the final working procedure.
- Ensure the skill description is 1 line and under 60 characters for lightweight catalog routing.
`.trim();

export const COMBINED_REVIEW_PROMPT = `
You write durable memory entries and procedural skills by inspecting recent conversation history.

## Memory Guidance
Review the conversation snapshot and extract durable facts:
- Save developer preferences, communication style, or stack choices to USER.md (target: 'user').
- Save project conventions, port numbers, build steps, and environment quirks to MEMORY.md (target: 'memory').
- Keep entries compact, plain, and factual.

## Skills Guidance
Be proactive in capturing multi-step workflows, debugging techniques, or complex procedures:
1. Update a currently-loaded skill if refining an active procedure.
2. Update an existing umbrella skill if one matches the domain.
3. Add or update support reference files in \`references/\`.
4. Create a new umbrella skill only if no existing skill applies.

Treat developer corrections about style, format, or behavior ("stop doing X", "don't Y") as first-class signals to update or create a skill.

Mandatory rule: You MUST invoke \`skill_view(name)\` to read existing skill contents before executing \`skill_manage\` patches or edits.

## Critical Constraints
- Do NOT capture transient setup or environment errors (e.g., "command not found").
- Capture the FIX/SOLUTION, never the temporary failure narrative.
- Do NOT capture one-off task narratives tied strictly to a single file.
- Do NOT attempt to delete existing memories in background mode.
`.trim();

export interface ReviewPromptOptions {
  reviewMemory: boolean;
  reviewSkills: boolean;
  refineFocus?: string;
}

export function buildReviewSystemPrompt(options: ReviewPromptOptions): string {
  let basePrompt = '';

  if (options.reviewMemory && options.reviewSkills) {
    basePrompt = COMBINED_REVIEW_PROMPT;
  } else if (options.reviewMemory) {
    basePrompt = MEMORY_REVIEW_PROMPT;
  } else if (options.reviewSkills) {
    basePrompt = SKILL_REVIEW_PROMPT;
  } else {
    basePrompt = COMBINED_REVIEW_PROMPT;
  }

  if (options.refineFocus && options.refineFocus.trim() !== '') {
    basePrompt += `\n\n## User Refinement Focus (Highest Priority)\nThe user explicitly requested the following focus for this review cycle:\n"${options.refineFocus.trim()}"\nPrioritize capturing facts or skills related to this instruction.`;
  }

  return basePrompt;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/api/review-prompts.test.ts`  
Expected: PASS (5 tests passing).

- [x] **Step 5: Commit**

```bash
git add src/core/api/review-prompts.ts src/core/api/review-prompts.test.ts
git commit -m "feat(learning): implement dynamic review prompts and prompt builder"
```

---

### Task 2: Implement `ForkReviewAgent` Core Engine with Isolated Agent Loop

**Files:**
- Create: `src/core/workflow/fork-review-agent.ts`
- Test: `src/core/workflow/fork-review-agent.test.ts`

**Interfaces:**
- Consumes:
  - `MemoryStore` from `src/core/memory/memory-store.js`
  - `SkillManager` from `src/core/workflow/skill-manager.js`
  - `AIProvider` from `src/core/api/provider.interface.js`
  - `buildReviewSystemPrompt` from `src/core/api/review-prompts.js`
  - `encode` from `gpt-tokenizer`
- Produces:
  ```typescript
  export interface ForkReviewAgentOptions {
    memoryStore: MemoryStore;
    skillManager: SkillManager;
    provider: AIProvider;
    tokenBudget?: number;
    onNotification?: (message: string) => void;
  }

  export class ForkReviewAgent {
    public turnsSinceMemory: number;
    public itersSinceSkill: number;
    public isReviewing: boolean;

    constructor(options: ForkReviewAgentOptions);
    onUserTurn(): void;
    onToolIteration(): void;
    shouldTrigger(): { trigger: boolean; reviewMemory: boolean; reviewSkills: boolean };
    maybeTriggerReview(history: Array<{ role: string; content: string }>): Promise<void>;
    triggerManualReview(history: Array<{ role: string; content: string }>, focus?: string): Promise<boolean>;
  }
  ```

- [x] **Step 1: Write failing unit tests for `ForkReviewAgent`**

Create `src/core/workflow/fork-review-agent.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      onNotification: msg => notifications.push(msg)
    });

    for (let i = 0; i < 10; i++) agent.onToolIteration();

    const history = [{ role: 'user', content: 'commit message guideline' }];
    await agent.maybeTriggerReview(history);

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
```

- [x] **Step 2: Run test to verify failure**

Run: `npx vitest run src/core/workflow/fork-review-agent.test.ts`  
Expected: FAIL (module not found).

- [x] **Step 3: Implement `ForkReviewAgent` in `src/core/workflow/fork-review-agent.ts`**

```typescript
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MemoryStore } from '../memory/memory-store.js';
import { SkillManager } from './skill-manager.js';
import { AIProvider } from '../api/provider.interface.js';
import { buildReviewSystemPrompt } from '../api/review-prompts.js';
import { FileLogger } from '../debug/file-logger.js';
import { encode } from 'gpt-tokenizer';

export interface ForkReviewAgentOptions {
  memoryStore: MemoryStore;
  skillManager: SkillManager;
  provider: AIProvider;
  tokenBudget?: number;
  onNotification?: (message: string) => void;
}

export class ForkReviewAgent {
  public turnsSinceMemory: number = 0;
  public itersSinceSkill: number = 0;
  public isReviewing: boolean = false;

  private memoryStore: MemoryStore;
  private skillManager: SkillManager;
  private provider: AIProvider;
  private tokenBudget: number;
  private onNotification?: (message: string) => void;

  public static readonly MEMORY_INTERVAL = 10;
  public static readonly SKILL_INTERVAL = 10;
  public static readonly DEFAULT_TOKEN_BUDGET = 40000;

  constructor(options: ForkReviewAgentOptions) {
    this.memoryStore = options.memoryStore;
    this.skillManager = options.skillManager;
    this.provider = options.provider;
    this.tokenBudget = options.tokenBudget ?? ForkReviewAgent.DEFAULT_TOKEN_BUDGET;
    this.onNotification = options.onNotification;
  }

  onUserTurn(): void {
    this.turnsSinceMemory++;
  }

  onToolIteration(): void {
    this.itersSinceSkill++;
  }

  shouldTrigger(): { trigger: boolean; reviewMemory: boolean; reviewSkills: boolean } {
    const reviewMemory = this.turnsSinceMemory >= ForkReviewAgent.MEMORY_INTERVAL;
    const reviewSkills = this.itersSinceSkill >= ForkReviewAgent.SKILL_INTERVAL;
    return {
      trigger: reviewMemory || reviewSkills,
      reviewMemory,
      reviewSkills
    };
  }

  async maybeTriggerReview(history: Array<{ role: string; content: string }>): Promise<void> {
    const { trigger, reviewMemory, reviewSkills } = this.shouldTrigger();
    if (!trigger || this.isReviewing) {
      return;
    }
    // Launch non-blocking execution
    void this.executeReview({
      history,
      reviewMemory,
      reviewSkills
    }).catch(err => {
      FileLogger.log('FORK_REVIEW_ERROR', 'Background review failed', { error: err.message });
    });
  }

  async triggerManualReview(
    history: Array<{ role: string; content: string }>,
    focus?: string
  ): Promise<boolean> {
    if (this.isReviewing) {
      return false;
    }
    await this.executeReview({
      history,
      reviewMemory: true,
      reviewSkills: true,
      refineFocus: focus
    });
    return true;
  }

  private async executeReview(options: {
    history: Array<{ role: string; content: string }>;
    reviewMemory: boolean;
    reviewSkills: boolean;
    refineFocus?: string;
  }): Promise<void> {
    this.isReviewing = true;
    const reviewSessionId = `review_${crypto.randomUUID()}`;
    let accumulatedTokens = 0;
    let memoryUpdated = false;
    let skillUpdatedName: string | null = null;

    try {
      const systemPrompt = buildReviewSystemPrompt({
        reviewMemory: options.reviewMemory,
        reviewSkills: options.reviewSkills,
        refineFocus: options.refineFocus
      });

      // Slice recent history (last 15 messages) as snapshot
      const recentSlice = options.history.slice(-15);
      let promptText = `CONVERSATION SNAPSHOT TO REVIEW:\n\n`;
      for (const msg of recentSlice) {
        promptText += `[${msg.role.toUpperCase()}]:\n${msg.content}\n\n`;
      }
      promptText += `Inspect the above interactions and execute any necessary memory updates or skill management actions. If no updates are needed, respond with text explaining why.`;

      accumulatedTokens += encode(systemPrompt).length + encode(promptText).length;

      let currentPrompt = promptText;
      let loopActive = true;

      while (loopActive) {
        if (accumulatedTokens >= this.tokenBudget) {
          FileLogger.log('FORK_REVIEW_BUDGET', 'Token budget exceeded for review loop', {
            accumulatedTokens,
            budget: this.tokenBudget
          });
          break;
        }

        const response = await this.provider.streamChat(currentPrompt, {
          conversationId: reviewSessionId,
          systemPrompt,
          isSubagent: true
        });

        const actions = response.actions || [];
        if (!actions || actions.length === 0) {
          // Natural exit condition: LLM has finished actions and produced plain text
          loopActive = false;
          break;
        }

        const actionObservations: string[] = [];

        for (const act of actions) {
          const actionType = act.type;

          if (actionType === 'memory') {
            const memAction = act.action || 'read';
            const target = (act.target || 'memory') as 'memory' | 'user';

            if (memAction === 'remove') {
              actionObservations.push(
                `[Action memory rejected]: Delete Gate active. Autonomous removal in background mode is prohibited.`
              );
              continue;
            }

            try {
              if (memAction === 'read') {
                const text = await this.memoryStore.readFile(target);
                actionObservations.push(`[Action memory read(${target}) Success]:\n${text}`);
              } else {
                const res = await this.memoryStore.updateFile(
                  target,
                  memAction,
                  act.content || '',
                  act.old_str
                );
                memoryUpdated = true;
                actionObservations.push(`[Action memory ${memAction}(${target}) Success]: ${res.usage}`);
              }
            } catch (err: any) {
              actionObservations.push(`[Action memory Failed]: ${err.message}`);
            }
          } else if (actionType === 'skill_view') {
            try {
              const skillContent = await this.skillManager.viewSkill(act.name, act.file_path, reviewSessionId);
              actionObservations.push(`[Action skill_view(${act.name}) Success]:\n${skillContent}`);
            } catch (err: any) {
              actionObservations.push(`[Action skill_view Failed]: ${err.message}`);
            }
          } else if (actionType === 'skills_list') {
            try {
              const list = await this.skillManager.listSkills(act.query);
              actionObservations.push(`[Action skills_list Success]:\n${list}`);
            } catch (err: any) {
              actionObservations.push(`[Action skills_list Failed]: ${err.message}`);
            }
          } else if (actionType === 'skill_manage') {
            try {
              const res = await this.skillManager.manageSkill({
                action: act.action,
                name: act.name,
                content: act.content,
                file_path: act.file_path,
                old_string: act.old_string,
                new_string: act.new_string,
                scope: act.scope || 'local'
              });
              if (res.status === 'success') {
                skillUpdatedName = act.name;
                actionObservations.push(`[Action skill_manage(${act.action}, ${act.name}) Success]: ${res.message}`);
              } else {
                actionObservations.push(`[Action skill_manage(${act.action}, ${act.name}) ${res.status}]: ${res.message}`);
              }
            } catch (err: any) {
              actionObservations.push(`[Action skill_manage Failed]: ${err.message}`);
            }
          } else if (actionType === 'read_file') {
            try {
              const filePath = path.resolve(process.cwd(), act.path || act.file_path || '');
              const content = await fs.readFile(filePath, 'utf-8');
              actionObservations.push(`[Action read_file(${filePath}) Success]:\n${content.slice(0, 3000)}`);
            } catch (err: any) {
              actionObservations.push(`[Action read_file Failed]: ${err.message}`);
            }
          } else {
            actionObservations.push(
              `[Action ${actionType} Rejected]: Tool '${actionType}' is not allowed in background review mode.`
            );
          }
        }

        currentPrompt = `TOOL EXECUTION RESULTS:\n${actionObservations.join('\n\n')}\n\nContinue with next actions or provide final summary to complete.`;
        accumulatedTokens += encode(currentPrompt).length;
      }

      // Reset counters
      if (options.reviewMemory) this.turnsSinceMemory = 0;
      if (options.reviewSkills) this.itersSinceSkill = 0;

      // Notify TUI
      if (this.onNotification) {
        if (skillUpdatedName) {
          this.onNotification(`⚡ [Learning Loop: Skill '${skillUpdatedName}' atualizada]`);
        } else if (memoryUpdated) {
          this.onNotification(`💾 [Learning Loop: Memória atualizada]`);
        }
      }
    } finally {
      this.isReviewing = false;
    }
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/workflow/fork-review-agent.test.ts`  
Expected: PASS (all 5 tests passing).

- [x] **Step 5: Commit**

```bash
git add src/core/workflow/fork-review-agent.ts src/core/workflow/fork-review-agent.test.ts
git commit -m "feat(learning): implement ForkReviewAgent with isolated agent loop"
```

---

### Task 3: Integrate Fork Review Agent into Developer Agent and Slash Commands

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/workflow/fork-review-integration.test.ts`

**Interfaces:**
- Connects `ForkReviewAgent` into:
  - User turn start in `DeveloperAgent`: increments `onUserTurn()`.
  - Action loop in `DeveloperAgent`: increments `onToolIteration()`.
  - Post-turn settlement: calls `forkReviewAgent.maybeTriggerReview(history)`.
  - Command `/refine [focus]`: triggers `forkReviewAgent.triggerManualReview(history, focus)`.
  - Notification dispatch to `tui.log.info` / subtle status.

- [x] **Step 1: Write integration tests for `developer-agent.ts` review wiring**

Create `src/core/workflow/fork-review-integration.test.ts`:
```typescript
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
```

- [x] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/fork-review-integration.test.ts`  
Expected: PASS.

- [x] **Step 3: Modify `src/core/agents/developer-agent.ts` to instantiate and trigger `ForkReviewAgent`**

1. Import `ForkReviewAgent` from `../workflow/fork-review-agent.js`.
2. Instantiate `forkReviewAgent` alongside `memoryStore` and `skillManager`:
   ```typescript
   const forkReviewAgent = new ForkReviewAgent({
       memoryStore,
       skillManager,
       provider: activeProvider,
       onNotification: (msg) => {
           tui.log.info(colors.dim(msg));
       }
   });
   ```
3. In `activeOnCommandHandler` within `promptUser`:
   Add handler for `/refine`:
   ```typescript
   if (command.startsWith('/refine')) {
       const focus = command.slice(7).trim();
       tui.log.info(colors.cyan('🧠 Acionando revisão do Learning Loop em segundo plano...'));
       const rawHistory = await HistoryManager.getRawHistory(conversationId);
       const triggered = await forkReviewAgent.triggerManualReview(rawHistory, focus || undefined);
       if (!triggered) {
           tui.log.warn('⚠️ [Review em andamento, aguarde a conclusão...]');
       } else {
           tui.log.success('Revisão iniciada com sucesso.');
       }
       return true;
   }
   ```
4. On user prompt entry:
   `forkReviewAgent.onUserTurn();`
5. On each tool action execution in `runDeveloperLoop`:
   `forkReviewAgent.onToolIteration();`
6. At the end of the user turn (after assistant completes message):
   ```typescript
   const rawHistory = await HistoryManager.getRawHistory(conversationId);
   void forkReviewAgent.maybeTriggerReview(rawHistory);
   ```

- [x] **Step 4: Run all related tests to ensure no regressions**

Run: `npx vitest run src/core/workflow/fork-review-agent.test.ts src/core/api/review-prompts.test.ts src/core/workflow/fork-review-integration.test.ts`  
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/workflow/fork-review-integration.test.ts
git commit -m "feat(learning): integrate ForkReviewAgent and /refine command into DeveloperAgent"
```

---

### Task 4: End-to-End Verification & Documentation

**Files:**
- Test: Run complete test suite on memory, skills, and agents
- Create: `src/core/workflow/verify-learning-loop.ts`

- [x] **Step 1: Create verification script**

Create `src/core/workflow/verify-learning-loop.ts` to test prompt selection, counter tracking, and multi-turn action loop with a mocked provider.

- [x] **Step 2: Run verification script**

Run: `npx tsx src/core/workflow/verify-learning-loop.ts`  
Expected: Success output demonstrating counters, mock review loop, memory updates, and notifications.

- [x] **Step 3: Run full Vitest test suite**

Run: `npx vitest run`  
Expected: All tests pass.

- [x] **Step 4: Commit**

```bash
git add src/core/workflow/verify-learning-loop.ts
git commit -m "test(learning): add end-to-end verification script for ForkReviewAgent"
```
