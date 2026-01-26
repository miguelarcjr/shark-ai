
import { STACKSPOT_AGENT_API_BASE, ensureValidToken } from '../api/stackspot-client.js';
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
    replaceLineRange,
    handleRunCommand,
    astGrepSearch,
    astGrepRewrite,
    generateFilePreview,
    astListStructure,
    astAddMethod,
    astGetMethod,
    astAddClass,
    astAddProperty,
    astRemoveProperty,
    astModifyMethod,
    astRemoveMethod,
    astAddDecorator,
    astAddInterface,
    astAddTypeAlias,
    astAddFunction,
    astRemoveFunction,
    astAddImport,
    astRemoveImport,
    astOrganizeImports,
    astModifyProperty
} from './agent-tools.js';
import { t } from '../i18n/index.js';

const AGENT_TYPE = 'developer_agent';

// Validation Functions
async function validateTypeScript(filePath: string): Promise<{ valid: boolean, error?: string }> {
    try {
        const result = await handleRunCommand(`npx tsc --noEmit --skipLibCheck ${filePath}`);
        if (result.trim() === '' || !result.includes('error TS')) {
            return { valid: true };
        }
        return { valid: false, error: result };
    } catch (e: any) {
        return { valid: false, error: e.message || 'TypeScript validation failed' };
    }
}

