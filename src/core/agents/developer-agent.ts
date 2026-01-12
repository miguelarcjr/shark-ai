
import { STACKSPOT_AGENT_API_BASE } from '../api/stackspot-client.js';
import { sseClient } from '../api/sse-client.js';
import { parseAgentResponse, AgentResponse, AgentAction } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { ConfigManager } from '../config-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { FileLogger } from '../debug/file-logger.js';
import {
    handleListFiles,
    handleReadFile,
    handleSearchFile,
    startSmartReplace,
    handleRunCommand
} from './agent-tools.js';

const AGENT_TYPE = 'developer_agent';
// Placeholder ID - User must provide the real one via env
const AGENT_ID = process.env.STACKSPOT_DEV_AGENT_ID || '01KEQCGJ65YENRA4QBXVN1YFFX'; // Default ID if not set in env

export async function interactiveDeveloperAgent(options: { task?: string, context?: string } = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🦈 Shark Dev Agent');

    if (AGENT_ID === 'PENDING_CONFIGURATION') {
        tui.log.error('❌ STACKSPOT_DEV_AGENT_ID not configured in .env');
        return;
    }

    // 1. Load Context
    const projectRoot = process.cwd();
    let contextContent = '';
    const defaultContextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
    const specificContextPath = options.context ? path.resolve(projectRoot, options.context) : defaultContextPath;

    if (fs.existsSync(specificContextPath)) {
        try {
            contextContent = fs.readFileSync(specificContextPath, 'utf-8');
            tui.log.info(`📘 Context loaded from: ${colors.dim(path.relative(projectRoot, specificContextPath))}`);
        } catch (e) {
            tui.log.warning(`Failed to read context file: ${e}`);
        }
    } else {
        tui.log.warning(`⚠️ No context file found. Agent will run without pre-loaded context.`);
    }

    // 2. Prepare Initial Prompt
    let nextPrompt = options.task || "I'm ready to help. What's the task?";
    if (contextContent) {
        nextPrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------`;
    }

    // 3. Main Loop
    let keepGoing = true;
    const spinner = tui.spinner();

    while (keepGoing) {
        try {
            spinner.start('Waiting for Agent...');

            // Call API
            let lastResponse: AgentResponse | null = null;
            await callDevAgentApi(nextPrompt, (chunk) => {
                // Optional: Stream text to TUI if needed
                if (!lastResponse) {
                    // Maybe show thinking dots?
                }
            }).then(resp => {
                lastResponse = resp;
            });

            spinner.stop('Response received');

            if (lastResponse && (lastResponse as AgentResponse).actions) {
                const response = lastResponse as AgentResponse;
                let executionResults = "";
                let waitingForUser = false;

                for (const action of response.actions) {

                    if (action.type === 'talk_with_user') {
                        tui.log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(action.content);
                        waitingForUser = true;
                    }

                    else if (action.type === 'list_files') {
                        tui.log.info(`📂 Scanning dir: ${colors.dim(action.path || '.')}`);
                        const result = handleListFiles(action.path || '.');
                        executionResults += `[Action list_files(${action.path}) Result]:\n${result}\n\n`;
                    }

                    else if (action.type === 'read_file') {
                        tui.log.info(`📖 Reading: ${colors.dim(action.path || '')}`);
                        const result = handleReadFile(action.path || '');
                        executionResults += `[Action read_file(${action.path}) Result]:\n${result}\n\n`;
                    }

                    else if (action.type === 'search_file') {
                        tui.log.info(`🔍 Searching: ${colors.dim(action.path || '')}`);
                        const result = handleSearchFile(action.path || '');
                        executionResults += `[Action search_file(${action.path}) Result]:\n${result}\n\n`;
                    }

                    else if (action.type === 'run_command') {
                        const cmd = action.command || '';
                        tui.log.info(`💻 Executing: ${colors.dim(cmd)}`);
                        // Execute Command
                        // Warning: Prompt user for non-safe commands? 
                        // For now, let's assume Shark Dev is trusted or ask for everything.
                        // Let's ask for confirmation for consistency.
                        const confirm = await tui.confirm({
                            message: `Execute command: ${cmd}?`,
                            active: 'Yes',
                            inactive: 'No'
                        });

                        if (confirm) {
                            const result = await handleRunCommand(cmd);
                            executionResults += `[Action run_command(${cmd}) Result]:\n${result}\n\n`;
                        } else {
                            executionResults += `[Action run_command]: User blocked execution.\n\n`;
                        }
                    }

                    else if (['create_file', 'modify_file'].includes(action.type)) {
                        const isCreate = action.type === 'create_file';
                        const filePath = action.path || '';
                        tui.log.warning(`\n🤖 Agent wants to ${isCreate ? 'CREATE' : 'MODIFY'}: ${colors.bold(filePath)}`);

                        // Preview content (maybe diff?)
                        // For brevity, just log start
                        if (action.content) {
                            console.log(colors.dim('--- Content ---\n') + action.content.substring(0, 200) + '...\n' + colors.dim('---------------'));
                        }

                        const confirm = await tui.confirm({
                            message: `Approve changes to ${filePath}?`,
                            active: 'Yes',
                            inactive: 'No'
                        });

                        if (confirm) {
                            if (filePath) {
                                const targetPath = path.resolve(projectRoot, filePath);
                                const dir = path.dirname(targetPath);
                                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                                if (isCreate) {
                                    fs.writeFileSync(targetPath, action.content || '');
                                    tui.log.success(`✅ Created: ${filePath}`);
                                    executionResults += `[Action create_file(${filePath})]: Success\n\n`;
                                } else {
                                    // Modify
                                    if (action.target_content) {
                                        const success = startSmartReplace(filePath, action.content || '', action.target_content, tui);
                                        executionResults += `[Action modify_file(${filePath})]: ${success ? 'Success' : 'Failed'}\n\n`;
                                    } else {
                                        // Fallback overwrite if no target_content provided (should be rare given schema)
                                        // But for Dev Agent, schema requires new_content (mapped to content) and target_content.
                                        // If target_content missing, we might fail or overwrite.
                                        // Let's safe fail.
                                        tui.log.error('❌ Missing target_content for modification.');
                                        executionResults += `[Action modify_file]: Failed. Missing target_content.\n\n`;
                                    }
                                }
                            }
                        } else {
                            tui.log.error('❌ Denied.');
                            executionResults += `[Action ${action.type}]: User Denied.\n\n`;
                        }
                    }
                }

                // Prepare next prompt
                if (executionResults) {
                    if (waitingForUser) {
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) { keepGoing = false; break; }
                        nextPrompt = `${executionResults}\n\nUser Reply: ${userReply}`;
                    } else {
                        // Auto-continue
                        nextPrompt = executionResults;
                        tui.log.info(colors.dim('Sending tool results to agent...'));
                    }
                } else if (waitingForUser) {
                    const userReply = await tui.text({ message: 'Your answer:' });
                    if (tui.isCancel(userReply)) { keepGoing = false; break; }
                    nextPrompt = userReply as string;
                } else {
                    // Fallback: If no actions but we have a message/summary, assume it's a talk
                    if (response.message) {
                        tui.log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(response.message);
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) {
                            keepGoing = false;
                        } else {
                            nextPrompt = userReply as string;
                        }
                    } else {
                        tui.log.warning('Agent took no actions.');
                        keepGoing = false;
                    }
                }

            } else {
                tui.log.warning('Invalid response from agent.');
                keepGoing = false;
            }

        } catch (e: any) {
            spinner.stop('Error');
            tui.log.error(e.message);
            FileLogger.log('DEV_AGENT', 'Main Loop Error', e);
            keepGoing = false;
        }
    }

    tui.outro('👋 Shark Dev Session Ended');
}

async function callDevAgentApi(prompt: string, onChunk: (chunk: string) => void): Promise<AgentResponse> {
    const realm = await getActiveRealm();
    const token = await tokenStorage.getToken(realm);
    if (!token) throw new Error('Not logged in. Run shark login.');

    const conversationId = await conversationManager.getConversationId(AGENT_TYPE);

    const payload = {
        user_prompt: prompt,
        streaming: true,
        use_conversation: true,
        conversation_id: conversationId,
        stackspot_knowledge: false // Dev Agent focuses on project context
    };

    const url = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${AGENT_ID}/chat`;
    let fullMsg = '';
    let raw: any = {};

    await sseClient.streamAgentResponse(url, payload, { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, {
        onChunk: (c) => { fullMsg += c; onChunk(c); },
        onComplete: (msg, metadata) => {
            const returnedId = metadata?.conversation_id;
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
