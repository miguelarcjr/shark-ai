# AgentEngine Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 850-line `AgentEngine` in `src/core/engine/agent-engine.ts` into focused, highly cohesive modules (`engine-context-builder.ts`, `subagent-sync.ts`, `turn-loop-runner.ts`) while keeping `AgentEngine` as a clean facade under 200 lines with 100% backward compatibility.

**Architecture:** 
1. `SubagentSync` isolates mailbox message drainage, XML notification formatting, active subagents panel formatting, and SIGINT/SIGTERM process listeners.
2. `EngineContextBuilder` encapsulates MCP setup, memory snapshot loading, skills index formatting, system prompt construction, and dynamic prompt refresh.
3. `TurnLoopRunner` encapsulates the ReAct state machine loop: LLM streaming, token compaction, text completion parsing, and dispatching actions (`complete_task`, `wait`, `talk_with_user`, and generic tools).
4. `AgentEngine` acts as an event-driven session coordinator orchestrating channel adapters, lease management, turn aborts, and delegating execution to the submodules.

**Tech Stack:** TypeScript (ESM), Vitest, Node.js (`crypto`, `fs`, `path`).

## Global Constraints

- Preserve exact public API of `AgentEngine` (`runInteractive`, `processMessage`, `attachAdapter`, `abortCurrentTurn`, `getApprovalsManager`, `getLeaseManager`).
- Retain existing types in `src/core/engine/agent-engine.ts`: `AgentEngineOptions`, `EngineRunOptions`, `DevelopmentResult`.
- Ensure all existing tests in `src/core/engine/` pass without modification.
- Target `agent-engine.ts` size to be under 200 lines.

---

### Task 1: Subagent Synchronization Module (`subagent-sync.ts`)

**Files:**
- Create: `src/core/engine/subagent-sync.ts`
- Test: `src/core/engine/subagent-sync.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function formatNotification(msg: any): string;
  export async function drainIncomingNotifications(recipientId: string, messageQueue: MessageQueue): Promise<string[]>;
  export function formatActiveSubagentsPanel(parentId: string): string;
  export function setupProcessCleanup(parentId: string, log?: { info: (msg: string) => void }): { dispose: () => void };
  export function terminateChildSubagents(parentId: string): void;
  ```

- [ ] **Step 1: Write the failing unit tests for `subagent-sync.ts`**

Create `src/core/engine/subagent-sync.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatNotification, drainIncomingNotifications, formatActiveSubagentsPanel, terminateChildSubagents } from './subagent-sync.js';
import { MessageQueue } from '../workflow/message-queue.js';
import { subagentManager } from '../workflow/subagent-manager.js';

describe('SubagentSync', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('formatNotification', () => {
        it('wraps plain string into subagent_notification XML tag', () => {
            const formatted = formatNotification('Subagent finished step 1');
            expect(formatted).toBe('<subagent_notification status="completed">\nSubagent finished step 1\n</subagent_notification>');
        });

        it('detects failed status', () => {
            const formatted = formatNotification('Task execution failed with error');
            expect(formatted).toBe('<subagent_notification status="failed">\nTask execution failed with error\n</subagent_notification>');
        });

        it('preserves already formatted XML notifications', () => {
            const xml = '<subagent_notification status="cancelled">\nOperation cancelled\n</subagent_notification>';
            expect(formatNotification(xml)).toBe(xml);
        });
    });

    describe('drainIncomingNotifications', () => {
        it('drains both disk messages and queued memory messages', async () => {
            vi.spyOn(subagentManager, 'retrieveMessages').mockReturnValue(['disk message 1']);
            const queue = new MessageQueue();
            queue.enqueue('memory message 1', 'subagent_notification');

            const result = await drainIncomingNotifications('parent', queue);
            expect(result.length).toBe(2);
            expect(result[0]).toContain('disk message 1');
            expect(result[1]).toContain('memory message 1');
            expect(queue.isEmpty()).toBe(true);
        });
    });

    describe('formatActiveSubagentsPanel', () => {
        it('returns empty string when there are no active subagents', () => {
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([]);
            const panel = formatActiveSubagentsPanel('parent');
            expect(panel).toBe('');
        });

        it('returns formatted panel when active subagents exist', () => {
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([
                { id: 'sub-1', role: 'tester', status: 'running', summary: 'running tests' } as any
            ]);
            const panel = formatActiveSubagentsPanel('parent');
            expect(panel).toContain('--- ACTIVE SUBAGENTS ---');
            expect(panel).toContain('ID: sub-1 | Role: tester | Status: running | Last Status: running tests');
        });
    });

    describe('terminateChildSubagents', () => {
        it('calls killSubagent on all active subagents for parent', () => {
            const killSpy = vi.spyOn(subagentManager, 'killSubagent').mockImplementation(() => {});
            vi.spyOn(subagentManager, 'getActiveSubagentsForParent').mockReturnValue([
                { id: 'sub-1' } as any,
                { id: 'sub-2' } as any
            ]);
            terminateChildSubagents('parent');
            expect(killSpy).toHaveBeenCalledTimes(2);
            expect(killSpy).toHaveBeenCalledWith('sub-1');
            expect(killSpy).toHaveBeenCalledWith('sub-2');
        });
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/subagent-sync.test.ts`  
Expected: FAIL with "Cannot find module './subagent-sync.js'"

- [ ] **Step 3: Write implementation for `subagent-sync.ts`**

