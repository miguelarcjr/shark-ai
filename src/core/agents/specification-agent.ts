
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
    initialContext?: string; // Handover context from Dev Agent or Orchestrator
}

/**
 * Interactive Specification Agent session.
 * Uses a Template-Based Incremental Workflow.
 */
export async function interactiveSpecificationAgent(options: SpecAgentOptions = {}): Promise<void> {
    FileLogger.init();
    tui.intro('🏗️  Specification Agent (Template-Based)');

    const projectRoot = process.cwd();
    // User requested to store tech-spec.md in _sharkrc
    const sharkRcDir = path.resolve(projectRoot, '_sharkrc');
    if (!fs.existsSync(sharkRcDir)) fs.mkdirSync(sharkRcDir, { recursive: true });

    const outputFile = path.resolve(sharkRcDir, 'tech-spec.md');

    // 1. Ensure Template Exists (Inline Template)
    if (!fs.existsSync(outputFile)) {
        // Hardcoded template as requested, similar to scan-agent.ts
        let initialContent = `# Technical Specification: {{PROJECT_NAME}}

## 1. Technology Stack
[TO BE ANALYZED]
- Language: [e.g. TypeScript]
- Framework: [e.g. Node.js / React]
- Database: [e.g. SQLite / PostgreSQL]
- Key Libraries: [Top 5 dependencies]

## 2. Architecture Overview
[TO BE ANALYZED]
[Brief description of architectural pattern]

## 3. Data Model
[TO BE ANALYZED]
[Schema/ERD definitions]

## 4. API / Interface Contracts
[TO BE ANALYZED]
[Main endpoints or CLI commands]

## 5. Implementation Steps
[TO BE FILLED - MUST BE CHECKBOXES]
`;

        // Replace basic placeholders immediately
        const projectName = path.basename(projectRoot);
        initialContent = initialContent.replace(/{{PROJECT_NAME}}/g, projectName);

        const BOM = '\uFEFF';
        fs.writeFileSync(outputFile, BOM + initialContent, { encoding: 'utf-8' });
        tui.log.success(`✅ Created: ${colors.bold('_sharkrc/tech-spec.md')}`);
    } else {
        tui.log.info(`📄 Using existing ${colors.bold('_sharkrc/tech-spec.md')}`);
    }

    // 2. Load Inputs (Context, Briefing)
    let contextContent = '';
    const contextPath = path.resolve(projectRoot, '_sharkrc', 'project-context.md');
    if (fs.existsSync(contextPath)) {
        contextContent = fs.readFileSync(contextPath, 'utf-8');
        tui.log.info(`📘 Context loaded.`);
    }

    let briefingContent = '';
    if (options.briefingPath && fs.existsSync(options.briefingPath)) {
        briefingContent = fs.readFileSync(options.briefingPath, 'utf-8');
        tui.log.info(`📄 Briefing loaded from: ${colors.dim(options.briefingPath)}`);
    } else {
        const standardBriefing = path.resolve(projectRoot, '_sharkrc', 'briefing.md');
        if (fs.existsSync(standardBriefing)) {
            briefingContent = fs.readFileSync(standardBriefing, 'utf-8');
            tui.log.info(`📄 Briefing loaded.`);
        }
    }

    // 3. Construct Super Prompt
    let initialPrompt = `
Você é o **Shark Spec**, um Arquiteto de Software Sênior e Tech Lead.
Seu objetivo é produzir uma especificação técnica precisa e específica para a tarefa no arquivo \`_sharkrc/tech-spec.md\`.

⚠️ WORKFLOW OBRIGATÓRIO – SIGA ESSA SEQUÊNCIA ESTRITAMENTE. NÃO PULE ETAPAS.

**FASE 1 – ENTENDA A TAREFA (COMECE AQUI):**
- Use \`talk_with_user\` para perguntar ao usuário qual tarefa específica, funcionalidade ou bug ele precisa especificar.
- NÃO explore o código ou leia arquivos ainda.
- Confirme o escopo e os limites com o usuário antes de prosseguir.

**FASE 2 – INVESTIGUE (FOCADO APENAS NA TAREFA):**
- Use \`list_files\` e \`read_file\` APENAS em arquivos diretamente relevantes para a tarefa confirmada.
- NÃO leia o projeto de forma genérica.
- REGRA DE LEITURA PRÉVIA: Você NÃO PODE adicionar uma tarefa referenciando um arquivo que você não leu nesta sessão (exceção: novos arquivos a serem criados).

**FASE 3 – PREENCHA O TEMPLATE:**
- Use \`modify_file\` em \`_sharkrc/tech-spec.md\` para substituir os placeholders com conteúdo real e específico da tarefa.
- As Seções 1-4 (Stack, Arquitetura, Modelo de Dados, API) devem descrever o contexto da TAREFA, não do projeto como um todo.
- Passos de Implementação: APENAS checkboxes markdown: \`- [ ] [Verbo de Ação] [O Que] em [Caminho Relativo]\`. SEM listas numeradas, SEM subníveis.
- Quando todos os placeholders acabarem e você estiver satisfeito, retorne: \`SPEC_UPDATED: Complete\`.

**REGRAS CRÍTICAS:**
- NUNCA preencha a Technology Stack ou Architecture com informações genéricas do projeto. Essas seções devem refletir o que a tarefa irá usar ou alterar.
- Use \`talk_with_user\` sempre que os requisitos forem ambíguos.
- NÃO tente escrever todas as seções de uma vez. Trabalhe de forma incremental, uma seção por vez.
- IMPORTANTE: Toda a sua comunicação e a especificação gerada DEVEM ser em Português.
`;

    if (briefingContent) {
        initialPrompt += `
ℹ️ Um documento de briefing foi encontrado. Ele define parcialmente a tarefa para a Fase 1.
Confirme seu entendimento com o usuário via \`talk_with_user\` antes de prosseguir para a Fase 2.

--- BRIEFING ---
${briefingContent}
----------------
`;
    } else {
        initialPrompt += `
ℹ️ Nenhum documento de briefing foi encontrado. Inicie a Fase 1 imediatamente: use \`talk_with_user\` para perguntar ao usuário o que precisa ser especificado.
`;
    }

    if (options.initialContext) {
        initialPrompt += `\n--- CONTEXTO DE EXECUÇÃO ANTERIOR (HANDOVER/FEEDBACK) ---\n${options.initialContext}\n-----------------------------------------------------\n`;
    }

    if (contextContent) {
        initialPrompt += `
ℹ️ O contexto do projeto está disponível para referência. Use-o na Fase 2 para se alinhar com os padrões de arquitetura existentes, mas NÃO o use para preencher as seções de forma genérica.

--- PROJECT CONTEXT ---
${contextContent}
-----------------------
`;
    }

    // 4. Start Loop
    await runSpecLoop(initialPrompt.trim(), outputFile, options.agentId);
}

