
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
import { handleListFiles, handleReadFile, handleSearchFile, handleSearchCode, startSmartReplace } from './agent-tools.js';
import { ConfigManager } from '../config-manager.js';

const AGENT_TYPE = 'specification_agent';

function getAgentId(overrideId?: string): string {
    if (overrideId) return overrideId;
    const config = ConfigManager.getInstance().getConfig();
    if (config.agents?.spec) return config.agents.spec;
    return process.env.STACKSPOT_SPEC_AGENT_ID || '01KEPXTX37FTB4N672TZST4SGP';
}

function getAgentVersion(overrideVersion?: string): string | undefined {
    if (overrideVersion) return overrideVersion;
    const config: any = ConfigManager.getInstance().getConfig();
    if (config.agentVersions?.spec) return config.agentVersions.spec;
    return process.env.STACKSPOT_SPEC_AGENT_VERSION;
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
[TO BE ANALYZED - STACK]
- Language: [e.g. TypeScript]
- Framework: [e.g. Node.js / React]
- Database: [e.g. SQLite / PostgreSQL]
- Key Libraries: [Top 5 dependencies]

## 2. Architecture Overview
[TO BE ANALYZED - ARCHITECTURE]
[Brief description of architectural pattern]

## 3. Data Model
[TO BE ANALYZED - DATA MODEL]
[Schema/ERD definitions]

## 4. API / Interface Contracts
[TO BE ANALYZED - API]
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
Seu objetivo final é produzir uma especificação técnica precisa para a tarefa no arquivo \`_sharkrc/tech-spec.md\`.

⚠️ O SEU WORKFLOW É GUIADO POR FASES.
NÃO TENTE ADIANTAR O TRABALHO (ex: investigar código ou preencher template agora).

**VOCÊ ESTÁ NA FASE 1: ENTENDIMENTO DA TAREFA**
- Use \`talk_with_user\` para perguntar ao usuário qual tarefa específica, funcionalidade ou bug ele precisa especificar.
- Confirme o escopo e os limites com o usuário.
- Se o escopo estiver perfeitamente claro e confirmado (com o usuário), emita "PHASE_COMPLETED" no campo "summary" do JSON para avançar.

IMPORTANTE: Toda a sua comunicação DEVE ser em Português.
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
    let currentPhase = 1;
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

                    else if (action.type === 'search_code') {
                        const glob = action.path || 'src/**/*';
                        const query = action.query || '';
                        const isRegex = action.is_regex === true;
                        tui.log.info(`🔎 Search code: ${colors.dim(`"${query}" in ${glob}`)}`);
                        const result = handleSearchCode(glob, query, isRegex);
                        executionResults += `[Action search_code("${query}" in "${glob}") Result]:\n${result}\n\n`;
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
                                        executionResults += `[Action modify_file]: Failed. Target content not found or ambiguous.\n`;
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

                // Check for Phase completion signal
                if (lastResponse.message && lastResponse.message.includes('PHASE_COMPLETED')) {
                    const extraContext = executionResults ? `\n\nResultados das últimas ações executadas antes da conclusão:\n${executionResults}` : "";
                    
                    if (currentPhase === 1) {
                        currentPhase = 2;
                        tui.log.success(`✅ Fase 1 Concluída. Iniciando Fase 2 (Investigação).`);
                        nextPrompt = `[System Message]\nVocê completou a FASE 1 com sucesso.\n\n**VOCÊ AGORA ESTÁ NA FASE 2: INVESTIGAÇÃO**\n- Use \`search_code\` e \`list_files\` para explorar os arquivos relevantes à tarefa.\n- Prefira \`search_code\` em vez de \`read_file\` para buscar código sem inflar o contexto.\n- NÃO leia o projeto inteiro de forma genérica.\n- REGRA DE OURO (READ-FIRST): Você NÃO PODE referenciar um arquivo na especificação técnica que não tenha investigado nesta fase.\n- Quando achar que possui toda a clareza técnica sobre onde e o que deve ser feito no código, emita "PHASE_COMPLETED" no summary.${extraContext}`;
                        continue;
                    } else if (currentPhase === 2) {
                        currentPhase = 3;
                        tui.log.success(`✅ Fase 2 Concluída. Iniciando Fase 3 (Preenchimento).`);
                        nextPrompt = `[System Message]\nVocê completou a FASE 2 com sucesso.\n\n**VOCÊ AGORA ESTÁ NA FASE 3: PREENCHIMENTO DO TEMPLATE**\n- Use \`modify_file\` no arquivo \`${targetPath}\` para substituir os placeholders pelo conteúdo real levantado na fase de investigação.\n- As seções 1-4 devem descrever o contexto da TAREFA, e não o projeto como um todo.\n- Passos de Implementação (Implementation Steps): APENAS checkboxes markdown: \`- [ ] [Verbo de Ação] [O Que] em [Caminho Relativo]\`.\n- Quando TODOS os placeholders ([TO BE ANALYZED...] ou [TO BE FILLED]) forem substituídos e o trabalho concluído, emita "SPEC_UPDATED: Complete" no summary para finalizar.${extraContext}`;
                        continue;
                    }
                }

                // Check for final completion signal
                if (lastResponse.message && lastResponse.message.includes('SPEC_UPDATED:')) {
                    if (currentPhase < 3) {
                        tui.log.warning(`O agente tentou finalizar prematuramente. Forçando retorno para a fase atual...`);
                        nextPrompt = `[System Error]: Você tentou finalizar a especificação prematuramente emitindo SPEC_UPDATED, mas ainda está na Fase ${currentPhase}. Você só pode finalizar quando estiver na Fase 3.\n\nContinue seu trabalho na Fase ${currentPhase} ou emita "PHASE_COMPLETED" se terminou esta etapa atual.`;
                        continue;
                    }

                    const content = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf-8') : '';
                    if (content.includes('[TO BE')) {
                        const pendingMatches = [...content.matchAll(/## ([^\n]+)[\s\S]*?\[TO BE/g)].map(m => m[1]);
                        let missing = pendingMatches.length > 0 ? pendingMatches.join(', ') : 'algumas seções';
                        
                        tui.log.warning(`O agente tentou concluir prematuramente, mas há placeholders pendentes. Forçando retorno...`);
                        nextPrompt = `[System Error]: A validação falhou e o bloqueio automático foi acionado.\nVocê tentou concluir a tarefa, mas o arquivo AINDA possui placeholders '[TO BE ANALYZED...]' ou '[TO BE FILLED]'.\nAs seguintes seções ainda contêm estes placeholders: ${missing}.\nVocê é OBRIGADO a usar a action \`modify_file\` para preencher o conteúdo de cada uma dessas seções. Use o placeholder exato no campo \`target_content\`. NÃO repita a conclusão da tarefa até corrigir todas as pendências.`;
                        continue;
                    } else {
                        const updateSummary = lastResponse.message.split('SPEC_UPDATED:')[1].trim();
                        tui.log.success(`✅ Spec Finalized: ${updateSummary}`);
                        return;
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
                            systemMsg += `\n[System]: Seção atualizada com sucesso. A validação detectou que AINDA HÁ placeholders pendentes ('[TO BE...]') nas seguintes seções: ${missing}.\nPor favor, envie uma nova action \`modify_file\` focada em uma destas seções obrigatoriamente. USE o respectivo placeholder no campo \`target_content\` para que o replace funcione.`;
                        } else {
                            systemMsg += "\n[System]: O arquivo parece completo! Se estiver satisfeito e possuir TODAS as implementações descritas, retorne 'SPEC_UPDATED: Complete'.";
                        }
                    } else {
                        // Adicionando um aviso de que falhou e precisa tentar de novo
                        systemMsg += "\n[System]: A modificação do arquivo falhou. Verifique se o \`target_content\` que você usou existe EXATAMENTE como no arquivo e se ele é ÚNICO na hora de usar a action \`modify_file\`.";
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

    const payload: any = {
        user_prompt: prompt,
        streaming: true,
        stackspot_knowledge: false,
        return_ks_in_response: true,
        use_conversation: true,
        conversation_id: conversationId
    };

    const agentVersion = getAgentVersion();
    if (agentVersion) {
        payload.agent_version_number = agentVersion;
    }

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