Create `src/core/engine/subagent-sync.ts`:
```ts
import { subagentManager } from '../workflow/subagent-manager.js';
import type { MessageQueue } from '../workflow/message-queue.js';

export function formatNotification(msg: any): string {
    const text = typeof msg === 'object' && msg.message ? msg.message : String(msg);
    if (text.startsWith('<subagent_notification')) return text;
    let status = 'completed';
    if (text.includes('FAILED') || text.includes('failed')) status = 'failed';
    if (text.includes('CANCELLED') || text.includes('cancelled')) status = 'cancelled';
    return `<subagent_notification status="${status}">\n${text}\n</subagent_notification>`;
}

export async function drainIncomingNotifications(recipientId: string, messageQueue: MessageQueue): Promise<string[]> {
    const diskMessages = subagentManager.retrieveMessages(recipientId);
    const queuedMessages: string[] = [];
    while (!messageQueue.isEmpty()) {
        const qMsg = await messageQueue.next();
        if (qMsg && qMsg.content) {
            queuedMessages.push(qMsg.content);
        }
    }
    return [
        ...diskMessages.map(formatNotification),
        ...queuedMessages.map(formatNotification)
    ];
}

export function formatActiveSubagentsPanel(parentId: string): string {
    const activeSubs = subagentManager.getActiveSubagentsForParent(parentId);
    if (activeSubs.length === 0) return '';
    let panel = `\n--- ACTIVE SUBAGENTS ---\n`;
    panel += `You have spawned the following subagents that are currently working in parallel:\n`;
    for (const sub of activeSubs) {
        panel += `- ID: ${sub.id} | Role: ${sub.role} | Status: ${sub.status}${sub.summary ? ` | Last Status: ${sub.summary}` : ''}\n`;
    }
    panel += `Use the 'wait' action if you have no other work and are waiting for these subagents to complete.\n`;
    panel += `--------------------------------\n`;
    return panel;
}

export function terminateChildSubagents(parentId: string, log?: { info: (msg: string) => void }) {
    const activeSubs = subagentManager.getActiveSubagentsForParent(parentId);
    if (activeSubs.length > 0) {
        log?.info(`🧹 Terminating ${activeSubs.length} active child subagent(s)...`);
        for (const sub of activeSubs) {
            subagentManager.killSubagent(sub.id);
        }
    }
}

export function setupProcessCleanup(parentId: string, log?: { info: (msg: string) => void }): { dispose: () => void } {
    const handleCleanupSignal = (exitCode: number) => {
        terminateChildSubagents(parentId, log);
        process.exit(exitCode);
    };
    const sigIntHandler = () => handleCleanupSignal(130);
    const sigTermHandler = () => handleCleanupSignal(143);

    process.on('SIGINT', sigIntHandler);
    process.on('SIGTERM', sigTermHandler);

    return {
        dispose: () => {
            process.off('SIGINT', sigIntHandler);
            process.off('SIGTERM', sigTermHandler);
        }
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/engine/subagent-sync.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/subagent-sync.ts src/core/engine/subagent-sync.test.ts
git commit -m "feat(engine): extract subagent-sync module"
```

---

### Task 2: Engine Context Builder Module (`engine-context-builder.ts`)

**Files:**
- Create: `src/core/engine/engine-context-builder.ts`
- Test: `src/core/engine/engine-context-builder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EngineContextOptions {
      projectRoot: string;
      sessionId: string;
      taskId?: string;
      context?: string;
      history?: string;
      taskInstruction?: string;
      bridgeToolsManager?: BridgeToolsManager;
      autoApproveTools?: boolean;
      emitOutbound?: (event: any) => void;
      getForkReviewAgent?: (sessionId: string) => ForkReviewAgent;
  }

  export interface PreparedEngineContext {
      dynamicSystemPrompt: string;
      basePrompt: string;
      mcpManager: McpManager;
      bridgeTools: BridgeToolsManager;
      memoryStore: MemoryStore;
      activeProvider: any;
      activeConversationId: string;
      conversationKey: string;
      forkReviewAgent: ForkReviewAgent;
      autoApproveTools: boolean;
      updateDynamicPrompt: () => Promise<void>;
  }

  export class EngineContextBuilder {
      static prepare(options: EngineContextOptions): Promise<PreparedEngineContext>;
  }
  ```

- [ ] **Step 1: Write the failing test for `engine-context-builder.ts`**

Create `src/core/engine/engine-context-builder.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EngineContextBuilder } from './engine-context-builder.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { conversationManager } from '../workflow/conversation-manager.js';

describe('EngineContextBuilder', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('prepares engine context with prompts, managers and conversation ids', async () => {
        vi.spyOn(ProviderResolver, 'getProvider').mockReturnValue({ id: 'mock-provider' } as any);
        vi.spyOn(conversationManager, 'getConversationId').mockResolvedValue('conv_123');

        const context = await EngineContextBuilder.prepare({
            projectRoot: process.cwd(),
            sessionId: 'sess_1',
            taskInstruction: 'Do something awesome'
        });

        expect(context.activeConversationId).toBe('conv_123');
        expect(context.conversationKey).toBe('session_sess_1');
        expect(context.activeProvider.id).toBe('mock-provider');
        expect(context.basePrompt).toContain('Do something awesome');
        expect(context.dynamicSystemPrompt).toBeDefined();
        expect(typeof context.updateDynamicPrompt).toBe('function');

        await context.mcpManager.closeAll();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/engine-context-builder.test.ts`  
Expected: FAIL with "Cannot find module './engine-context-builder.js'"

- [ ] **Step 3: Write implementation for `engine-context-builder.ts`**

