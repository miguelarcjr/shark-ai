
import { STACKSPOT_AGENT_API_BASE } from '../api/stackspot-client.js';
import { sseClient } from '../api/sse-client.js';
import { parseAgentResponse, AgentResponse } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import fs from 'node:fs';
import path from 'node:path';
import { FileLogger } from '../debug/file-logger.js';
import { handleListFiles, handleReadFile, handleSearchFile, startSmartReplace } from './agent-tools.js';
import { ConfigManager } from '../config-manager.js';

const AGENT_TYPE = 'specification_agent';

function getAgentId(overrideId?: string): string {
    if (overrideId) return overrideId;
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.spec) return config.agents.spec;
    return process.env.STACKSPOT_SPEC_AGENT_ID || '01KEPXTX37FTB4N672TZST4SGP';
}

export interface SpecAgentOptions {
    agentId?: string;
    briefingPath?: string; // Path to the briefing file to read
}

/**
 * Interactive Specification Agent session.
 * Reads briefing, consults user, and generates tech-spec.md.
 */
export async function interactiveSpecificationAgent(options: SpecAgentOptions = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🏗️  Specification Agent');

    // 1. Resolve Briefing File
    let briefingContent = '';
    let briefingPath = options.briefingPath;

    if (!briefingPath) {
        // Try to find a default briefing in current dir
        const files = fs.readdirSync(process.cwd());
        const defaultBriefing = files.find(f => f.endsWith('_briefing.md'));

        briefingPath = await tui.text({
            message: 'Path to Briefing file (Leave empty to skip)',
            initialValue: defaultBriefing || '',
            placeholder: 'e.g., todo-list_briefing.md',
            validate: (val) => {
                if (val && !fs.existsSync(val)) return 'File not found';
            }
        }) as string;
    }

    if (tui.isCancel(briefingPath)) return;

    if (briefingPath) {
        try {
            briefingContent = fs.readFileSync(briefingPath, 'utf-8');
            tui.log.info(`Loaded briefing: ${colors.bold(briefingPath)}`);
        } catch (e) {
            tui.log.error(`Failed to read briefing: ${e}`);
            return;
        }
    } else {
        tui.log.info('Skipping briefing file. Starting fresh or exploring existing project.');
    }

    // 2. Initial Prompt Construction
    const initialPrompt = briefingContent ? `
Tenho o seguinte Documento de Briefing de Negócio. 
Por favor, analise-o e inicie o processo de definição da Especificação Técnica.

---
${briefingContent}
---
    `.trim() : 'Gostaria de ajuda com uma especificação técnica ou explorar este projeto.';

    // 3. Start Conversation Loop
    await runSpecLoop(initialPrompt, options.agentId);
}

/**
 * Main Loop for Specification Agent
 */
