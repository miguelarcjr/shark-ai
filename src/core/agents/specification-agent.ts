
import { STACKSPOT_AGENT_API_BASE, ensureValidToken } from '../api/stackspot-client.js';
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
    briefingPath?: string; // Path to the briefing file to read, explicit override
}

/**
 * Interactive Specification Agent session.
 * Reads briefing (optional), Consults Project Context (optional), consults user, and generates tech-spec.md.
 */
export async function interactiveSpecificationAgent(options: SpecAgentOptions = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🏗️  Specification Agent');

    const projectRoot = process.cwd();

    // 1. Load Context (Optional, similar to Dev Agent)
    let contextContent = '';
    const contextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');

    if (fs.existsSync(contextPath)) {
        try {
            contextContent = fs.readFileSync(contextPath, 'utf-8');
            tui.log.info(`📘 Context loaded from: ${colors.dim(path.relative(projectRoot, contextPath))}`);
        } catch (e) {
            tui.log.warning(`Failed to read context file: ${e}`);
        }
    }

    // 2. Resolve Briefing (Optional)
    let briefingContent = '';

    // a) Check Options first
    if (options.briefingPath && fs.existsSync(options.briefingPath)) {
        briefingContent = fs.readFileSync(options.briefingPath, 'utf-8');
        tui.log.info(`📄 Briefing loaded from: ${colors.dim(options.briefingPath)}`);
    } else {
        // b) Check Standard Location: _sharkrc/briefing.md
        const sharkRcBriefing = path.resolve(projectRoot, '_sharkrc', 'briefing.md');

        if (fs.existsSync(sharkRcBriefing)) {
            briefingContent = fs.readFileSync(sharkRcBriefing, 'utf-8');
            tui.log.info(`📄 Standard Briefing loaded: ${colors.dim('_sharkrc/briefing.md')}`);
        } else {
            // c) No briefing found.
            tui.log.info(colors.dim('ℹ️ No briefing file found in _sharkrc/briefing.md. Starting in interactive mode.'));
        }
    }

    // 3. Initial Prompt Construction
    let initialPrompt = "";

    if (briefingContent) {
        initialPrompt += `
Abaixo está o **Briefing de Negócio** ou Descrição da Tarefa.
Analise-o e ajude-me a definir a Especificação Técnica (tech-spec.md).

--- BRIEFING ---
${briefingContent}
----------------
`;
    } else {
        initialPrompt += `
Não há um documento de briefing formal.
Por favor, pergunte-me qual é a tarefa ou funcionalidade que vamos especificar hoje.
`;
    }

    if (contextContent) {
        initialPrompt += `
Abaixo está o **Contexto do Projeto** atual. Use-o para alinhar a especificação com a arquitetura existente.

--- PROJECT CONTEXT ---
${contextContent}
-----------------------
`;
    }

    initialPrompt += `
\nSeu objetivo final é gerar o arquivo 'tech-spec.md'.

⚠️ ATENÇÃO: WORKFLOW DE ANÁLISE
1. **Entenda**: Alinhe o objetivo com o usuário.
2. **Explore**: Use 'list_files' e 'read_file' para encontrar os arquivos RELEVANTES para a tarefa.
3. **Especifique**: Gere o 'tech-spec.md' citando nomes de arquivos REAIS que você leu.

⚠️ REGRA DE FORMATAÇÃO (CRITICA):
Na seção 'Implementation Steps', você DEVE usar CHECKBOXES markdown ( - [ ] ) e NÃO listas numeradas.
O agente de desenvolvimento SÓ reconhece checkboxes.

Exemplo CORRETO:
- [ ] Criar arquivo X
- [ ] Atualizar função Y

Exemplo ERRADO (NÃO FAÇA):
1. Criar arquivo X
2. Atualizar função Y
`;

    // 4. Start Conversation Loop
    await runSpecLoop(initialPrompt.trim(), options.agentId);
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
                // Optional: visual feedback
            }, overrideAgentId);

            spinner.stop('Response received');

            // Handle Response Actions
            if (lastResponse && lastResponse.actions) {
                let executionResults = "";
                let waitingForUser = false;

                for (const action of lastResponse.actions) {

                    if (action.type === 'talk_with_user') {
                        tui.log.info(colors.primary('🤖 Architect:'));
                        console.log(action.content);
                        waitingForUser = true;
                    }

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
                        tui.log.info(`🔍 Searching: ${colors.dim(action.path || '')}`);
                        const result = handleSearchFile(action.path || '');
                        executionResults += `[Action search_file(${action.path}) Result]:\n${result}\n\n`;
                    }

                    else if (['create_file', 'modify_file', 'delete_file'].includes(action.type)) {
                        tui.log.warning(`\n🤖 Agent wants to ${action.type}: ${colors.bold(action.path || 'unknown')}`);

                        // Preview
                        if (action.content) {
                            const preview = action.content.length > 500 ? action.content.substring(0, 500) + '...' : action.content;
                            console.log(colors.dim('--- Preview ---\n') + preview + '\n' + colors.dim('---------------'));
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
                                        const BOM = '\uFEFF';
                                        const contentToWrite = action.content || '';
                                        const finalContent = contentToWrite.startsWith(BOM) ? contentToWrite : BOM + contentToWrite;
                                        // Ensure directory
                                        const dir = path.dirname(action.path);
                                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                                        fs.writeFileSync(action.path, finalContent, { encoding: 'utf-8' });
                                        tui.log.success(`✅ Created: ${action.path}`);
                                        executionResults += `[Action create_file(${action.path})]: Success\n\n`;
                                    } else if (action.type === 'modify_file') {
                                        if (action.target_content) {
                                            const success = startSmartReplace(action.path, action.content || '', action.target_content, tui);
                                            executionResults += `[Action modify_file(${action.path})]: ${success ? 'Success' : 'Failed'}\n\n`;
                                        } else {
                                            // Fallback overwrite logic? Spec Agent documentation restricts this, but code can be defensive.
                                            // Let's enforce the documentation rule: Require target_content.
                                            tui.log.error('❌ Missing target_content. Modification aborted.');
                                            executionResults += `[Action modify_file]: Failed. 'target_content' is mandatory required for precision.\n\n`;
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
                    } else {
                        // Agent just did tools, let's auto-reply with results so it can continue
                        nextPrompt = executionResults;
                        FileLogger.log('SYSTEM', 'Auto-replying with Tool Results', { length: executionResults.length });
                        tui.log.info(colors.dim('Processing tool results...'));
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
                    // No actions?
                    if (lastResponse.message) {
                        tui.log.info(colors.primary('🤖 Architect:'));
                        console.log(lastResponse.message);
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) { keepGoing = false; break; }
                        nextPrompt = userReply as string;
                    } else {
                        tui.log.warning('No actions taken.');
                        keepGoing = false;
                    }
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
    const token = await ensureValidToken(realm);
    // if (!token) throw new Error('Not logged in'); // ensureValidToken throws if missing

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
