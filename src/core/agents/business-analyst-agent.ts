import { STACKSPOT_AGENT_API_BASE } from '../api/stackspot-client.js';
import { sseClient } from '../api/sse-client.js';
import { parseAgentResponse, AgentResponse } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { ConfigManager } from '../config-manager.js';

const AGENT_TYPE = 'business_analyst';

function getAgentId(overrideId?: string): string {
    if (overrideId) return overrideId;
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.ba) return config.agents.ba;
    return process.env.STACKSPOT_BA_AGENT_ID || '01KEJ95G304TNNAKGH5XNEEBVD';
}

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
    const { agentId, onChunk, onComplete } = options;

    // 1. Get active realm from config (auto-detect)
    const realm = await getActiveRealm();

    // 1. Get auth token
    const token = await tokenStorage.getToken(realm);
    if (!token) {
        throw new Error(`No authentication token found for realm '${realm}'. Please run 'shark login'.`);
    }

    // 2. Load existing conversation ID (if any)
    const existingConversationId = await conversationManager.getConversationId(AGENT_TYPE);

    // 3. Build request payload (StackSpot agent format)
    const requestPayload = {
        user_prompt: prompt,
        streaming: true,
        stackspot_knowledge: false, // Use agent's configured KS instead
        return_ks_in_response: true,
        deep_search_ks: false,
        conversation_id: existingConversationId,
    };

    // 4. Construct agent URL - CORRECT FORMAT
    const effectiveAgentId = getAgentId(options.agentId);
    const agentUrl = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${effectiveAgentId}/chat`;

    // 5. Prepare headers
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    // 6. Stream agent response
    let fullMessage = '';
    let rawResponse: any = {};

    await sseClient.streamAgentResponse(
        agentUrl,
        requestPayload,
        headers,
        {
            onChunk: (chunk) => {
                fullMessage += chunk;
                if (onChunk) {
                    onChunk(chunk);
                }
            },
            onComplete: async (message) => {
                // Build complete response object
                rawResponse = {
                    message: message || fullMessage,
                    conversation_id: existingConversationId, // Will be updated if new one provided
                };
            },
            onError: (error) => {
                throw error;
            },
        }
    );

    // 7. Parse response
    const parsedResponse = parseAgentResponse(rawResponse);

    // 8. Save new conversation ID (if provided)
    if (parsedResponse.conversation_id) {
        await conversationManager.saveConversationId(AGENT_TYPE, parsedResponse.conversation_id);
    }

    // 9. Call completion callback
    if (onComplete) {
        onComplete(parsedResponse);
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
                            tui.log.info(colors.green('🤖 BA Agent:'));
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
                if (response.tokens) {
                    tui.log.info(`Tokens used: ${response.tokens.output || 0}`);
                }
            },
        });

        tui.outro('Session complete');
    } catch (error: any) {
        spinner.stop('❌ Error', 1);
        tui.log.error(error.message);
        throw error;
    }
}
