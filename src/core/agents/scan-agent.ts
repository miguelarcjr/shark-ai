
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

import { ConfigManager } from '../config-manager.js';
import { t } from '../i18n/index.js';

const AGENT_TYPE = 'scan_agent';

function getAgentId(): string {
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.scan) return config.agents.scan;
    return process.env.STACKSPOT_SCAN_AGENT_ID || '01KEQ9AHWB550J2244YBH3QATN';
}

/**
 * Scan Agent implementation.
 * It autonomously explores the project and generates project-context.md
 */
export async function interactiveScanAgent(options: { output?: string, depth?: string } = {}): Promise<void> {
    FileLogger.init();
    const config = ConfigManager.getInstance().getConfig();
    const language = config.language || 'English';

    tui.intro(t('commands.scan.intro'));

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

    tui.log.info(`${t('commands.scan.scanningProject')} ${colors.bold(projectRoot)}`);
    tui.log.info(`${t('commands.scan.outputTarget')} ${colors.bold(outputFile)}`);
    tui.log.info(`${t('commands.scan.language')} ${colors.bold(language)}`);

    const configFileRelative = path.relative(projectRoot, outputFile);

    // Create template file automatically before starting scan
    const initialTemplate = `# Project Context

## Overview
[TO BE ANALYZED]

## Tech Stack
[TO BE ANALYZED]

## Architecture
[TO BE ANALYZED]

## Directory Structure
[TO BE ANALYZED]

## Key Components
[TO BE ANALYZED]

## API / Interfaces
[TO BE ANALYZED]

## Data Layer
[TO BE ANALYZED]

## Configuration & Environment
[TO BE ANALYZED]

## Build & Development
[TO BE ANALYZED]

## Key Patterns & Conventions
[TO BE ANALYZED]
`;

    // Create the template file immediately
    if (!fs.existsSync(outputFile)) {
        fs.writeFileSync(outputFile, initialTemplate, { encoding: 'utf-8' });
        tui.log.success(`${t('commands.scan.templateCreated')} ${outputFile}`);
    } else {
        tui.log.info(t('commands.scan.fileExists'));
    }

    // Construct the "Super Prompt"
    const superPrompt = `
You are the **Scan Agent**, an expert software architect and analyst.
Your mission is to explore this project's codebase THOROUGHLY and generate a COMPREHENSIVE context file that will be used by other AI agents (specifically a Developer Agent) to understand how to work on this project.

**IMPORTANT**: The file \`${configFileRelative}\` has already been created with a template structure. Your job is to FILL IN each section by analyzing the project.

**LANGUAGE INSTRUCTION**:
You MUST write the content in **${language}**.

**CRITICAL STRATEGY - INCREMENTAL UPDATES**:
DO NOT try to rewrite the entire file at once! Instead:

1. **Explore** the project using \`list_files\`, \`read_file\`, \`search_file\`
2. **Update** specific sections incrementally using \`modify_file\`
3. **Benefit**: Build a MUCH MORE DETAILED document without context size limitations

**WORKFLOW - FILL EACH SECTION:**

**Step 1 - Analyze Tech Stack:**
- \`list_files\` root directory to see project structure
- \`read_file\` package.json (or pom.xml, go.mod, requirements.txt, etc.)
- \`modify_file\` to replace:
  - \`target_content\`: "## Tech Stack\\n[TO BE ANALYZED]"
  - \`content\`: Detailed tech stack with versions, dependencies, and their purposes

**Step 2 - Analyze Directory Structure:**
- \`list_files\` on ALL key directories (src, tests, config, docs, etc.)
- Map the complete directory tree
- \`modify_file\` to replace:
  - \`target_content\`: "## Directory Structure\\n[TO BE ANALYZED]"
  - \`content\`: Visual directory tree with purpose of each folder

**Step 3 - Analyze Architecture:**
- \`read_file\` entry points (main.ts, index.js, app.py, etc.)
- \`read_file\` 5-10 source files to understand code patterns and organization
- Identify architectural pattern (Clean Arch, MVC, Microservices, etc.)
- \`modify_file\` to replace:
  - \`target_content\`: "## Architecture\\n[TO BE ANALYZED]"
  - \`content\`: Comprehensive architectural description with patterns and module organization

**Step 4 - Document Components:**
- Identify ALL major modules/components by reading source files
- For each component: location, purpose, key files
- \`modify_file\` to replace:
  - \`target_content\`: "## Key Components\\n[TO BE ANALYZED]"
  - \`content\`: Detailed list of components with their purposes

**Step 5 - Document APIs (if applicable):**
- Search for route definitions, controllers, API endpoints
- Document base URL, main endpoints, request/response patterns
- \`modify_file\` to replace:
  - \`target_content\`: "## API / Interfaces\\n[TO BE ANALYZED]"
  - \`content\`: API documentation (or "Not applicable" if no API)

**Step 6 - Document Data Layer (if applicable):**
- Search for database configs, ORM setup, model definitions
- Document database type, ORM tool, key entities/tables
- \`modify_file\` to replace:
  - \`target_content\`: "## Data Layer\\n[TO BE ANALYZED]"
  - \`content\`: Data layer details (or "Not applicable" if no database)

**Step 7 - Configuration & Environment:**
- Read config files (.env.example, config/, etc.)
- Identify environment variables and their purposes
- \`modify_file\` to replace:
  - \`target_content\`: "## Configuration & Environment\\n[TO BE ANALYZED]"
  - \`content\`: List of env vars and config files

**Step 8 - Build & Development:**
- Read package.json scripts, Makefile, build configs
- Document dev, build, test, lint commands
- \`modify_file\` to replace:
  - \`target_content\`: "## Build & Development\\n[TO BE ANALYZED]"
  - \`content\`: Commands for development workflow

**Step 9 - Patterns & Conventions:**
- Based on files read, document naming conventions, code organization
- Note error handling, logging strategies
- \`modify_file\` to replace:
  - \`target_content\`: "## Key Patterns & Conventions\\n[TO BE ANALYZED]"
  - \`content\`: Observed patterns and conventions

**Step 10 - Overview (LAST):**
- Synthesize all findings into a comprehensive overview
- \`modify_file\` to replace:
  - \`target_content\`: "## Overview\\n[TO BE ANALYZED]"
  - \`content\`: Detailed project description with purpose and main functionality

**HOW TO USE modify_file:**
\`\`\`json
{
  "actions": [{
    "type": "modify_file",
    "path": "${configFileRelative}",
    "target_content": "## Tech Stack\\n[TO BE ANALYZED]",
    "content": "## Tech Stack\\n- **Language**: TypeScript 5.3\\n- **Runtime**: Node.js 20.x\\n..."
  }]
}
\`\`\`

\`\`\`markdown
# Project Context

## Overview
[TO BE ANALYZED]

## Tech Stack
[TO BE ANALYZED]

## Architecture
[TO BE ANALYZED]

## Directory Structure
[TO BE ANALYZED]

## Key Components
[TO BE ANALYZED]

## API / Interfaces
[TO BE ANALYZED]

## Data Layer
[TO BE ANALYZED]

## Configuration & Environment
[TO BE ANALYZED]

## Build & Development
[TO BE ANALYZED]

## Key Patterns & Conventions
[TO BE ANALYZED]
\`\`\`

**Step 2 - Explore and Update Incrementally:**
After creating the template, perform these analyses and UPDATE each section:

**2.1 - Analyze Tech Stack:**
- \`list_files\` root directory
- \`read_file\` package.json (or equivalent manifest)
- \`modify_file\` to replace "## Tech Stack\\n[TO BE ANALYZED]" with detailed findings

**2.2 - Analyze Directory Structure:**
- \`list_files\` on key directories (src, tests, config, etc.)
- \`modify_file\` to replace "## Directory Structure\\n[TO BE ANALYZED]" with complete structure

**2.3 - Analyze Architecture:**
- \`read_file\` entry points (main.ts, index.js, etc.)
- \`read_file\` 5-10 source files to understand patterns
- \`modify_file\` to replace "## Architecture\\n[TO BE ANALYZED]" with architectural insights

**2.4 - Document Components:**
- Identify major modules/components
- \`modify_file\` to replace "## Key Components\\n[TO BE ANALYZED]" with component details

**2.5 - Document APIs (if applicable):**
- Search for route definitions, controllers, API endpoints
- \`modify_file\` to replace "## API / Interfaces\\n[TO BE ANALYZED]"

**2.6 - Document Data Layer (if applicable):**
- Search for database configs, ORM, models
- \`modify_file\` to replace "## Data Layer\\n[TO BE ANALYZED]"

**2.7 - Final Touches:**
- Update remaining sections (Config, Build, Patterns)
- Ensure Overview is comprehensive

**HOW TO USE modify_file:**
\`\`\`json
{
  "actions": [{
    "type": "modify_file",
    "path": "${configFileRelative}",
    "target_content": "## Tech Stack\\n[TO BE ANALYZED]",
    "content": "## Tech Stack\\n- **Language**: TypeScript 5.3\\n- **Runtime**: Node.js 20.x\\n- **Framework**: Express 4.18\\n..."
  }]
}
\`\`\`

**SECTION TEMPLATES (For your updates):**

**Tech Stack:**
\`\`\`markdown
## Tech Stack
- **Language**: [name + version]
- **Runtime**: [name + version]
- **Framework**: [name + version]
- **Build Tool**: [name]
- **Testing**: [framework]
- **Key Dependencies**:
  - [dep-name]: [purpose]
  - [dep-name]: [purpose]
\`\`\`

**Architecture:**
\`\`\`markdown
## Architecture
[Comprehensive description]
- **Pattern**: [Clean Arch, MVC, etc.]
- **Module Organization**: [how modules are structured]
- **Layer Separation**: [controllers, services, repos]
- **Configuration**: [how config is managed]
\`\`\`

**Directory Structure:**
\`\`\`markdown
## Directory Structure
\\\`\\\`\\\`
/src
  /core        - [Purpose]
  /commands    - [Purpose]
  /ui          - [Purpose]
/tests         - [Purpose]
/docs          - [Purpose]
\\\`\\\`\\\`
\`\`\`

**Key Components:**
\`\`\`markdown
## Key Components

### [Component Name 1]
- **Location**: \\\`path/to/component\\\`
- **Purpose**: [What it does]
- **Key Files**: [Important files]

### [Component Name 2]
- **Location**: \\\`path/to/component\\\`
- **Purpose**: [What it does]
- **Key Files**: [Important files]
\`\`\`

**DEPTH REQUIREMENT**:
- Read MULTIPLE files (5-10 minimum) to understand patterns
- Identify ALL major modules/components
- Document API routes, database schemas if applicable
- Note design patterns and architectural decisions
- List important dependencies with their purposes

**RULES**:
- Create template FIRST (step 1)
- Update sections INCREMENTALLY (steps 2-7)
- Do NOT wait to write everything at the end
- Use \`modify_file\` to replace "[TO BE ANALYZED]" sections
- Be DETAILED and COMPREHENSIVE
- Take your time - you have up to 30 steps
- Verify facts with \`read_file\` or \`search_file\` before documenting
`.trim();

    await runScanLoop(superPrompt, outputFile);
}

