
import { STACKSPOT_AGENT_API_BASE } from '../api/stackspot-client.js';
import { sseClient } from '../api/sse-client.js';
import { parseAgentResponse, AgentResponse } from './agent-response-parser.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { FileLogger } from '../debug/file-logger.js';
import { handleListFiles, handleReadFile, handleSearchFile } from './agent-tools.js';
import fs from 'node:fs';
import path from 'node:path';

const AGENT_TYPE = 'scan_agent';
// We can reuse the Specification Agent ID or a new one. Using env var or default.
// Ideally, we'd have a specific ID for Scan Agent. For now, assume a placeholder or reuse.
const AGENT_ID = process.env.STACKSPOT_SCAN_AGENT_ID || '01KEQ9AHWB550J2244YBH3QATN'; // User provided Agent ID

/**
 * Scan Agent implementation.
 * It autonomously explores the project and generates project-context.md
 */
import { ConfigManager } from '../config-manager.js';

// ... (existing imports)

/**
 * Scan Agent implementation.
 * It autonomously explores the project and generates project-context.md
 */
export async function interactiveScanAgent(options: { output?: string, depth?: string } = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🕵️‍♂️  Scan Agent');

    const config = ConfigManager.getInstance().getConfig();
    const language = config.language || 'English';

    const projectRoot = process.cwd();
    // Use options.output if provided, otherwise default to _sharkrc/project-context.md
    // If output option is provided, resolve it.
    // If not, use _sharkrc directory (create if needed).

    let outputFile: string;

    if (options.output) {
        outputFile = path.resolve(process.cwd(), options.output);
    } else {
        const outputDir = path.resolve(projectRoot, '_sharkrc');
        if (!fs.existsSync(outputDir)) {
            // Check if _sharkrc exists as a file (common config file name), if so, error or warn?
            // User requested "pasta _sharkrc".
            const stat = fs.existsSync(outputDir) ? fs.statSync(outputDir) : null;
            if (stat && stat.isFile()) {
                tui.log.warning(`Warning: '_sharkrc' exists as a file. Using '_bmad/project-context' instead to avoid overwrite.`);
                const fallbackDir = path.resolve(projectRoot, '_bmad/project-context');
                if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
                outputFile = path.join(fallbackDir, 'project-context.md');
            } else {
                fs.mkdirSync(outputDir, { recursive: true });
                outputFile = path.join(outputDir, 'project-context.md');
            }
        } else {
            fs.mkdirSync(outputDir, { recursive: true });
            outputFile = path.join(outputDir, 'project-context.md');
        }
    }

    tui.log.info(`Scanning project at: ${colors.bold(projectRoot)}`);
    tui.log.info(`Output targeted at: ${colors.bold(outputFile)}`);
    tui.log.info(`Language: ${colors.bold(language)}`);

    const configFileRelative = path.relative(projectRoot, outputFile);

    // Construct the "Super Prompt"
    const superPrompt = `
You are the **Scan Agent**, an expert software architect and analyst.
Your mission is to explore this project's codebase and generate a comprehensive context file that will be used by other AI agents (specifically a Developer Agent) to understand how to work on this project.

**Goal**: Create a markdown file at: \`${configFileRelative}\`.

**LANGUAGE INSTRUCTION**:
You MUST write the content of the \`project-context.md\` file in **${language}**.
Also, strictly interact with tools using the appropriate payload.

**Instructions**:
1.  **Analyze Structure**: Use \`list_files\` to understand the root directory and key subdirectories (src, tools, config, etc.).
2.  **Identify Tech Stack**: Use \`read_file\` or \`search_file\` on key manifests (package.json, pom.xml, go.mod, Dockerfile, etc.) to determine languages, frameworks, and versions.
3.  **Map Architecture**: Infer the architectural pattern (Monolith? Microservices? Clean Architecture?) based on folder structure and key files.
4.  **Document Key Paths**: Identify where source code, tests, and configs live.

**Output Format** (Markdown):
The final action MUST be \`create_file\` (or \`modify_file\`) for the target file with the following structure:

# Project Context

## Overview
[Brief description of what this project seems to be]

## Tech Stack
- **Language**: [e.g. TypeScript]
- **Framework**: [e.g. React, Express, NestJS]
- **Build Tool**: [e.g. Vite, Webpack]
- **Database**: [e.g. PostgreSQL, Prisma] (if detected)

## Architecture
[Description of the folder structure and architectural patterns detected]

## Key Locations
- **Source**: [path/to/src]
- **Tests**: [path/to/tests]
- **Config**: [path/to/config]

## Commands
[List of discovered npm scripts or makefile commands for dev, build, test]

---

**Rules**:
- Do NOT guess. If you are unsure, check the file.
- Be concise.
- Focus on FACTS that a Developer Agent needs to know to write code correcty.
- Start by listing the root directory.
`.trim();

    await runScanLoop(superPrompt, outputFile);
}

// ... (rest of the file)