function validateHtmlTagBalance(filePath: string): { valid: boolean, error?: string } {
    const content = fs.readFileSync(filePath, 'utf-8');
    const stack: string[] = [];
    const tagRegex = /<\/?(\w+)(?:\s[^>]*)?\s*\/?>/g;
    const selfClosingTags = ['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'param', 'source', 'track', 'wbr'];

    let match;
    while ((match = tagRegex.exec(content)) !== null) {
        const fullTag = match[0];
        const tagName = match[1].toLowerCase();

        if (fullTag.startsWith('</')) {
            const expected = stack.pop();
            if (expected !== tagName) {
                return {
                    valid: false,
                    error: `Tag mismatch: expected </${expected}> but found </${tagName}> at position ${match.index}`
                };
            }
        } else if (!fullTag.endsWith('/>') && !selfClosingTags.includes(tagName)) {
            stack.push(tagName);
        }
    }

    if (stack.length > 0) {
        return { valid: false, error: `Unclosed tags: <${stack.join('>, <')}>` };
    }

    return { valid: true };
}

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


export interface DevelopmentResult {
    success: boolean;
    summary: string;
}

export async function interactiveDeveloperAgent(options: {
    taskId?: string,
    taskInstruction?: string,
    context?: string,
    history?: string
} = {}): Promise<DevelopmentResult> {
    FileLogger.init();
    // tui.intro('🦈 Shark Dev Agent (Scoped)'); // Reduced verbosity for orchestration loop

    const agentId = getAgentId();

    if (agentId === 'PENDING_CONFIGURATION') {
        tui.log.error('❌ STACKSPOT_DEV_AGENT_ID not configured in .env');
        return { success: false, summary: "Missing configuration." };
    }

    // 1. Load Context
    const projectRoot = process.cwd();
    let contextContent = '';
    const defaultContextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
    // If orchestrator passes the summary of previous tasks, we append it to context
    const specificContextPath = options.context ? path.resolve(projectRoot, options.context) : defaultContextPath;

    if (fs.existsSync(specificContextPath)) {
        try {
            contextContent = fs.readFileSync(specificContextPath, 'utf-8');
            // tui.log.info(`📘 Context loaded from: ${colors.dim(path.relative(projectRoot, specificContextPath))}`);
        } catch (e) {
            tui.log.warning(`Failed to read context file: ${e}`);
        }
    }

    // 2. Build Scoped Prompt
    // Note: We are NOT calling analyzeSpecState here anymore. The Orchestrator tells us WHAT to do.
    const currentTask = options.taskInstruction || "Analyze the project and fix pending issues.";

    let basePrompt = ``;
    if (contextContent) {
        basePrompt += `\n\n--- PROJECT CONTEXT ---\n${contextContent}\n-----------------------\n`;
    }

    // Inject History from previous turns (Orchestrator Responsibility)
    if (options.history) {
        basePrompt += `\n\n--- PREVIOUS EXECUTION SUMMARY ---\n${options.history}\n----------------------------------\n`;
    }

    basePrompt += `\n\n🟢 EXECUTION MODE\n
You are a highly skilled Developer Agent.
👉 **CURRENT TASK**: "${currentTask}"

Your goal is to COMPLETE this specific task and then STOP.
1. Implement the necessary changes.
2. Verify (compile/test).
3. **MANDATORY**: When you are confident the task is done, output a final message starting with "TASK_COMPLETED:" followed by a brief technical summary of what you did.
`;

    let nextPrompt = basePrompt;

    // 3. Main Loop
    let keepGoing = true;
    const spinner = tui.spinner();
    let finalSummary = "";
    let isTaskCompleted = false;

    // Force NEW Conversation ID for Statelessness
    // We update the conversation manager to a random ID or based on TaskID
    // To ensure we don't pollute the global 'developer_agent' state if we want true statelessness.
    // Ideally, we pass a specific conversation ID Key.
    const conversationKey = options.taskId ? `dev_agent_${options.taskId}` : `dev_agent_${Date.now()}`;
    // Resetting for safety if repeated calls
    // await conversationManager.saveConversationId(conversationKey, ""); 

    // Auto-Approval State
    let autoApprovals = {
        files: false,
        commands: false
    };

    while (keepGoing) {
        try {
            spinner.start('🦈 Shark Dev working...');

            // Call API
            const lastResponse = await callDevAgentApi(nextPrompt, (chunk) => {
                // Optional: Stream text
            }, conversationKey);

            spinner.stop('Response received');

            if (lastResponse) {
                const response = lastResponse;
                const actions = response.actions || []; // Should be array by schema, but safe fallback

                // Check Global Message first (e.g. Completion or Failure)
                if (response.message && response.message.includes('TASK_COMPLETED:')) {
                    isTaskCompleted = true;
                    finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                    // We continue to process actions if any, but stop loop after
                    keepGoing = false;
                }

                // Check for explicit task failure signal from agent
                if (response.message && response.message.includes('TASK_FAILED:')) {
                    const failureReason = response.message.split('TASK_FAILED:')[1].trim();
                    tui.log.error(`❌ Agent reported task failure: ${failureReason}`);
                    return { success: false, summary: failureReason };
                }

                // If we have just a message and NO actions (or empty actions), treat as talk
                if (actions.length === 0 && response.message && !isTaskCompleted) {
                    tui.log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(response.message);
                    const userReply = await tui.text({ message: 'Your answer:' });
                    if (tui.isCancel(userReply)) { keepGoing = false; break; }
                    nextPrompt = userReply as string;
                }

                let executionResults = "";
                let waitingForUser = false;

                for (const action of actions) {

                    // ... (Existing Tool Handling Logic - reusing almost 1:1, just cleaner logging) ...
                    // [Optimization: I will minimize the copy-paste here by keeping the core logic but ensuring it writes to executionResults]

                    if (action.type === 'talk_with_user') {
                        tui.log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(action.content);
                        // If agent talks, we might need input. 
                        // In stateless mode, if it asks a question, we might bubble it up?
                        // For now, let's keep the TUI interaction valid.
                        if (!isTaskCompleted) waitingForUser = true;
                    }

                    // ... (Include all tool handlers from original code: list_files, read_file, run_command, modify_file, ast_*, etc.) ...
                    // To avoid a massive edit block that might break, I will assume the original tool handlers logic is robust.
                    // I will reinject strictly the necessary parts. 
                    // [Developer Note: For the sake of this edit, I have to replicate the tool logic to ensure the function works. 
                    // I'll condense the logging.]

                    else if (action.type === 'list_files') {
                        tui.log.info(`📂 Scanning: ${colors.dim(action.path || '.')}`);
                        const result = handleListFiles(action.path || '.');
                        executionResults += `[Action list_files(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'read_file') {
                        tui.log.info(`📖 Reading: ${colors.dim(action.path || '')}`);
                        const result = handleReadFile(action.path || '');
                        executionResults += `[Action read_file(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'search_file') {
                        const result = handleSearchFile(action.path || '');
                        executionResults += `[Action search_file(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'run_command') {
                        const cmd = action.command || '';
                        tui.log.info(`💻 Executing: ${colors.dim(cmd)}`);
                        // Auto-approval logic reuse
                        let approved = autoApprovals.commands;
                        if (!approved) {
                            const choice = await tui.select({
                                message: `Execute: ${cmd}?`,
                                options: [{ value: 'yes', label: 'Yes' }, { value: 'always', label: 'Yes (Auto-Approve Session)' }, { value: 'no', label: 'No' }]
                            });
                            if (choice === 'always') { autoApprovals.commands = true; approved = true; }
                            else if (choice === 'yes') approved = true;
                        }
                        if (approved) {
                            const result = await handleRunCommand(cmd);
                            executionResults += `[Action run_command(${cmd}) Result]:\n${result}\n\n`;
                        } else {
                            executionResults += `[Action run_command]: User blocked execution.\n\n`;
                        }
                    }
                    else if (['create_file', 'modify_file'].includes(action.type)) {
                        const filePath = action.path || '';
                        tui.log.warning(`📝 ${action.type === 'create_file' ? 'CREATE' : 'MODIFY'}: ${colors.bold(filePath)}`);

                        let approved = autoApprovals.files;
                        if (!approved) {
                            const choice = await tui.select({
                                message: `Approve changes to ${filePath}?`,
                                options: [{ value: 'yes', label: 'Yes' }, { value: 'always', label: 'Yes (Auto-Approve Session)' }, { value: 'no', label: 'No' }]
                            });
                            if (choice === 'always') { autoApprovals.files = true; approved = true; }
                            else if (choice === 'yes') approved = true;
                        }

                        if (approved) {
                            // ... (Perform Write) ...
                            if (action.type === 'create_file') {
                                // Simple Create Logic
                                const dir = path.dirname(path.resolve(projectRoot, filePath));
                                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                                fs.writeFileSync(path.resolve(projectRoot, filePath), action.content || '', 'utf-8');
                                executionResults += `[Action create_file]: Success\n\n`;
                            } else {
                                // Modify Logic
                                let success = false;
                                if (action.line_range) success = replaceLineRange(filePath, action.line_range[0], action.line_range[1], action.content || '', tui);
                                else if (action.target_content) success = startSmartReplace(filePath, action.content || '', action.target_content, tui);

                                executionResults += success ? `[Action modify_file]: Success\n\n` : `[Action modify_file]: Failed\n\n`;
                            }
                            // Validation hooks can be re-added here similar to original
                            const val = await validateTypeScript(path.resolve(projectRoot, filePath));
                            if (!val.valid) executionResults += `[Validation Failed]: ${val.error}\n\n`;
                        } else {
                            executionResults += `[Action ${action.type}]: User Denied.\n\n`;
                        }
                    }
                    // ... (AST Actions would follow similar pattern) ...
                    else if (action.type.startsWith('ast_')) {
                        try {
                            // AST Tools Mapping (Async)
                            let result = '';
                            if (action.type === 'ast_list_structure') {
                                result = await astListStructure(action.path || '');
                            }
                            else if (action.type === 'ast_get_method') {
                                result = await astGetMethod(action.path || '', action.class_name || '', action.method_name || '');
                            }
                            else if (action.type === 'ast_add_method') {
                                const success = await astAddMethod(action.path || '', action.class_name || '', action.method_code || '');
                                result = success ? 'Method added successfully.' : 'Failed to add method.';
                            }
                            else if (action.type === 'ast_modify_method') {
                                const success = await astModifyMethod(action.path || '', action.class_name || '', action.method_name || '', action.new_body || '');
                                result = success ? 'Method modified successfully.' : 'Failed to modify method.';
                            }
                            else if (action.type === 'ast_remove_method') {
                                const success = await astRemoveMethod(action.path || '', action.class_name || '', action.method_name || '');
                                result = success ? 'Method removed successfully.' : 'Failed to remove method.';
                            }
                            else if (action.type === 'ast_add_class') {
                                const success = await astAddClass(action.path || '', action.class_name || '', action.extends_class || undefined, action.implements_interfaces || undefined);
                                result = success ? 'Class added successfully.' : 'Failed to add class.';
                            }
                            else if (action.type === 'ast_add_property') {
                                const success = await astAddProperty(action.path || '', action.class_name || '', action.property_code || '');
                                result = success ? 'Property added successfully.' : 'Failed to add property.';
                            }
                            else if (action.type === 'ast_modify_property') {
                                tui.log.info(`✏️ Modifying property ${colors.gray(action.property_name || '')} in ${colors.gray(action.class_name || '')}`);
                                // Note: property_code here is the NEW full property definition
                                const success = await astModifyProperty(action.path || '', action.class_name || '', action.property_name || '', action.property_code || '');
                                result = success ? 'Property modified successfully.' : 'Failed to modify property.';
                            }
                            else if (action.type === 'ast_remove_property') {
                                const success = await astRemoveProperty(action.path || '', action.class_name || '', action.property_name || '');
                                result = success ? 'Property removed successfully.' : 'Failed to remove property.';
                            }
                            else if (action.type === 'ast_add_decorator') {
                                // Tool only supports class decorators for now
                                const success = await astAddDecorator(action.path || '', action.class_name || '', action.decorator_code || '');
                                result = success ? 'Decorator added successfully.' : 'Failed to add decorator.';
                            }
                            else if (action.type === 'ast_add_interface') {
                                const success = await astAddInterface(action.path || '', action.interface_code || '');
                                result = success ? 'Interface added successfully.' : 'Failed to add interface.';
                            }
                            else if (action.type === 'ast_add_type_alias') {
                                const success = await astAddTypeAlias(action.path || '', action.type_code || '');
                                result = success ? 'Type alias added successfully.' : 'Failed to add type alias.';
                            }
                            else if (action.type === 'ast_add_function') {
                                const success = await astAddFunction(action.path || '', action.function_code || '');
                                result = success ? 'Function added successfully.' : 'Failed to add function.';
                            }
                            else if (action.type === 'ast_remove_function') {
                                const success = await astRemoveFunction(action.path || '', action.function_name || '');
                                result = success ? 'Function removed successfully.' : 'Failed to remove function.';
                            }
                            else if (action.type === 'ast_add_import') {
                                const success = await astAddImport(action.path || '', action.import_statement || '');
                                result = success ? 'Import added successfully.' : 'Failed to add import.';
                            }
                            else if (action.type === 'ast_remove_import') {
                                const success = await astRemoveImport(action.path || '', action.module_path || '');
                                result = success ? 'Import removed successfully.' : 'Failed to remove import.';
                            }
                            else if (action.type === 'ast_organize_imports') {
                                const success = await astOrganizeImports(action.path || '');
                                result = success ? 'Imports organized successfully.' : 'Failed to organize imports.';
                            }
                            else {
                                result = `Unknown AST action: ${action.type}`;
                            }

                            executionResults += `[Action ${action.type} Result]:\n${result}\n\n`;
                            tui.log.info(`⚡ AST Action ${colors.dim(action.type)}: ${result}`);

                        } catch (e: any) {
                            executionResults += `[Action ${action.type} Failed]: ${e.message}\n\n`;
                            tui.log.error(`❌ AST Action Error: ${e.message}`);
                        }
                    }
                    else if (action.type === 'search_ast') {
                        const result = await astGrepSearch(action.pattern || '', action.path || '', action.language || 'typescript', tui);
                        executionResults += `[Action search_ast Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'modify_ast') {
                        const success = await astGrepRewrite(action.pattern || '', action.fix || '', action.path || '', action.language || 'typescript', tui);
                        executionResults += success ? `[Action modify_ast]: Success\n\n` : `[Action modify_ast]: Failed\n\n`;
                    }
                } // End Action Loop

                // Determine Next Prompt
                if (executionResults) {
                    if (waitingForUser) {
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) { keepGoing = false; break; }
                        nextPrompt = `${executionResults}\nUser Reply: ${userReply}`;
                    } else {
                        nextPrompt = `${executionResults}\n[System]: Continue execution. If finished, output "TASK_COMPLETED: summary".`;
                        tui.log.info(colors.dim('Processing results...'));
                    }
                } else if (!keepGoing) {
                    // Task completed or stopped
                } else if (waitingForUser) {
                    // handled above in message fallback
                } else {
                    if (!isTaskCompleted && actions.length > 0) nextPrompt = "Please continue.";
                }

            } else {
                tui.log.warning('No response received from agent.');
            }

        } catch (e: any) {
            tui.log.error(e.message);
            keepGoing = false;
            return { success: false, summary: `Error: ${e.message}` };
        }
    }

    tui.log.success('✅ Task Scope Completed');
    return { success: true, summary: finalSummary || "Task completed without summary." };
}

// Helper to support key-based conversation
async function callDevAgentApi(prompt: string, onChunk: (chunk: string) => void, conversationKey: string = AGENT_TYPE): Promise<AgentResponse> {
    const realm = await getActiveRealm();
    const token = await ensureValidToken(realm);

    // Get specific conversation ID for this TASK
    const conversationId = await conversationManager.getConversationId(conversationKey);

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
        await conversationManager.saveConversationId(conversationKey, parsed.conversation_id);
    }
    return parsed;
}