/**
 * Main Loop for Specification Agent (Incremental)
 */
async function runSpecLoop(initialMessage: string, targetPath: string, overrideAgentId?: string) {
    let nextPrompt = initialMessage;
    let keepGoing = true;
    let stepCount = 0;
    const MAX_STEPS = 30;

    while (keepGoing && stepCount < MAX_STEPS) {
        stepCount++;
        const spinner = tui.spinner();
        spinner.start(`🏗️  Spec Agent working (Step ${stepCount}/${MAX_STEPS})...`);

        // Check Pending Sections to guide the agent
        let pendingSections = [];
        if (fs.existsSync(targetPath)) {
            const content = fs.readFileSync(targetPath, 'utf-8');
            if (content.includes('[TO BE ANALYZED]')) pendingSections.push('Analysis Sections (Stack, Arch, Data, API)');
            if (content.includes('[TO BE FILLED')) pendingSections.push('Implementation Steps');
        }

        if (pendingSections.length === 0 && stepCount > 1) {
            // Check if user is done?
        }

        let responseText = '';
        let lastResponse: AgentResponse | null = null;

        try {
            lastResponse = await callSpecAgentApi(nextPrompt, (chunk) => {
                responseText += chunk;
            }, overrideAgentId);

            spinner.stop('Response received');

            if (lastResponse && lastResponse.actions) {
                let executionResults = "";
                let waitingForUser = false;
                let specUpdated = false;

                // Check for completion signal
                if (lastResponse.message && lastResponse.message.includes('SPEC_UPDATED:')) {
                    const content = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
                    if (content.includes('[TO BE')) {
                        const pendingMatches = [...content.matchAll(/## ([^\n]+)[\s\S]*?\[TO BE/g)].map(m => m[1]);
                        let missing = pendingMatches.length > 0 ? pendingMatches.join(', ') : 'algumas seções';
                        
                        tui.log.warning(`O agente tentou concluir prematuramente, mas há placeholders pendentes. Forçando retorno...`);
                        nextPrompt = `[System Error]: Você tentou enviar 'SPEC_UPDATED: Complete', mas o arquivo AINDA possui placeholders '[TO BE...]'. \nAs seguintes seções parecem incompletas: ${missing}.\n\nPor favor, retome a FASE 3 e continue editando o arquivo até que NENHUM placeholder reste. Lembre-se, use \`modify_file\` para cada uma dessas seções e foque na tarefa discutida.`;
                        continue;
                    } else {
                        const updateSummary = lastResponse.message.split('SPEC_UPDATED:')[1].trim();
                        tui.log.success(`✅ Spec Finalized: ${updateSummary}`);
                        return;
                    }
                }

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

                    else if (['create_file', 'modify_file'].includes(action.type)) {
                        // Target Validation & Redirection
                        let actionPath = path.resolve(action.path || '');
                        const resolvedTargetPath = path.resolve(targetPath);
                        let isTarget = actionPath === resolvedTargetPath;

                        // Auto-redirect if agent tries to write to root tech-spec.md instead of _sharkrc
                        if (!isTarget && path.basename(actionPath) === 'tech-spec.md') {
                            tui.log.warning(`Redirecting ${action.type} from ${action.path} to ${path.relative(process.cwd(), targetPath)}`);
                            action.path = targetPath;
                            actionPath = resolvedTargetPath;
                            isTarget = true;
                        }

                        if (!isTarget && action.type === 'create_file') {
                            const confirm = await tui.confirm({ message: `Agent wants to create ${action.path}. Allow?` });
                            if (!confirm) {
                                executionResults += `[Action create_file]: User denied.\n`;
                                continue;
                            }
                        }

                        try {
                            if (action.type === 'create_file') {
                                const BOM = '\uFEFF';
                                fs.writeFileSync(action.path!, BOM + (action.content || ''), 'utf-8');
                                tui.log.success(`✅ Created: ${action.path}`);
                                executionResults += `[Action create_file]: Success.\n`;
                            } else if (action.type === 'modify_file') {
                                if (action.target_content) {
                                    // Ensure we pass the possibly redirected path
                                    const success = startSmartReplace(action.path!, action.content || '', action.target_content, tui);
                                    if (success) {
                                        executionResults += `[Action modify_file]: Success.\n`;
                                        specUpdated = true;
                                    } else {
                                        executionResults += `[Action modify_file]: Failed. Target content not found.\n`;
                                    }
                                } else {
                                    executionResults += `[Action modify_file]: Failed. 'target_content' is required.\n`;
                                }
                            }
                        } catch (e: any) {
                            executionResults += `[Action ${action.type}]: Error: ${e.message}\n`;
                        }
                    }
                }

                // Prepare Next Prompt
                if (waitingForUser) {
                    const userReply = await tui.text({ message: 'Your answer', placeholder: 'Type your answer...' });
                    if (tui.isCancel(userReply)) { keepGoing = false; return; }
                    nextPrompt = `${executionResults}\n\nUser Reply: ${userReply}`;
                } else if (executionResults) {
                    const content = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
                    let systemMsg = "Execução da ferramenta concluída.";
                    if (specUpdated) {
                        if (content.includes('[TO BE')) {
                            const pendingMatches = [...content.matchAll(/## ([^\n]+)[\s\S]*?\[TO BE/g)].map(m => m[1]);
                            let missing = pendingMatches.length > 0 ? pendingMatches.join(', ') : 'várias seções';
                            systemMsg += `\n[System]: Seção atualizada. Por favor, continue preenchendo os placeholders '[TO BE ...]' restantes nas seguintes seções: ${missing}.`;
                        } else {
                            systemMsg += "\n[System]: O arquivo parece completo! Se estiver satisfeito e possuir TODAS as implementações descritas, retorne 'SPEC_UPDATED: Complete'.";
                        }
                    }
                    nextPrompt = `${executionResults}\n\n${systemMsg}`;
                } else {
                    if (lastResponse.message) {
                        tui.log.info(colors.primary('🤖 Architect (Message only):'));
                        console.log(lastResponse.message);
                        const userReply = await tui.text({ message: 'Your answer:' });
                        if (tui.isCancel(userReply)) { keepGoing = false; break; }
                        nextPrompt = userReply as string;
                    } else {
                        keepGoing = false;
                    }
                }

            } else {
                tui.log.warning('No actions received.');
                keepGoing = false;
            }

        } catch (error: any) {
            spinner.stop('Error');
            tui.log.error(error.message);
            keepGoing = false;
        }
    }
}

// --- API Wrapper Matches Scan/Dev Agent Pattern ---
async function callSpecAgentApi(prompt: string, onChunk: (chunk: string) => void, agentId?: string): Promise<AgentResponse> {
    const realm = await getActiveRealm();
    const token = await ensureValidToken(realm);
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

    FileLogger.log('AGENT', 'Calling Agent API', { agentId: effectiveAgentId, conversationId });

    await sseClient.streamAgentResponse(url, payload, { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, {
        onChunk: (c) => { fullMsg += c; onChunk(c); },
        onComplete: (msg, metadata) => {
            const returnedId = metadata?.conversation_id;
            raw = { message: msg || fullMsg, conversation_id: returnedId || conversationId };
        },
        onError: (e) => { throw e; }
    });

    const parsed = parseAgentResponse(raw);
    if (parsed.conversation_id) {
        await conversationManager.saveConversationId(AGENT_TYPE, parsed.conversation_id);
    }

    return parsed;
}