Create `src/core/engine/engine-context-builder.ts`:
```ts
import * as path from 'node:path';
import * as fs from 'node:fs';
import { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';
import { ToolCatalogSearch } from '../tools/bridge/tool-catalog-search.js';
import { generateTieredManifest } from '../tools/bridge/tiered-disclosure.js';
import { McpManager } from '../mcp/mcp-manager.js';
import { loadSharkRC } from '../config/sharkrc-loader.js';
import { MemoryStore } from '../memory/memory-store.js';
import { skillManager } from '../workflow/skill-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { ForkReviewAgent } from '../workflow/fork-review-agent.js';
import { ProviderResolver } from '../api/provider-resolver.js';
import { buildUnifiedSystemPrompt } from '../api/prompts.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';

export interface EngineContextOptions {
    projectRoot: string;
    sessionId: string;
    taskId?: string;
    context?: string;
    history?: string;
    taskInstruction?: string;
    bridgeToolsManager?: BridgeToolsManager;
    autoApproveTools?: boolean;
    emitOutbound?: (event: any) => void;
    forkReviewAgent?: ForkReviewAgent;
}

export interface PreparedEngineContext {
    dynamicSystemPrompt: string;
    basePrompt: string;
    mcpManager: McpManager;
    bridgeTools: BridgeToolsManager;
    memoryStore: MemoryStore;
    activeProvider: any;
    activeConversationId: string;
    conversationKey: string;
    forkReviewAgent: ForkReviewAgent;
    updateDynamicPrompt: () => Promise<void>;
}

export class EngineContextBuilder {
    static async prepare(options: EngineContextOptions): Promise<PreparedEngineContext> {
        const projectRoot = options.projectRoot || process.cwd();
        const effectiveTaskId = options.taskId;
        const effectiveSessionId = options.sessionId || 'default';

        // 1. MCP Subsystems
        const rcConfig = loadSharkRC() || {};
        const mcpServers = process.env.VITEST && !process.env.SHARK_TEST_MCP ? {} : ((rcConfig as any)?.mcpServers || {});
        const mcpManager = new McpManager();
        const mcpTools = await mcpManager.initialize(mcpServers);
        const toolCatalog = new ToolCatalogSearch(mcpTools);
        const bridgeTools = options.bridgeToolsManager || new BridgeToolsManager(
            toolCatalog,
            (name, args) => mcpManager.executeTool(name, args),
            mcpTools
        );
        const mcpManifest = mcpTools.length > 0 ? generateTieredManifest(mcpTools).manifestText : undefined;

        // 2. Memory & Skills
        const memoryStore = new MemoryStore();
        let memorySnapshot = await memoryStore.loadSnapshot();
        const skillsMetadata = await skillManager.getAvailableSkillsMetadata();
        const skillsIndex = skillManager.formatSkillsIndex(skillsMetadata);

        let dynamicSystemPrompt = buildUnifiedSystemPrompt({
            snapshot: memorySnapshot,
            toolsCatalog: mcpManifest,
            skillsIndex: skillsIndex || undefined
        });

        const updateDynamicPrompt = async () => {
            memorySnapshot = await memoryStore.loadSnapshot();
            dynamicSystemPrompt = buildUnifiedSystemPrompt({
                snapshot: memorySnapshot,
                toolsCatalog: mcpManifest,
                skillsIndex: skillsIndex || undefined
            });
        };

        // 3. Conversation & Provider
        const conversationKey = effectiveTaskId
            ? `dev_agent_${effectiveTaskId}`
            : (effectiveSessionId && effectiveSessionId !== '*' ? `session_${effectiveSessionId}` : `dev_agent_${Date.now()}`);
        const activeConversationId = await conversationManager.getConversationId(conversationKey);
        const activeProvider = ProviderResolver.getProvider('developer_agent');

        // 4. ForkReviewAgent
        const forkReviewAgent = options.forkReviewAgent || new ForkReviewAgent({
            memoryStore,
            skillManager,
            provider: activeProvider,
            onNotification: (msg) => {
                tui.log.info(colors.dim(msg));
                options.emitOutbound?.({
                    type: 'turn_completed',
                    sessionId: effectiveSessionId,
                    summary: msg
                });
            }
        });

        // 5. Read project context file
        let contextContent = '';
        const defaultContextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
        const specificContextPath = options.context ? path.resolve(projectRoot, options.context) : defaultContextPath;
        if (fs.existsSync(specificContextPath)) {
            try {
                contextContent = fs.readFileSync(specificContextPath, 'utf-8');
            } catch (e) {
                tui.log.warning(`Failed to read context file: ${e}`);
            }
        }

        // 6. Assemble base execution prompt
        let basePrompt = '';
        if (contextContent) {
            basePrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
        }
        if (options.history) {
            basePrompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
        }
        basePrompt += `\n\n🟢 EXECUTION MODE\n
You are a highly skilled Developer Agent.
👉 **CURRENT TASK**: "${options.taskInstruction || ''}"

Your goal is to address the user's request:
- If the request is a question, a request for explanation, or a discussion, answer the user using the 'talk_with_user' action. You can search the codebase or read files first to answer accurately. Once the explanation/discussion is complete, execute the 'complete_task' action with a brief summary in the 'summary' field and the full explanation in the 'content' field.
- If the request is to implement changes, debug, or write code:
  1. Implement the necessary changes.
  2. Verify (compile/test).
  3. When you are confident the task is done, execute the 'complete_task' action with a brief technical summary of what you did in the 'summary' field and any additional details in the 'content' field.

