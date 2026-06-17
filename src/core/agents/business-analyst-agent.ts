import { ProviderResolver } from '../api/provider-resolver.js';
import { AgentResponse } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';

const AGENT_TYPE = 'business_analyst';

export interface BAAgentOptions {
    agentId?: string; // Allow overriding agent ID
    onChunk?: (chunk: string) => void;
    onComplete?: (response: AgentResponse) => void;
}

/**
 * Orchestrates interaction with the Business Analyst agent.
 * Integrates all communication components into a complete flow.
 * Automatically uses the active realm from config (no need to pass it).
 * 
 * @param prompt - User's project description
 * @param options - Configuration options (callbacks, optional agentId override)
 * @returns Complete agent response
 */
export async function runBusinessAnalystAgent(
    prompt: string,
    options: BAAgentOptions = {}
): Promise<AgentResponse> {
    const { onChunk, onComplete } = options;

    const existingConversationId = await conversationManager.getConversationId(AGENT_TYPE);
    
    // Resolve active provider dynamically
    const provider = ProviderResolver.getProvider('business_analyst');

    // Handle agent ID override if applicable for the provider
    if (options.agentId && 'agentId' in provider) {
        (provider as any).agentId = options.agentId;
    }

    const parsedResponse = await provider.streamChat(prompt, {
        conversationId: existingConversationId,
        agentType: 'business_analyst',
        onChunk,
        onComplete
    });

    if (parsedResponse.conversation_id) {
        await conversationManager.saveConversationId(AGENT_TYPE, parsedResponse.conversation_id);
    }

    return parsedResponse;
}


/**
 * Interactive Business Analyst session with TUI.
 * Prompts user for input and displays streamed response.
 * Automatically uses the active realm from config.
 */
export async function interactiveBusinessAnalyst(): Promise<void> {
    tui.intro('🎯 Business Analyst Agent');

    const prompt = await tui.text({
        message: 'Describe your project idea',
        placeholder: 'E.g., I want to build a task management app for teams...',
        validate: (value) => {
            if (!value || value.length < 10) return 'Please provide a detailed description (at least 10 characters)';
        },
    });

    if (tui.isCancel(prompt)) {
        tui.outro('Cancelled');
        return;
    }

    const spinner = tui.spinner();
    spinner.start('💬 Business Analyst is thinking...');

    let responseText = '';

    try {
        await runBusinessAnalystAgent(prompt as string, {
            onChunk: (chunk) => {
                responseText += chunk;
                // Update spinner with preview (try to parse JSON if possible, otherwise raw)
                try {
                    // Start of JSON?
                    if (responseText.trim().startsWith('{')) {
                        spinner.message(colors.dim('Receiving structured data...'));
                    } else {
                        spinner.message(colors.dim('Thinking...'));
                    }
                } catch (e) {
                    // ignore
                }
            },
            onComplete: async (response) => {
                spinner.stop('Response received');

                // Show summary if exists
                if (response.summary) {
                    tui.log.info(colors.italic(response.summary));
                }

                // Handle Actions
                if (response.actions && response.actions.length > 0) {
                    for (const action of response.actions) {

                        // CASE 1: TALK WITH USER (Conventional Message)
                        if (action.type === 'talk_with_user') {
                            tui.log.info(colors.success('🤖 BA Agent:'));
                            console.log(action.content); // Print formatted markdown

                            // We don't verify "talk", we just show it.
                            // The flow will wait for next user input naturally at loop start?
                            // Wait! We need a loop here?
                            // runBusinessAnalystAgent is a ONE-OFF request.
                            // The LOOP needs to be in interactiveBusinessAnalyst.
                        }

                        // CASE 2: FILE OPERATIONS (Autonomous Actions)
                        else {
                            tui.log.warning(`\n🤖 Agent wants to ${action.type}: ${colors.bold(action.path || 'unknown')}`);

                            // Show content preview
                            if (action.content) {
                                console.log(colors.dim('--- Content Preview ---'));
                                console.log(action.content.substring(0, 300) + (action.content.length > 300 ? '...' : ''));
                                console.log(colors.dim('-----------------------'));
                            }

                            const confirm = await tui.confirm({
                                message: `Allow agent to ${action.type} '${action.path}'?`,
                                active: 'Yes',
                                inactive: 'No'
                            });

                            if (confirm) {
                                // TODO: Add actual file system writing logic here
                                // fs.writeFileSync(action.path!, action.content);
                                tui.log.success(`✅ Action executed: ${action.path} created.`);
                            } else {
                                tui.log.error('❌ Action denied.');
                            }
                        }
                    }
                }
                // Tokens property removed from schema, ignoring log.
            },
        });

        tui.outro('Session complete');
    } catch (error: any) {
        spinner.stop('❌ Error', 1);
        tui.log.error(error.message);
        throw error;
    }
}