async function runScanLoop(initialPrompt: string, targetPath: string) {
    let nextPrompt = initialPrompt;
    let keepGoing = true;
    let stepCount = 0;
    const MAX_STEPS = 15; // Safety limit

    while (keepGoing && stepCount < MAX_STEPS) {
        stepCount++;
        const spinner = tui.spinner();
        spinner.start(`🕵️‍♂️  Scan Agent analyzing (Step ${stepCount}/${MAX_STEPS})...`);

        let responseText = '';
        let lastResponse: AgentResponse | null = null;

        try {
            // Call Agent
            lastResponse = await callScanAgentApi(nextPrompt, (chunk) => {
                responseText += chunk;
                // Optional: Update spinner message based on chunk if needed
            });

            spinner.stop('Step complete');

            // Handle Response Actions
            if (lastResponse && lastResponse.actions) {
                let executionResults = "";
                let fileCreated = false;

                for (const action of lastResponse.actions) {
                    if (action.type === 'list_files') {
                        tui.log.info(`📂 Scanning dir: ${colors.bold(action.path || '.')}`);
                        const result = handleListFiles(action.path || '.');
                        executionResults += `[Action list_files(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'read_file') {
                        tui.log.info(`📖 Reading file: ${colors.bold(action.path || '')}`);
                        const result = handleReadFile(action.path || '');
                        // Truncate if too long for context window? Agent Tools already limits size.
                        executionResults += `[Action read_file(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'search_file') {
                        tui.log.info(`🔍 Searching: ${colors.bold(action.path || '')}`);
                        const result = handleSearchFile(action.path || '');
                        executionResults += `[Action search_file(${action.path}) Result]:\n${result}\n\n`;
                    }
                    else if (action.type === 'create_file' || action.type === 'modify_file') {
                        // Check if this is our target file
                        // The agent might try to create other files, but we mainly care about the context file.
                        // We will allow it to create the target file automatically without prompt if it matches.

                        // For safety, let's just confirm. Or since this is "Scan", maybe we auto-accept?
                        // Let's auto-accept if it is the target file, confirm otherwise.
                        const resolvedActionPath = path.resolve(action.path || '');
                        const resolvedTargetPath = path.resolve(targetPath);
                        let isTarget = resolvedActionPath === resolvedTargetPath;

                        // Fallback: If agent uses wrong directory but correct filename "project-context.md", allow it and force correct path.
                        if (!isTarget && path.basename(action.path || '') === 'project-context.md') {
                            tui.log.warning(`Agent targeted '${action.path}' but we enforce '${path.relative(process.cwd(), targetPath)}'. Redirecting write.`);
                            isTarget = true;
                            // Update action path for logging consistency (optional, but good for clarity)
                            action.path = targetPath;
                        }

                        if (isTarget) {
                            // Enforce writing to the correct targetPath regardless of what agent said
                            const finalPath = targetPath;
                            if (action.type === 'create_file') {
                                fs.writeFileSync(finalPath, action.content || '');
                                tui.log.success(`✅ Generated Context: ${finalPath}`);
                                fileCreated = true;
                            } else {
                                // Modify
                                fs.writeFileSync(finalPath, action.content || ''); // Overwrite for now
                                tui.log.success(`✅ Updated Context: ${finalPath}`);
                                fileCreated = true;
                            }
                            executionResults += `[Action ${action.type}]: Success. Task Completed.\n`;
                        } else {
                            tui.log.warning(`Agent wants to write to unexpected file: ${action.path}`);
                            // Skip for now to avoid side effects during scan, or ask user?
                            // Let's just log it.
                            executionResults += `[Action ${action.type}]: Skipped (Scan Agent only writes context file)\n`;
                        }
                    }
                    else if (action.type === 'talk_with_user') {
                        tui.log.info(colors.primary('🤖 Scan Agent asks:'));
                        console.log(action.content);
                        // We don't really want to chat during auto-scan, but if it asks, we should probably answer or stop.
                        // For now, let's stop and ask user.
                        const reply = await tui.text({ message: 'Agent needs input:', placeholder: 'Reply...' });
                        executionResults += `[User Reply]: ${reply}\n`;
                    }
                }

                if (fileCreated) {
                    tui.log.success('✨ Scan completed successfully!');
                    keepGoing = false;
                } else {
                    // Feed results back
                    nextPrompt = executionResults;
                    FileLogger.log('SCAN', 'Auto-replying with results', { length: executionResults.length });
                }

            } else {
                // No actions?
                if (stepCount > 1) {
                    tui.log.warning('Scan Agent stopped without actions.');
                    keepGoing = false;
                } else {
                    // First turn and no actions? problematic.
                }
            }

        } catch (error: any) {
            spinner.stop('Error');
            tui.log.error(error.message);
            keepGoing = false;
        }
    }
}


async function callScanAgentApi(prompt: string, onChunk: (chunk: string) => void): Promise<AgentResponse> {
    const realm = await getActiveRealm();
    const token = await tokenStorage.getToken(realm);
    if (!token) throw new Error('Not logged in');

    // Generate a temporary conversation ID for this scan session
    // We might not need to persist it long-term, but we need one for the session.
    // Or we rely on the one returned.
    let conversationId = await conversationManager.getConversationId(AGENT_TYPE);

    // If no conversation exists, that's fine, API will create one.

    const payload = {
        user_prompt: prompt,
        streaming: true,
        stackspot_knowledge: false,
        return_ks_in_response: true,
        use_conversation: true,
        conversation_id: conversationId
    };

    const url = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${AGENT_ID}/chat`;
    let fullMsg = '';
    let raw: any = {};

    FileLogger.log('SCAN', 'Calling API', { promptLength: prompt.length });

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
