
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
import { t } from '../i18n/index.js';

const AGENT_TYPE = 'developer_agent';

// Helper to get effective Agent ID
function getAgentId(overrideId?: string): string {
    if (overrideId) return overrideId;

    // Check Config
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.dev) return config.agents.dev;

    // Check Env
    if (process.env.STACKSPOT_DEV_AGENT_ID) return process.env.STACKSPOT_DEV_AGENT_ID;

    // Default
    return '01KEQCGJ65YENRA4QBXVN1YFFX';
}

interface SpecState {
    status: 'MISSING' | 'PENDING' | 'COMPLETED';
    nextTask?: string;
    specContent?: string;
}

function analyzeSpecState(projectRoot: string): SpecState {
    const specPath = path.resolve(projectRoot, 'tech-spec.md');
    if (!fs.existsSync(specPath)) {
        return { status: 'MISSING' };
    }

    const content = fs.readFileSync(specPath, 'utf-8');
    // Regex for unchecked task: - [ ] Task description
    // Capture the line content - simple regex, can be improved for nested lists if needed
    const match = content.match(/- \[ \] (.*)/);

    if (match) {
        return { status: 'PENDING', nextTask: match[1].trim(), specContent: content };
    }

    return { status: 'COMPLETED', specContent: content };
}

function buildSystemPrompt(state: SpecState, contextContent: string, additionalInstructions: string = ''): string {
    let basePrompt = ``;

    if (contextContent) {
        basePrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
    }

    if (state.status === 'MISSING') {
        basePrompt += `\n\n🚨 CRITICAL: NO 'tech-spec.md' FOUND.\n
Your FIRST priority is to analyze the user request and CREATE a 'tech-spec.md' file.

⚠️ WORKFLOW:
1. **Understand**: Clarify the goal with the user if needed.
2. **Explore**: Use 'list_files'/'read_file' to find RELEVANT files for this specific task.
3. **Specify**: Create 'tech-spec.md' referencing REAL file paths you found.

DO NOT create a spec based on guesses. Verify file existence before writing the plan.

Structure for 'tech-spec.md':
\`\`\`markdown
# Technical Spec: [Title]

## Goal
[Brief description]

## Implementation Plan
- [ ] Step 1: [Description]
- [ ] Step 2: [Description]
...
\`\`\`
User Request: "${additionalInstructions}"
`;
    } else if (state.status === 'PENDING') {
        basePrompt += `\n\n🟢 EXECUTION MODE\n
Use 'tech-spec.md' as your source of truth.
\n👉 **CURRENT TASK**: "${state.nextTask}"
\n
Focus ONLY on this task. Do not jump ahead.
1. Implement the necessary changes.
2. Verify (compile/test).
3. **MANDATORY**: Use 'modify_file' to mark this task as '[x]' in 'tech-spec.md' when done.
`;
    } else {
        basePrompt += `\n\n✨ ALL TASKS COMPLETED according to 'tech-spec.md'.\n
Ask the user if they want to add more tasks or finish the session.
`;
    }

    return basePrompt;
}