async function runSpecLoop(initialMessage: string, overrideAgentId?: string) {
    let nextPrompt = initialMessage;
    let keepGoing = true;

    while (keepGoing) {
        const spinner = tui.spinner();
        spinner.start('🏗️  Specification Agent is thinking...');

        let responseText = '';
        let lastResponse: AgentResponse | null = null;

        try {
            // Call Agent
            lastResponse = await callSpecAgentApi(nextPrompt, (chunk) => {
                responseText += chunk;
                try {
                    if (responseText.trim().startsWith('{')) {
                        spinner.message(colors.dim('Receiving structured data...'));
                    } else {
                        spinner.message(colors.dim('Thinking...'));
                    }
                } catch (e) { }
            }, overrideAgentId);

            spinner.stop('Response received');

            // Handle Response Actions
            if (lastResponse && lastResponse.actions) {
                // Reset next prompt, we will build it based on actions results
                let executionResults = "";
                let waitingForUser = false;

                for (const action of lastResponse.actions) {

                    if (action.type === 'talk_with_user') {
                        tui.log.info(colors.primary('🤖 Architect:'));
                        console.log(action.content);
                        waitingForUser = true;
                    }

                    else if (action.type === 'list_files') {
                        tui.log.info(`📂 List files in: ${colors.bold(action.path || '.')}`);
                        const result = handleListFiles(action.path || '.');
                        executionResults += `[Action list_files(${action.path}) Result]:\n${result}\n\n`;
                        tui.log.info(colors.dim(`Files listed.`));
                    }

                    else if (action.type === 'read_file') {
                        tui.log.info(`📖 Read file: ${colors.bold(action.path || '')}`);
                        const result = handleReadFile(action.path || '');
                        executionResults += `[Action read_file(${action.path}) Result]:\n${result}\n\n`;
                        tui.log.info(colors.dim(`File read.`));
                    }

                    else if (action.type === 'search_file') {
                        tui.log.info(`🔍 Search file: ${colors.bold(action.path || '')}`);
                        const result = handleSearchFile(action.path || '');
                        executionResults += `[Action search_file(${action.path}) Result]:\n${result}\n\n`;
                        tui.log.info(colors.dim(`Files found.`));
                    }

                    else if (['create_file', 'modify_file', 'delete_file'].includes(action.type)) {
                        tui.log.warning(`\n🤖 Agent wants to ${action.type}: ${colors.bold(action.path || 'unknown')}`);

                        // Preview
                        if (action.content) {
                            console.log(colors.dim('--- Content Preview ---'));
                            console.log(action.content.substring(0, 300) + '...');
                            console.log(colors.dim('-----------------------'));
                        }

                        const confirm = await tui.confirm({
                            message: `Approve ${action.type}?`,
                            active: 'Yes',
                            inactive: 'No'
                        });

                        if (confirm) {
                            if (action.path) {
                                try {
                                    if (action.type === 'create_file') {
                                        fs.writeFileSync(action.path, action.content || '');
                                        tui.log.success(`✅ Created: ${action.path}`);
                                        executionResults += `[Action create_file(${action.path})]: Success\n\n`;
                                    } else if (action.type === 'modify_file') {
                                        if (action.target_content) {
                                            const success = startSmartReplace(action.path, action.content || '', action.target_content, tui);
                                            executionResults += `[Action modify_file(${action.path})]: ${success ? 'Success' : 'Failed'}\n\n`;
                                        } else {
                                            fs.writeFileSync(action.path, action.content || '');
                                            tui.log.success(`✅ Overwritten: ${action.path}`);
                                            executionResults += `[Action modify_file(${action.path})]: Success (Overwrite)\n\n`;
                                        }
                                    } else if (action.type === 'delete_file') {
                                        fs.unlinkSync(action.path);
                                        tui.log.success(`✅ Deleted: ${action.path}`);
                                        executionResults += `[Action delete_file(${action.path})]: Success\n\n`;
                                    }
                                } catch (e: any) {
                                    tui.log.error(`❌ Failed: ${e.message}`);
                                    executionResults += `[Action ${action.type}(${action.path})]: Error: ${e.message}\n\n`;
                                }
                            }
                        } else {
                            tui.log.error('❌ Action denied.');
                            executionResults += `[Action ${action.type}]: User Denied\n\n`;
                        }
                    }
                }

                // Prepare next prompt
                if (executionResults) {
                    // If actions produced output (like file list), send it back to agent automatically
                    // But if the agent ALSO talked to user, we should give priority to user input??
                    // Strategy: If agent asked something (talk_with_user), we MUST ask user.
                    // The tool outputs are appended.

                    if (waitingForUser) {
                        const userReply = await tui.text({
                            message: 'Your answer',
                            placeholder: 'Type your answer...'
                        });
                        if (tui.isCancel(userReply)) {
                            keepGoing = false;
                            return;
                        }
                        nextPrompt = `${executionResults}\n\nUser Reply: ${userReply}`;
                        tui.log.info(colors.dim('Auto-replying with tool results...'));
                    } else {
                        // Agent just did tools, let's auto-reply with results so it can continue
                        nextPrompt = executionResults;
                        FileLogger.log('SYSTEM', 'Auto-replying with Tool Results', { length: executionResults.length });
                        tui.log.info(colors.dim('Auto-replying with tool results...'));
                    }

                } else if (waitingForUser) {
                    // Only talk, no tools
                    const userReply = await tui.text({
                        message: 'Your answer',
                        placeholder: 'Type your answer...'
                    });
                    if (tui.isCancel(userReply)) {
                        keepGoing = false;
                        return;
                    }
                    nextPrompt = userReply as string;
                } else {
                    // No actions? Weird.
                    tui.log.warning('No actions taken.');
                    keepGoing = false;
                }

            } else {
                tui.log.warning('No actions received from agent.');
                keepGoing = false;
            }

        } catch (error: any) {
            spinner.stop('Error');
            tui.log.error(error.message);
            keepGoing = false;
        }
    }
}

// --- Helper Functions in agent-tools.ts ---

// --- API Wrapper ---

async function callSpecAgentApi(prompt: string, onChunk: (chunk: string) => void, agentId?: string): Promise<AgentResponse> {
    const realm = await getActiveRealm();
    const token = await tokenStorage.getToken(realm);
    if (!token) throw new Error('Not logged in');

    const conversationId = await conversationManager.getConversationId(AGENT_TYPE);

    const payload = {
        user_prompt: prompt,
        streaming: true,
        stackspot_knowledge: false,
        return_ks_in_response: true,
        use_conversation: true,
        conversation_id: conversationId
    };

    const effectiveAgentId = getAgentId(agentId);
    const url = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${effectiveAgentId}/chat`;

    let fullMsg = '';
    let raw: any = {};

    FileLogger.log('AGENT', 'Calling Agent API', {
        agentId: effectiveAgentId,
        conversationId,
        prompt: prompt.substring(0, 500) // Log summary of prompt
    });

    await sseClient.streamAgentResponse(url, payload, { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, {
        onChunk: (c) => { fullMsg += c; onChunk(c); },
        onComplete: (msg, metadata) => {
            // Prefer conversation_id from metadata (server response), fallback to sent ID
            const returnedId = metadata?.conversation_id;

            FileLogger.log('AGENT', 'Response Complete', {
                conversationId,
                returnedId,
                messageLength: msg?.length
            });

            raw = {
                message: msg || fullMsg,
                conversation_id: returnedId || conversationId
            };
        },
        onError: (e) => { throw e; }
    });

    const parsed = parseAgentResponse(raw);
    if (parsed.conversation_id) {
        await conversationManager.saveConversationId(AGENT_TYPE, parsed.conversation_id);
    }

    return parsed;
}