// ... (rest of the file)

async function runScanLoop(initialPrompt: string, targetPath: string) {
    let nextPrompt = initialPrompt;
    let keepGoing = true;
    let stepCount = 0;
    const MAX_STEPS = 30; // Safety limit - increased for deeper analysis

    while (keepGoing && stepCount < MAX_STEPS) {
        stepCount++;
        const spinner = tui.spinner();
        const msg = t('commands.scan.analyzing').replace('{step}', stepCount.toString());
        spinner.start(msg);

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
                                // Modify Logic: Read, Replace, Write
                                if (fs.existsSync(finalPath)) {
                                    const currentContent = fs.readFileSync(finalPath, 'utf-8');
                                    // action.target_content is needed for replacement
                                    if (action.target_content && currentContent.includes(action.target_content)) {
                                        const newContent = currentContent.replace(action.target_content, action.content || '');
                                        fs.writeFileSync(finalPath, newContent, { encoding: 'utf-8' });
                                        tui.log.success(`✅ Updated Context: ${finalPath}`);
                                        fileCreated = true;
                                    } else {
                                        // Fallback: If no target_content or target not found, what to do?
                                        // For Scan Agent incremental strategy, this is a failure in the prompt following.
                                        // We log a warning.
                                        tui.log.warning(t('commands.scan.error') + ': Target content not found for replacement.');
                                        executionResults += `[Action ${action.type}]: Failed. Target content not found in file.\n`;
                                        // Continue loop to give agent a chance to fix?
                                        fileCreated = false;
                                    }
                                } else {
                                    // File doesn't exist, treat as create?
                                    // But it should exist as template.
                                    tui.log.warning(t('commands.scan.error') + ': File not found.');
                                }
                            }
                            executionResults += `[Action ${action.type}]: Success. Task Completed.\n`;
                        } else {
                            tui.log.warning(t('commands.scan.error')); // Using generic error for unexpected file write attempt
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
                    tui.log.success(t('commands.scan.completed'));
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
            spinner.stop(t('common.error'));
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

    const url = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${getAgentId()}/chat`;
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