- Handling Subagent Notifications:
  - When you receive notifications about subagent progress or completion in your mailbox, do NOT invoke the 'talk_with_user' action just to relay this information to the user if you still have other subagents running, or if you have further steps to execute yourself.
  - Instead, process the subagent's output, update your task progress in the 'summary' field of your next action, and proceed with executing your next planned steps (or use the 'wait' action to continue waiting for other running subagents).
  - Only use 'talk_with_user' if you genuinely require the user's input/decision to proceed, or when the entire task is ready for final discussion.
`;

        return {
            dynamicSystemPrompt,
            basePrompt,
            mcpManager,
            bridgeTools,
            memoryStore,
            activeProvider,
            activeConversationId,
            conversationKey,
            forkReviewAgent,
            updateDynamicPrompt
        };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/engine/engine-context-builder.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/engine-context-builder.ts src/core/engine/engine-context-builder.test.ts
git commit -m "feat(engine): extract engine-context-builder module"
```

---

### Task 3: Turn Loop Runner Module (`turn-loop-runner.ts`)

**Files:**
- Create: `src/core/engine/turn-loop-runner.ts`
- Test: `src/core/engine/turn-loop-runner.test.ts`

**Interfaces:**
- Consumes: `PreparedEngineContext` from `engine-context-builder.ts`, `subagent-sync.ts` utilities, `AgentActionExecutor`.
- Produces:
  ```ts
  export interface TurnLoopOptions {
      sessionId: string;
      projectRoot: string;
      taskId?: string;
      isBatchMode: boolean;
      messageQueue: MessageQueue;
      abortController: AbortController;
      actionExecutor: AgentActionExecutor;
      context: PreparedEngineContext;
      emitOutbound?: (event: any) => void;
      onSlashCommand?: (cmd: string) => Promise<boolean>;
  }

  export class TurnLoopRunner {
      static run(options: TurnLoopOptions): Promise<DevelopmentResult>;
  }
  ```

- [ ] **Step 1: Write the failing test for `turn-loop-runner.ts`**

Create `src/core/engine/turn-loop-runner.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnLoopRunner } from './turn-loop-runner.js';
import { MessageQueue } from '../workflow/message-queue.js';

describe('TurnLoopRunner', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns development result when provider completes task with TASK_COMPLETED string', async () => {
        const mockProvider = {
            streamChat: vi.fn().mockResolvedValue({
                message: 'All done! TASK_COMPLETED: Finished building component'
            })
        };

        const mockContext = {
            dynamicSystemPrompt: 'prompt',
            basePrompt: 'task base',
            activeProvider: mockProvider,
            activeConversationId: 'c1',
            conversationKey: 'k1',
            forkReviewAgent: {
                onUserTurn: vi.fn(),
                onToolIteration: vi.fn(),
                maybeTriggerReview: vi.fn(),
                currentReviewPromise: undefined
            },
            updateDynamicPrompt: vi.fn()
        } as any;

        const actionExecutor = {
            executeAction: vi.fn()
        } as any;

        const result = await TurnLoopRunner.run({
            sessionId: 's1',
            projectRoot: process.cwd(),
            isBatchMode: true,
            messageQueue: new MessageQueue(),
            abortController: new AbortController(),
            actionExecutor,
            context: mockContext
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Finished building component');
    });

    it('handles complete_task action properly', async () => {
        const mockProvider = {
            streamChat: vi.fn().mockResolvedValue({
                action: {
                    type: 'complete_task',
                    args: { summary: 'Completed via action', content: 'Detailed info' }
                }
            })
        };

        const mockContext = {
            dynamicSystemPrompt: 'prompt',
            basePrompt: 'task base',
            activeProvider: mockProvider,
            activeConversationId: 'c1',
            conversationKey: 'k1',
            forkReviewAgent: {
                onUserTurn: vi.fn(),
                onToolIteration: vi.fn(),
                maybeTriggerReview: vi.fn(),
                currentReviewPromise: undefined
            },
            updateDynamicPrompt: vi.fn()
        } as any;

        const actionExecutor = {
            executeAction: vi.fn()
        } as any;

        const result = await TurnLoopRunner.run({
            sessionId: 's1',
            projectRoot: process.cwd(),
            isBatchMode: true,
            messageQueue: new MessageQueue(),
            abortController: new AbortController(),
            actionExecutor,
            context: mockContext
        });

        expect(result.success).toBe(true);
        expect(result.summary).toBe('Completed via action');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/turn-loop-runner.test.ts`  
Expected: FAIL with "Cannot find module './turn-loop-runner.js'"

- [ ] **Step 3: Write implementation for `turn-loop-runner.ts`**