export async function interactiveDeveloperAgent(options: { task?: string, context?: string } = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🦈 Shark Dev Agent (Spec-Driven)');

    const agentId = getAgentId();

    if (agentId === 'PENDING_CONFIGURATION') {
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

    // 2. Initial Spec Analysis
    let specState = analyzeSpecState(projectRoot);
    let nextPrompt = buildSystemPrompt(specState, contextContent, options.task || "Start working.");

    // 3. Main Loop
    let keepGoing = true;
    const spinner = tui.spinner();
    let stepCount = 0;

    while (keepGoing) {
        stepCount++;
        try {
            // Re-analyze prompt based on NEW state (if changed by previous turn)
            // But we append the result of the previous tool execution to the prompt loop
            // So we need to mix 'System Instructions' with 'Tool Outputs'.

            // Note: In a chat API, we send the history or the 'next message'.
            // StackSpot Agent API (Stateful) handles history. We just send the "User Input".
            // However, to enforce the Spec-Driven behavior, we can "System Inject" instructions
            // by pre-pending them to the user prompt if we are using a fresh turn,
            // OR we rely on the Agent Persona to respect the Plan.
            // Our strategy: Inject "Current Task" reminders in EVERY turn if possible or rely on the initial big prompt.
            // Let's rely on the Agent Persona + Tool Feedback loop.

            // Display Current State in TUI
            if (specState.status === 'PENDING') {
                tui.log.info(colors.bold(`🎯 DOING: ${specState.nextTask}`));
            } else if (specState.status === 'MISSING') {
                tui.log.info(colors.warning(`📋 PLANNING: Creating tech-spec.md`));
            }

            spinner.start('Waiting for Shark Dev...');

            // Call API
            let lastResponse: AgentResponse | null = null;
            await callDevAgentApi(nextPrompt, (chunk) => {
                // Optional: Stream text
            }).then(resp => {
                lastResponse = resp;
            });

            spinner.stop('Response received');

            if (lastResponse && (lastResponse as AgentResponse).actions) {
                const response = lastResponse as AgentResponse;
                let executionResults = "";
                let waitingForUser = false;
                let specUpdated = false;

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

                        let approved = false;
                        if (autoApprovals.commands) {
                            approved = true;
                            tui.log.success(`⚡ Auto-Approved Command: ${cmd}`);
                        } else {
                            const choice = await tui.select({
                                message: `Execute: ${cmd}?`,
                                options: [
                                    { value: 'yes', label: 'Yes (Execute once)' },
                                    { value: 'always', label: 'Yes (Output & Auto-Approve Commands for Session)' },
                                    { value: 'no', label: 'No (Skip)' }
                                ]
                            });

                            if (choice === 'always') {
                                autoApprovals.commands = true;
                                approved = true;
                                tui.log.success('⚡ COMMANDS Auto-Approval ENABLED for this session.');
                            } else if (choice === 'yes') {
                                approved = true;
                            }
                        }

                        if (approved) {
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

                        // Preview
                        if (action.content) {
                            const preview = action.content.length > 500
                                ? action.content.substring(0, 500) + '... (truncated)'
                                : action.content;
                            console.log(colors.dim('--- Content ---\n') + preview + '\n' + colors.dim('---------------'));
                        }

                        let approved = false;

                        if (autoApprovals.files) {
                            approved = true;
                            tui.log.success(`⚡ Auto-Approved File Action: ${filePath}`);
                        } else {
                            const choice = await tui.select({
                                message: `Approve changes to ${filePath}?`,
                                options: [
                                    { value: 'yes', label: 'Yes (Approve once)' },
                                    { value: 'always', label: 'Yes (Approve & Auto-Approve FILES for Session)' },
                                    { value: 'no', label: 'No (Skip)' }
                                ]
                            });

                            if (choice === 'always') {
                                autoApprovals.files = true;
                                approved = true;
                                tui.log.success('⚡ FILE ACTIONS Auto-Approval ENABLED for this session.');
                            } else if (choice === 'yes') {
                                approved = true;
                            }
                        }

                        if (approved) {
                            if (filePath) {
                                const targetPath = path.resolve(projectRoot, filePath);
                                const dir = path.dirname(targetPath);
                                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                                if (isCreate) {
                                    const BOM = '\uFEFF';
                                    const contentToWrite = action.content || '';
                                    const finalContent = contentToWrite.startsWith(BOM) ? contentToWrite : BOM + contentToWrite;
                                    fs.writeFileSync(targetPath, finalContent, { encoding: 'utf-8' });
                                    tui.log.success(`✅ Created: ${filePath}`);
                                    executionResults += `[Action create_file(${filePath})]: Success\n\n`;
                                    if (filePath.endsWith('tech-spec.md')) specUpdated = true;
                                } else {
                                    // Modify
                                    if (action.target_content) {
                                        const success = startSmartReplace(filePath, action.content || '', action.target_content, tui);
                                        if (success) {
                                            executionResults += `[Action modify_file(${filePath})]: Success\n\n`;
                                            if (filePath.endsWith('tech-spec.md')) specUpdated = true;
                                        } else {
                                            executionResults += `[Action modify_file(${filePath})]: FAILED. Target content not found or ambiguous. Read the file again to ensure accuracy.\n\n`;
                                        }
                                    } else {
                                        tui.log.error('❌ Missing target_content for modification.');
                                        executionResults += `[Action modify_file]: Failed. Missing target_content. PRESERVE context and use 'target_content' to specify what to replace.\n\n`;
                                    }
                                }
                            }
                        } else {
                            tui.log.error('❌ Denied.');
                            executionResults += `[Action ${action.type}]: User Denied.\n\n`;
                        }
                    }
                }

                // 4. Update Knowledge & Prepare Next Prompt
                const previousState = specState;
                specState = analyzeSpecState(projectRoot); // Refresh state

                let systemInjection = "";

                if (executionResults) {
                    // Check if state changed (task completed)
                    if (previousState.status === 'PENDING' && specState.status === 'PENDING' && previousState.nextTask !== specState.nextTask) {
                        systemInjection = `\n🎉 Task "${previousState.nextTask}" COMPLETED! Next up: "${specState.nextTask}".\n`;
                    } else if (previousState.status === 'PENDING' && specState.status === 'PENDING' && previousState.nextTask === specState.nextTask) {
                        // Still on same task
                        // If spec wasn't updated, remind them
                        if (!specUpdated && stepCount % 3 === 0) {
                            systemInjection = `\nReminder: You are still working on "${specState.nextTask}". Don't forget to mark it [x] in 'tech-spec.md' when done.\n`;
                        }
                    } else if (previousState.status === 'MISSING' && specState.status === 'PENDING') {
                        systemInjection = `\n✅ Spec Created! Starting execution of: "${specState.nextTask}".\n`;
                    }

                    // Prompt construction
                    if (waitingForUser) {
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) { keepGoing = false; break; }
                        nextPrompt = `${executionResults}${systemInjection}\nUser Reply: ${userReply}`;
                    } else {
                        // Auto-pilot
                        nextPrompt = `${executionResults}${systemInjection}\n[System]: Continue.`;
                        tui.log.info(colors.dim('Processing results...'));
                    }

                } else if (waitingForUser) {
                    const userReply = await tui.text({ message: 'Your answer:' });
                    if (tui.isCancel(userReply)) { keepGoing = false; break; }
                    nextPrompt = userReply as string;
                } else {
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
                        tui.log.warning('Agent took no actions and sent no message.');
                        nextPrompt = "Please proceed or ask for clarification.";
                    }
                }

            } else {
                tui.log.warning('Invalid response from agent (no actions).');
                // Could act as a retry logic here
                nextPrompt = "Error: No valid actions returned. Please try again with JSON format.";
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
        stackspot_knowledge: false
    };

    const url = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${getAgentId()}/chat`;
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
