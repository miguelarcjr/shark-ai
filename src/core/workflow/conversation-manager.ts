import { workflowManager } from './workflow-manager.js';

/**
 * Manages conversation IDs for agent interactions.
 * Stores conversation IDs in the workflow state to maintain context across sessions.
 */
export class ConversationManager {
    private static instance: ConversationManager;

    private constructor() { }

    public static getInstance(): ConversationManager {
        if (!ConversationManager.instance) {
            ConversationManager.instance = new ConversationManager();
        }
        return ConversationManager.instance;
    }

    /**
     * Saves a conversation ID for a specific agent type.
     * 
     * @param agentType - The type of agent (e.g., 'business_analyst', 'architect')
     * @param conversationId - The conversation ID from the agent response
     */
    async saveConversationId(agentType: string, conversationId: string): Promise<void> {
        const state = await workflowManager.load();
        if (!state) {
            throw new Error('No workflow state found. Please run "shark init" first.');
        }

        // Initialize conversations object if it doesn't exist
        if (!state.conversations) {
            state.conversations = {};
        }

        state.conversations[agentType] = conversationId;
        await workflowManager.save(state);
    }

    /**
     * Retrieves the conversation ID for a specific agent type.
     * 
     * @param agentType - The type of agent
     * @returns The conversation ID, or undefined if none exists
     */
    async getConversationId(agentType: string): Promise<string | undefined> {
        const state = await workflowManager.load();
        if (!state || !state.conversations) {
            return undefined;
        }

        return state.conversations[agentType];
    }

    /**
     * Clears the conversation ID for a specific agent type.
     * 
     * @param agentType - The type of agent
     */
    async clearConversationId(agentType: string): Promise<void> {
        const state = await workflowManager.load();
        if (!state || !state.conversations) {
            return;
        }

        delete state.conversations[agentType];
        await workflowManager.save(state);
    }

    /**
     * Clears all conversation IDs.
     * Useful when transitioning to a new project or resetting state.
     */
    async clearAllConversations(): Promise<void> {
        const state = await workflowManager.load();
        if (!state) {
            return;
        }

        state.conversations = {};
        await workflowManager.save(state);
    }
}

export const conversationManager = ConversationManager.getInstance();
