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
import { HistoryManager } from '../workflow/history-manager.js';
import { subagentManager } from '../workflow/subagent-manager.js';
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
    readonly basePrompt: string;
    dynamicSystemPrompt: string;
    setTaskInstruction: (instruction: string) => void;
    mcpManager: McpManager;
    mcpTools: any[];
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
        const isSubagent = !!effectiveTaskId && (effectiveTaskId.startsWith('subagent-') || subagentManager.hasSubagent(effectiveTaskId));
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
        let hasExistingHistory = false;
        if (activeConversationId) {
            try {
                const existingHistory = await HistoryManager.getRawHistory(activeConversationId);
                hasExistingHistory = Array.isArray(existingHistory) && existingHistory.length > 0;
            } catch {
                hasExistingHistory = false;
            }
        }
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
        const buildBasePrompt = (instruction: string) => {
            if (hasExistingHistory && !isSubagent) {
                return instruction || '';
            }

            let prompt = '';
            if (contextContent) {
                prompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
            }
            if (options.history) {
                prompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
            }
            prompt += `\n\n🟢 EXECUTION MODE\n
You are a highly skilled Developer Agent.
👉 **CURRENT TASK**: "${instruction || ''}"

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
            return prompt;
        };

        let currentBasePrompt = buildBasePrompt(options.taskInstruction || '');

        return {
            dynamicSystemPrompt,
            get basePrompt() { return currentBasePrompt; },
            setTaskInstruction: (instruction: string) => {
                currentBasePrompt = buildBasePrompt(instruction);
            },
            mcpManager,
            mcpTools,
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