Create `src/core/engine/turn-loop-runner.ts`:
```ts
import { MessageQueue, type QueueMessage } from '../workflow/message-queue.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { ContextCompressor } from '../workflow/context-compressor.js';
import { ConfigManager } from '../config-manager.js';
import { waitForInputOrNotification, formatRoleForUI } from '../workflow/interactive-prompt.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { drainIncomingNotifications, formatActiveSubagentsPanel } from './subagent-sync.js';
import type { PreparedEngineContext } from './engine-context-builder.js';
import type { AgentActionExecutor } from './agent-action-executor.js';

export interface DevelopmentResult {
    success: boolean;
    summary: string;
}

export interface TurnLoopOptions {
    sessionId: string;
    projectRoot: string;
    taskId?: string;
    isBatchMode: boolean;
    messageQueue: MessageQueue;
    abortController: AbortController;
    actionExecutor: AgentActionExecutor;
    context: PreparedEngineContext;
    emitOutbound?: (event: any) => void;
}

function isUserCancellation(content: any): boolean {
    return tui.isCancel(content) || !content || content === 'cancel';
}

export class TurnLoopRunner {
    static async run(options: TurnLoopOptions): Promise<DevelopmentResult> {
        const {
            sessionId,
            taskId,
            isBatchMode,
            messageQueue,
            abortController,
            actionExecutor,
            context
        } = options;

        const effectiveTaskId = taskId;
        const isSubagent = !!effectiveTaskId && (effectiveTaskId.startsWith('subagent-') || subagentManager.hasSubagent(effectiveTaskId));
        const myId = effectiveTaskId || 'parent';

        let subagentPrefix = '';
        if (effectiveTaskId) {
            const subState = subagentManager.getSubagentState(effectiveTaskId);
            if (subState) {
                subagentPrefix = `[Subagent: ${formatRoleForUI(subState.role)}] `;
            }
        }

        const log = {
            info: (msg: string) => tui.log.info(`${subagentPrefix}${msg}`),
            warning: (msg: string) => tui.log.warning(`${subagentPrefix}${msg}`),
            error: (msg: string) => tui.log.error(`${subagentPrefix}${msg}`),
            success: (msg: string) => tui.log.success(`${subagentPrefix}${msg}`),
        };

        const spinner = tui.spinner();
        let keepGoing = true;
        let finalSummary = '';
        let userDraftBuffer = '';
        let currentPrompt = context.basePrompt;
        let activeConversationId = context.activeConversationId;
        const forkReviewAgent = context.forkReviewAgent;

        while (keepGoing) {
            if (abortController.signal.aborted) {
                keepGoing = false;
                return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
            }

            // Drena caixa postal e monta painel de subagentes
            const incomingNotifications = await drainIncomingNotifications(myId, messageQueue);
            let currentTurnPrompt = currentPrompt;
            if (incomingNotifications.length > 0) {
                currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${incomingNotifications.join('\n\n')}\n`;
            }

            const panel = formatActiveSubagentsPanel(myId);
            if (panel) {
                currentTurnPrompt += panel;
            }

            const activeCount = subagentManager.getActiveSubagents().length;
            const spinnerText = activeCount > 0
                ? `🦈 Shark Dev working... (Active subagents: ${activeCount})`
                : '🦈 Shark Dev working...';
            spinner.start(spinnerText);

            // Compressão com Tail Protection
            if (activeConversationId) {
                const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                const config = ConfigManager.getInstance().getConfig();
                const compactionTokenLimit = config.memory?.compactionTokenLimit ?? 120000;
                const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                    tokenLimit: compactionTokenLimit,
                    thresholdRatio: 0.8,
                    tailSize: 15
                });
                if (wasCompressed) {
                    await HistoryManager.saveRawHistory(activeConversationId, compressedHistory);
                }
            }

            let response: any;
            try {
                response = await context.activeProvider.streamChat(currentTurnPrompt, {
                    conversationId: activeConversationId,
                    agentType: 'developer_agent',
                    searchQuery: currentPrompt,
                    systemPrompt: context.dynamicSystemPrompt,
                    hasMcpServers: context.mcpManager.getAvailableTools().length > 0,
                    signal: abortController.signal,
                    onChunk: () => {}
                });
            } catch (e: any) {
                spinner.stop('Interrupted');
                if (e.name === 'AbortError' || abortController.signal.aborted) {
                    log.warning('Interrupção solicitada via Esc. Retornando ao prompt...');
                    if (activeConversationId) {
                        await HistoryManager.saveRawHistory(activeConversationId, [
                            ...(await HistoryManager.getRawHistory(activeConversationId)),
                            { role: 'user', content: '[Execução interrompida pelo usuário via Esc. A ação anterior foi cancelada antes de sua conclusão.]' }
                        ]);
                    }
                    if (isBatchMode) {
                        return { success: false, summary: 'Interrupted by user' };
                    }
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    currentPrompt = nextMsg.content;
                    continue;
                }
                throw e;
            }

            spinner.stop('Response received');

            if (abortController.signal.aborted) {
                keepGoing = false;
                return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
            }

            if (response?.conversation_id) {
                activeConversationId = response.conversation_id;
                await conversationManager.saveConversationId(context.conversationKey, response.conversation_id);
            }

            if (response?.summary && effectiveTaskId) {
                subagentManager.updateSubagentSummary(effectiveTaskId, response.summary);
            }

            // TASK_COMPLETED
            if (response?.message && response.message.includes('TASK_COMPLETED:') && !isSubagent) {
                const mainContent = response.message.split('TASK_COMPLETED:')[0].trim();
                if (mainContent) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(mainContent);
                }

                finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                log.success(`✔ Task Completed: ${finalSummary}`);

                if (effectiveTaskId) {
                    subagentManager.updateSubagentSummary(effectiveTaskId, finalSummary);
                    subagentManager.terminateSubagent(effectiveTaskId, true);
                    if (process.env.SHARK_PARENT_ID) {
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${effectiveTaskId}) completed.\nResult Details:\n${mainContent || finalSummary}`
                        );
                    }
                    keepGoing = false;
                    break;
                }

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    let nextMsg: QueueMessage;
                    if (!messageQueue.isEmpty()) {
                        nextMsg = await messageQueue.next();
                    } else {
                        nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        userDraftBuffer = (nextMsg as any).draft || '';
                    }
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    keepGoing = false;
                    break;
                }
            }

            // TASK_FAILED
            if (response?.message && response.message.includes('TASK_FAILED:')) {
                const failReason = response.message.split('TASK_FAILED:')[1].trim();
                log.error(`❌ Agent reported task failure: ${failReason}`);
                if (effectiveTaskId) {
                    subagentManager.terminateSubagent(effectiveTaskId, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: FAILED. Summary: ${failReason}`
                        );
                    }
                    return { success: false, summary: failReason };
                }
                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                        return { success: false, summary: failReason };
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    return { success: false, summary: failReason };
                }
            }

            const action = response?.action;
            if (!action) {
                if (isSubagent) {
                    const summary = 'No action returned by the subagent.';
                    log.warning(summary);
                    subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                    subagentManager.terminateSubagent(effectiveTaskId!, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: No action returned in response.`
                        );
                    }
                    return { success: false, summary };
                }

                if (response?.message) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(response.message);
                    if (activeConversationId) {
                        const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                        void forkReviewAgent.maybeTriggerReview(rawHistory);
                    }
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode);
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                } else {
                    log.warning('No action or message returned by the agent.');
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:', subagentPrefix, undefined, isBatchMode);
                    if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                        return { success: true, summary: 'Task completed without summary.' };
                    }
                    currentPrompt = nextMsg.content;
                }
                continue;
            }

            forkReviewAgent.onToolIteration();
            if (effectiveTaskId) {
                subagentManager.updateSubagentAction(effectiveTaskId, action.type, action);
            }

            // complete_task action
            if (action.type === 'complete_task') {
                const taskSummary = action.args?.summary || action.summary || response.summary || 'Task completed successfully.';
                const detailedContent = action.args?.content || action.content || '';

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (isSubagent) {
                    subagentManager.updateSubagentSummary(effectiveTaskId!, taskSummary);
                    subagentManager.terminateSubagent(effectiveTaskId!, true);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) completed.\nResult Details:\n${detailedContent}`
                        );
                    }
                    finalSummary = taskSummary;
                    keepGoing = false;
                    break;
                } else {
                    if (detailedContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(detailedContent);
                    }
                    log.success(`✔ Task Completed: ${taskSummary}`);
                    if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        userDraftBuffer = (nextMsg as any).draft || '';
                        if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                            finalSummary = taskSummary;
                            keepGoing = false;
                            break;
                        }
                        currentPrompt = nextMsg.content;
                        continue;
                    } else {
                        finalSummary = taskSummary;
                        keepGoing = false;
                        break;
                    }
                }
            }

            // wait action
            if (action.type === 'wait') {
                const durationSeconds = action.args?.duration_seconds ?? action.duration_seconds ?? 0;
                const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);

                let nextMsg: QueueMessage;
                if (!messageQueue.isEmpty()) {
                    nextMsg = await messageQueue.next();
                } else {
                    nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs, isBatchMode, userDraftBuffer);
                    userDraftBuffer = (nextMsg as any).draft || '';
                }

                if (nextMsg.type === 'user') {
                    forkReviewAgent.onUserTurn();
                    if (isUserCancellation(nextMsg.content)) {
                        keepGoing = false;
                        break;
                    }
                    currentPrompt = nextMsg.content;
                } else if (nextMsg.type === 'subagent_notification') {
                    currentPrompt = `[Subagent Notification Received]:\n${nextMsg.content}`;
                } else if (nextMsg.type === 'timeout') {
                    currentPrompt = `[System]: Wait duration of ${durationSeconds} seconds expired. No notifications received.`;
                }
                continue;
            }

            // talk_with_user action
            if (action.type === 'talk_with_user') {
                const talkContent = action.content || action.args?.content || action.message || action.args?.message || '';
                const isSystemError = typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]');
                if (isSystemError) {
                    currentPrompt = talkContent;
                    continue;
                }

                if (isSubagent) {
                    const summary = `Subagent returned invalid response format or tried to talk with user. Content: ${talkContent}`;
                    subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                    subagentManager.terminateSubagent(effectiveTaskId!, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: Returned raw text or unsupported action instead of valid JSON.`
                        );
                    }
                    return { success: false, summary };
                }

                if (talkContent) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(talkContent);
                }

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    userDraftBuffer = (nextMsg as any).draft || '';
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            finalSummary = talkContent;
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    finalSummary = talkContent;
                    keepGoing = false;
                    break;
                }
            }

            // Executa ferramenta via actionExecutor
            const actionResult = await actionExecutor.executeAction(action);
            currentPrompt = actionResult.output;
        }

        return {
            success: true,
            summary: finalSummary || 'Task completed without summary.'
        };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/engine/turn-loop-runner.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/engine/turn-loop-runner.ts src/core/engine/turn-loop-runner.test.ts
git commit -m "feat(engine): extract turn-loop-runner module"
```

---

### Task 4: Refactor `AgentEngine` to Lean Orchestrator and Verify Full Suite

**Files:**
- Modify: `src/core/engine/agent-engine.ts`
- Test: `src/core/engine/agent-engine.test.ts` (and entire `src/core/engine/` test suite)

**Interfaces:**
- Consumes: `EngineContextBuilder`, `TurnLoopRunner`, `setupProcessCleanup`, `terminateChildSubagents`.
- Produces: `AgentEngine` with identical public methods, reduced from 850 lines to ~170 lines.

- [ ] **Step 1: Refactor `src/core/engine/agent-engine.ts`**

Replace implementation of `src/core/engine/agent-engine.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { AgentChannelAdapter } from '../adapters/adapter.interface.js';
import type { AgentOutboundEvent, InboundUserMessage } from './events.js';
import { SessionLeaseManager } from './session-lease.js';
import { PendingApprovalsManager } from './pending-approvals.js';
import { AgentActionExecutor } from './agent-action-executor.js';
import { handleSlashCommand } from './agent-slash-commands.js';
import { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';
import { MessageQueue } from '../workflow/message-queue.js';
import { promptUser } from '../workflow/interactive-prompt.js';
import { ForkReviewAgent } from '../workflow/fork-review-agent.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { cleanupAgentTools } from '../agents/agent-tools.js';
import { tui } from '../../ui/tui.js';
import { EngineContextBuilder } from './engine-context-builder.js';
import { TurnLoopRunner, type DevelopmentResult } from './turn-loop-runner.js';
import { setupProcessCleanup, terminateChildSubagents } from './subagent-sync.js';

export { DevelopmentResult };

export interface AgentEngineOptions {
    sessionId?: string;
    auto?: boolean;
    leaseManager?: SessionLeaseManager;
    approvalsManager?: PendingApprovalsManager;
    projectRoot?: string;
    bridgeToolsManager?: BridgeToolsManager;
    taskId?: string;
    context?: string;
}

export interface EngineRunOptions {
    taskInstruction?: string;
    taskId?: string;
    context?: string;
    history?: string;
    auto?: boolean;
    messageQueue?: MessageQueue;
    sessionId?: string;
}

function isUserCancellation(content: any): boolean {
    return tui.isCancel(content) || !content || content === 'cancel';
}

export class AgentEngine {
    public readonly sessionId: string;
    public projectRoot: string;
    private adapter?: AgentChannelAdapter;
    private leaseManager: SessionLeaseManager;
    private approvalsManager: PendingApprovalsManager;
    private currentTurnAbort?: AbortController;
    private isAborted: boolean = false;
    private abortReason?: string;
    private bridgeToolsManager?: BridgeToolsManager;
    private taskId?: string;
    private contextPath?: string;
    private forkReviewAgents = new Map<string, ForkReviewAgent>();

    constructor(options: AgentEngineOptions = {}) {
        this.sessionId = options.sessionId || `session_${Date.now()}`;
        this.projectRoot = options.projectRoot || process.cwd();
        this.leaseManager = options.leaseManager || new SessionLeaseManager();
        this.approvalsManager = options.approvalsManager || new PendingApprovalsManager();
        this.bridgeToolsManager = options.bridgeToolsManager;
        this.taskId = options.taskId;
        this.contextPath = options.context;
    }

    public attachAdapter(adapter: AgentChannelAdapter) {
        this.adapter = adapter;
        this.adapter.onInbound(async (event) => {
            const isTargetSession = !this.sessionId || this.sessionId === '*' || event.sessionId === this.sessionId;
            if (event.type === 'abort_command' && isTargetSession) {
                this.abortCurrentTurn(event.reason);
                return;
            }
            if (event.type === 'action_approval_response') {
                this.handleApprovalResponse(event);
                return;
            }
            if (event.type === 'user_message' && isTargetSession) {
                await this.processMessage(event);
            }
        });
    }

    public abortCurrentTurn(reason: string = 'Interrupted by user') {
        this.isAborted = true;
        this.abortReason = reason;
        if (this.currentTurnAbort) {
            this.currentTurnAbort.abort(reason);
            this.currentTurnAbort = undefined;
        }
        this.emitOutbound({
            type: 'turn_interrupted',
            sessionId: this.sessionId,
            reason
        });
    }

    public emitOutbound(event: AgentOutboundEvent) {
        this.adapter?.emit(event);
    }

    public async runInteractive(options: EngineRunOptions = {}): Promise<DevelopmentResult> {
        const abortController = new AbortController();
        this.currentTurnAbort = abortController;
        if (this.isAborted) {
            abortController.abort(this.abortReason || 'Interrupted by user');
            return { success: false, summary: this.abortReason || 'Interrupted by user' };
        }

        const isBatchMode = options.auto === true || process.argv.includes('--auto');
        let autoApproveTools = isBatchMode;
        const effectiveTaskId = options.taskId || this.taskId;
        const isSubagent = !!effectiveTaskId && (effectiveTaskId.startsWith('subagent-') || subagentManager.hasSubagent(effectiveTaskId));
        const effectiveSessionId = options.sessionId || this.sessionId || 'default';
        const projectRoot = this.projectRoot || process.cwd();
        const messageQueue = options.messageQueue || new MessageQueue();
        const myId = effectiveTaskId || 'parent';

        // 1. Prepara contexto e subsistemas via EngineContextBuilder
        let forkReviewAgent = this.forkReviewAgents.get(effectiveSessionId);
        const context = await EngineContextBuilder.prepare({
            projectRoot,
            sessionId: effectiveSessionId,
            taskId: effectiveTaskId,
            context: options.context || this.contextPath,
            history: options.history,
            taskInstruction: options.taskInstruction,
            bridgeToolsManager: this.bridgeToolsManager,
            autoApproveTools,
            emitOutbound: (ev) => this.emitOutbound(ev),
            forkReviewAgent
        });

        if (!forkReviewAgent) {
            this.forkReviewAgents.set(effectiveSessionId, context.forkReviewAgent);
            forkReviewAgent = context.forkReviewAgent;
        }
        this.bridgeToolsManager = context.bridgeTools;

        // 2. Slash command handler
        let activeConversationId = context.activeConversationId;
        const onSlashCommand = async (cmd: string): Promise<boolean> => {
            const res = await handleSlashCommand(cmd, {
                projectRoot,
                activeConversationId,
                conversationKey: context.conversationKey,
                forkReviewAgent,
                skillManager: (context.forkReviewAgent as any).skillManager,
                autoApproveTools,
                onLog: (type, msg) => {
                    if (type === 'warning') tui.log.warning(msg);
                    else if (type === 'error') tui.log.error(msg);
                    else if (type === 'success') tui.log.success(msg);
                    else tui.log.info(msg);
                },
                onPromptSelect: async (opts) => {
                    const sel = await tui.select(opts);
                    return tui.isCancel(sel) ? null : (sel as string);
                }
            });
            if (res.autoApproveTools !== undefined) autoApproveTools = res.autoApproveTools;
            if (res.activeConversationId) activeConversationId = res.activeConversationId;
            return res.handled;
        };

        // 3. Prompt inicial interativo caso não fornecido
        let initialInstruction = options.taskInstruction;
        if (!initialInstruction) {
            if (isSubagent) {
                initialInstruction = 'Subagent Task';
            } else {
                const userTask = await promptUser(
                    'O que você gostaria que o Shark Dev fizesse?',
                    undefined,
                    'ex: crie uma API REST simples ou digite /skills para ativar diretrizes',
                    '',
                    onSlashCommand
                );
                if (isUserCancellation(userTask)) {
                    return { success: false, summary: 'Task execution cancelled.' };
                }
                forkReviewAgent.onUserTurn();
                initialInstruction = userTask;
            }
        } else {
            if (initialInstruction.startsWith('/')) {
                const handled = await onSlashCommand(initialInstruction);
                if (handled) {
                    if (forkReviewAgent.currentReviewPromise) {
                        await forkReviewAgent.currentReviewPromise.catch(() => {});
                    }
                    return { success: true, summary: `Command ${initialInstruction} executed.` };
                }
            }
            if (!isSubagent) {
                forkReviewAgent.onUserTurn();
            }
        }

        // 4. Action Executor
        const actionExecutor = new AgentActionExecutor({
            projectRoot,
            sessionId: this.sessionId,
            autoApprove: autoApproveTools,
            emitOutbound: (ev) => this.emitOutbound(ev),
            requestApproval: async (toolName, toolArgs, fallbackText) => {
                if (autoApproveTools) return true;
                const approved = await tui.confirm({ message: fallbackText });
                return !!approved;
            },
            bridgeToolsManager: this.bridgeToolsManager,
            memoryStore: context.memoryStore,
            onMemoryUpdated: () => context.updateDynamicPrompt(),
            activeConversationId,
            currentTaskId: effectiveTaskId,
            messageQueue
        });

        // 5. Configuração de encerramento seguro de processos
        const processCleanup = setupProcessCleanup(myId, tui.log);

        try {
            const result = await TurnLoopRunner.run({
                sessionId: effectiveSessionId,
                projectRoot,
                taskId: effectiveTaskId,
                isBatchMode,
                messageQueue,
                abortController,
                actionExecutor,
                context
            });

            terminateChildSubagents(myId);

            if (forkReviewAgent.currentReviewPromise) {
                await forkReviewAgent.currentReviewPromise.catch(() => {});
            }

            if (effectiveTaskId && process.env.SHARK_PARENT_ID) {
                subagentManager.terminateSubagent(effectiveTaskId, true);
                const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                subagentManager.sendMessage(
                    process.env.SHARK_PARENT_ID,
                    `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: COMPLETED. Summary: ${result.summary}`
                );
            }

            tui.log.success('✅ Task Scope Completed');
            return result;
        } finally {
            cleanupAgentTools();
            await context.mcpManager.closeAll();
            processCleanup.dispose();
            if (this.currentTurnAbort === abortController) {
                this.currentTurnAbort = undefined;
            }
        }
    }

    public async processMessage(message: InboundUserMessage): Promise<void> {
        const effectiveSessionId = message.sessionId || this.sessionId;
        const holderId = randomUUID();
        const acquired = this.leaseManager.acquireLease(effectiveSessionId, holderId);
        if (!acquired) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: 'Session is busy with another active turn'
            });
            return;
        }

        this.isAborted = false;
        this.abortReason = undefined;

        const originalCwd = process.cwd();
        try {
            if (this.projectRoot && this.projectRoot !== originalCwd) {
                try {
                    process.chdir(this.projectRoot);
                } catch {}
            }

            this.emitOutbound({
                type: 'presence_status',
                sessionId: effectiveSessionId,
                status: 'typing',
                emojiReaction: '👀'
            });

            const result = await this.runInteractive({
                taskInstruction: message.text,
                auto: true,
                sessionId: effectiveSessionId
            });

            if (!result.success && (result.summary.includes('Interrupted') || result.summary.includes('cancelled') || result.summary.includes('user_cancelled'))) {
                return;
            }

            this.emitOutbound({
                type: 'turn_completed',
                sessionId: effectiveSessionId,
                summary: result.summary
            });
        } catch (error: any) {
            this.emitOutbound({
                type: 'turn_interrupted',
                sessionId: effectiveSessionId,
                reason: error.message
            });
        } finally {
            this.isAborted = false;
            this.abortReason = undefined;
            if (process.cwd() !== originalCwd) {
                try {
                    process.chdir(originalCwd);
                } catch {}
            }
            this.leaseManager.releaseLease(effectiveSessionId, holderId);
        }
    }

    private handleApprovalResponse(event: any) {
        this.approvalsManager.resolveApproval(event.approvalId, event.decision);
    }

    public getApprovalsManager(): PendingApprovalsManager {
        return this.approvalsManager;
    }

    public getLeaseManager(): SessionLeaseManager {
        return this.leaseManager;
    }
}
```

- [ ] **Step 2: Run all engine tests to verify nothing broke**

Run: `npm test src/core/engine/`  
Expected: All 5 test files pass (100% test success).

- [ ] **Step 3: Commit**

```bash
git add src/core/engine/agent-engine.ts
git commit -m "refactor(engine): streamline agent-engine into clean orchestrator"
```
