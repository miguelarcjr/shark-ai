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

  public currentReviewPromise?: Promise<void>;

  async maybeTriggerReview(history: Array<{ role: string; content: string }>): Promise<void> {
    const { trigger, reviewMemory, reviewSkills } = this.shouldTrigger();
    if (!trigger || this.isReviewing) {
      return;
    }
    // Launch non-blocking execution
    const p = this.executeReview({
      history,
      reviewMemory,
      reviewSkills
    }).catch(err => {
      FileLogger.log('FORK_REVIEW_ERROR', 'Background review failed', { error: err.message });
    });
    this.currentReviewPromise = p;
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
