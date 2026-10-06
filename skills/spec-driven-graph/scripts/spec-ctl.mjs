#!/usr/bin/env node
/**
 * spec-ctl.mjs - Centralized State & Graph Controller CLI for Spec-Driven Graph
 * 
 * Usage:
 *   node spec-ctl.mjs init <spec-id> [--title "Title"]
 *   node spec-ctl.mjs status [--spec <spec-id>]
 *   node spec-ctl.mjs brief [--spec <spec-id>] [role]
 *   node spec-ctl.mjs validate [--spec <spec-id>]
 *   node spec-ctl.mjs transition [--spec <spec-id>] [--next | --to <node>] [--evidence <file>]
 *   node spec-ctl.mjs rollback [--spec <spec-id>] --to <node> --reason "<text>" [--evidence <file>]
 *   node spec-ctl.mjs export [--spec <spec-id>] [--out <path>]
 */

import fs from 'node:fs';
import path from 'node:path';

// --- Graph Topology & Node Definitions ---
export const NODES = {
    CONTEXT_GROUNDING: {
        id: 'CONTEXT_GROUNDING',
        index: 0,
        title: 'Multi-Source Grounding & Pre-Elicitation',
        role: 'researcher',
        defaultArtifact: 'context-pack.md',
        next: 'DISCOVERY_ELICITATION',
        prev: null,
        requiredSections: ['# Context Pack', '1. Regras de Negocio', '2. Matriz de Conflitos'],
    },
    DISCOVERY_ELICITATION: {
        id: 'DISCOVERY_ELICITATION',
        index: 1,
        title: 'Elicitation & Discovery',
        role: 'analyst',
        defaultArtifact: 'brief.md',
        next: 'HYPOTHESIS_SPIKES',
        prev: 'CONTEXT_GROUNDING',
        requiredSections: ['# Problem', '# Scope', '# Acceptance Criteria'],
    },
    HYPOTHESIS_SPIKES: {
        id: 'HYPOTHESIS_SPIKES',
        index: 2,
        title: 'Empirical Spikes & Hypothesis Verification',
        role: 'spike-tester',
        defaultArtifact: 'spikes.md',
        next: 'TECHNICAL_ARCHITECTURE',
        prev: 'DISCOVERY_ELICITATION',
        requiredSections: ['# Empirical Spikes', '# Hypotheses Evaluation', '# Findings'],
    },
    TECHNICAL_ARCHITECTURE: {
        id: 'TECHNICAL_ARCHITECTURE',
        index: 3,
        title: 'System Architecture & Technical Design',
        role: 'architect',
        defaultArtifact: 'design.md',
        next: 'ADVERSARIAL_CRITIQUE',
        prev: 'HYPOTHESIS_SPIKES',
        requiredSections: ['# Architecture', '# Affected Files', '# Interfaces and Data Contracts'],
    },
    ADVERSARIAL_CRITIQUE: {
        id: 'ADVERSARIAL_CRITIQUE',
        index: 4,
        title: 'Adversarial Review & Edge Cases',
        role: 'reviewer',
        defaultArtifact: 'critique.md',
        next: 'TDD_PLAN_DECOMPOSITION',
        prev: 'TECHNICAL_ARCHITECTURE',
        requiredSections: ['# Risk Analysis', '# Edge Cases', '# Audit Verdict'],
    },
    TDD_PLAN_DECOMPOSITION: {
        id: 'TDD_PLAN_DECOMPOSITION',
        index: 5,
        title: 'TDD Plan & Atomic Decomposition',
        role: 'planner',
        defaultArtifact: 'plan.md',
        next: 'PLAN_AUDIT',
        prev: 'TECHNICAL_ARCHITECTURE',
        requiredSections: ['# Implementation Plan', 'Task 1'],
    },
    PLAN_AUDIT: {
        id: 'PLAN_AUDIT',
        index: 6,
        title: 'Plan Quality & Traceability Audit',
        role: 'plan-auditor',
        defaultArtifact: 'plan-critique.md',
        next: 'READY_FOR_EXECUTION',
        prev: 'TDD_PLAN_DECOMPOSITION',
        requiredSections: ['# Plan Audit', '# Coverage Matrix', '# Dependency & Order Review', '# Audit Verdict'],
    },
    READY_FOR_EXECUTION: {
        id: 'READY_FOR_EXECUTION',
        index: 7,
        title: 'Handoff to Subagent-Driven Development',
        role: null,
        defaultArtifact: null,
        next: null,
        prev: 'PLAN_AUDIT',
        requiredSections: [],
    }
};

const SHARK_SPECS_DIR = path.resolve('.shark', 'specs');

// --- Helper Functions ---
function getSpecDir(specId) {
    return path.join(SHARK_SPECS_DIR, specId);
}

function getStatePath(specId) {
    return path.join(getSpecDir(specId), 'state.json');
}

function getFeedbackPath(specId) {
    return path.join(getSpecDir(specId), 'feedback-history.json');
}

function findActiveSpecId() {
    if (!fs.existsSync(SHARK_SPECS_DIR)) return null;
    const entries = fs.readdirSync(SHARK_SPECS_DIR, { withFileTypes: true });
    const specDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (specDirs.length === 0) return null;
    if (specDirs.length === 1) return specDirs[0];
    
    // Pick the most recently modified state.json
    let latestSpec = null;
    let latestMtime = 0;
    for (const id of specDirs) {
        const stateFile = getStatePath(id);
        if (fs.existsSync(stateFile)) {
            const mtime = fs.statSync(stateFile).mtimeMs;
            if (mtime > latestMtime) {
                latestMtime = mtime;
                latestSpec = id;
            }
        }
    }
    return latestSpec;
}

function loadState(specId) {
    const stateFile = getStatePath(specId);
    if (!fs.existsSync(stateFile)) {
        console.error(`[ERROR] State file not found: ${stateFile}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function saveState(specId, state) {
    const specDir = getSpecDir(specId);
    fs.mkdirSync(specDir, { recursive: true });
    state.updated = new Date().toISOString();
    fs.writeFileSync(getStatePath(specId), JSON.stringify(state, null, 2), 'utf8');
}

function appendFeedback(specId, entry) {
    const feedbackFile = getFeedbackPath(specId);
    let history = [];
    if (fs.existsSync(feedbackFile)) {
        try { history = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch {}
    }
    history.push({ timestamp: new Date().toISOString(), ...entry });
    fs.writeFileSync(feedbackFile, JSON.stringify(history, null, 2), 'utf8');
}

// --- CLI Commands ---

function cmdInit(specId, title) {
    if (!specId) {
        console.error("Usage: node spec-ctl.mjs init <spec-id> [--title \"Title\"]");
        process.exit(1);
    }
    
    const specDir = getSpecDir(specId);
    if (fs.existsSync(getStatePath(specId))) {
        console.error(`[ERROR] Spec '${specId}' already exists at ${specDir}`);
        process.exit(1);
    }

    fs.mkdirSync(path.join(specDir, 'briefs'), { recursive: true });
    fs.mkdirSync(path.join(specDir, 'artifacts'), { recursive: true });

    const initialState = {
        specId,
        title: title || specId,
        currentNode: NODES.CONTEXT_GROUNDING.id,
        status: 'IN_PROGRESS',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        rollbacksCount: 0,
        iterations: {
            CONTEXT_GROUNDING: 1,
            DISCOVERY_ELICITATION: 0,
            HYPOTHESIS_SPIKES: 0,
            TECHNICAL_ARCHITECTURE: 0,
            ADVERSARIAL_CRITIQUE: 0,
            TDD_PLAN_DECOMPOSITION: 0,
            PLAN_AUDIT: 0,
        },
        artifacts: {
            contextPack: null,
            brief: null,
            spikes: null,
            design: null,
            critique: null,
            plan: null,
            planCritique: null,
        },
        groundingSources: [],
        hypotheses: [],
        auditWarnings: [],
        history: [
            {
                node: NODES.CONTEXT_GROUNDING.id,
                action: 'INITIALIZED',
                timestamp: new Date().toISOString(),
            }
        ]
    };

    saveState(specId, initialState);
    console.log(`\n======================================================`);
    console.log(`✔ [SPEC-GRAPH] Initialized spec '${specId}'`);
    console.log(`📁 State location: ${getStatePath(specId)}`);
    console.log(`📍 Current Node: [0/5] ${NODES.CONTEXT_GROUNDING.title}`);
    console.log(`🤖 Assigned Subagent Role: ${NODES.CONTEXT_GROUNDING.role}`);
    console.log(`======================================================`);
    console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs source add --type <type> --origin <path>' to register background context, or 'transition --next' to advance directly to Elicitation.`);
}

function cmdStatus(specIdArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found. Run 'init' first.");
        process.exit(1);
    }

    const state = loadState(specId);
    const nodeDef = NODES[state.currentNode] || { title: state.currentNode, index: 0, role: 'none' };

    console.log(`\n======================================================`);
    console.log(`📊 SPEC-DRIVEN GRAPH: ${state.specId} ("${state.title}")`);
    console.log(`======================================================`);
    
    // Draw ASCII Graph Pipeline
    const nodeKeys = ['CONTEXT_GROUNDING', 'DISCOVERY_ELICITATION', 'HYPOTHESIS_SPIKES', 'TECHNICAL_ARCHITECTURE', 'ADVERSARIAL_CRITIQUE', 'TDD_PLAN_DECOMPOSITION', 'PLAN_AUDIT'];
    const pipeline = nodeKeys.map(k => {
        const item = NODES[k];
        if (k === state.currentNode) return `[▶ ${item.index}.${item.role.toUpperCase()}]`;
        const wasCompleted = state.history.some(h => (h.node === k || h.toNode === k) && h.action === 'TRANSITIONED');
        return wasCompleted ? `[✔ ${item.index}.${item.role}]` : `[ ${item.index}.${item.role} ]`;
    }).join(' ➔ ');
    
    console.log(`Pipeline: ${pipeline}`);
    console.log(`------------------------------------------------------`);
    console.log(`Current Node: [${nodeDef.index}/6] ${nodeDef.title} (${state.currentNode})`);
    console.log(`Rollback Cycles: ${state.rollbacksCount}`);
    if (state.status === 'CIRCUIT_BREAKER_TRIGGERED') {
        console.log(`STATUS: 🚨 CIRCUIT_BREAKER_TRIGGERED (Maximum rollbacks reached)`);
    }
    if (state.groundingSources && state.groundingSources.length > 0) {
        console.log(`Grounding Sources Registered (${state.groundingSources.length}):`);
        for (const s of state.groundingSources) {
            console.log(`  - [${s.type}] ${s.origin}`);
        }
    }
    if (state.hypotheses && state.hypotheses.length > 0) {
        console.log(`Hypotheses Registered (${state.hypotheses.length}):`);
        for (const h of state.hypotheses) {
            console.log(`  - [${h.id}] (${h.status}): ${h.statement}`);
        }
    }
    console.log(`Artifacts Tracked:`);
    for (const [k, v] of Object.entries(state.artifacts)) {
        console.log(`  - ${k.padEnd(8)}: ${v ? `✔ ${v}` : '❌ (pending)'}`);
    }
    console.log(`------------------------------------------------------`);

    if (state.status === 'CIRCUIT_BREAKER_TRIGGERED') {
        console.log(`🚨 [CIRCUIT BREAKER ACTIVE] 5 rollbacks reached!`);
        console.log(`Autonomous execution is halted. Human intervention is required to proceed.`);
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs intervene --decision "<human resolution>"' to unblock.`);
        return;
    }

    if (state.currentNode === 'READY_FOR_EXECUTION') {
        console.log(`🎉 Specification & Planning Complete! Ready for SDD implementation.`);
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs export' to hand off to subagent-driven-development-lite.`);
        return;
    }

    console.log(`[INSTRUCTION] Current active role is '${nodeDef.role}'. Call 'node skills/spec-driven-graph/scripts/spec-ctl.mjs brief ${nodeDef.role}' to generate or refresh the subagent brief.`);
}

function cmdBrief(specIdArg, roleArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }

    const state = loadState(specId);
    const currentNodeDef = NODES[state.currentNode];
    const role = roleArg || currentNodeDef?.role;

    if (!role) {
        console.error(`[ERROR] No active role for node ${state.currentNode}`);
        process.exit(1);
    }

    const specDir = getSpecDir(specId);

    // Purge stale target artifact for the dispatched role before generation to prevent stale reads
    const roleDef = Object.values(NODES).find(n => n.role === role) || currentNodeDef;
    if (roleDef && roleDef.defaultArtifact) {
        const artifactKey = roleDef.defaultArtifact.replace('.md', '');
        const candidates = [
            state.artifacts?.[artifactKey],
            path.join('.shark', 'specs', specId, 'artifacts', roleDef.defaultArtifact)
        ].filter(Boolean);

        for (const relPath of candidates) {
            const fullPath = path.resolve(relPath);
            if (fs.existsSync(fullPath)) {
                try {
                    fs.unlinkSync(fullPath);
                    console.log(`🧹 [CLEANUP] Cleared stale artifact before role execution: ${relPath}`);
                } catch (e) {
                    console.warn(`⚠️ Could not remove stale artifact ${fullPath}: ${e.message}`);
                }
            }
        }
        if (state.artifacts && state.artifacts[artifactKey]) {
            state.artifacts[artifactKey] = null;
            saveState(specId, state);
        }
    }

    const briefDir = path.join(specDir, 'briefs');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefFile = path.join(briefDir, `${role}-brief.md`);

    let briefContent = '';
    const feedbackFile = getFeedbackPath(specId);
    let feedbackContent = '';
    if (fs.existsSync(feedbackFile)) {
        try {
            const feedbacks = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
            if (feedbacks.length > 0) {
                feedbackContent = `\n## ⚠️ Historical Rollbacks & Audit Feedback\n` + 
                    feedbacks.map(f => `- [${f.timestamp}] (${f.fromNode} ➔ ${f.toNode}): ${f.reason}`).join('\n');
            }
        } catch {}
    }

    const baseFrontmatter = `---
type: subagent
role: ${role}
spec_id: ${specId}
---

`;

    if (role === 'researcher') {
        const sourcesList = (state.groundingSources && state.groundingSources.length > 0)
            ? state.groundingSources.map(s => `- **[${s.type}]**: \`${s.origin}\``).join('\n')
            : '*(No external sources registered. You may inspect repository files, issues, or documentation directly.)*';

        briefContent = `${baseFrontmatter}# Subagent Task Brief: Multi-Source Context Grounder
**Spec ID:** ${specId}
**Goal:** Ingest and synthesize heterogeneous information sources (transcripts, docs, URLs, existing code) to extract grounded business rules and an explicit conflict matrix before requirements elicitation begins.
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/context-pack.md\`

## Registered Sources
${sourcesList}

## Your Mission
1. Inspect each registered source file, URL, or code area.
2. Distill the findings into an actionable \`.shark/specs/${specId}/artifacts/context-pack.md\`.
3. Highlight ambiguities, conflicting rules between sources, and hidden assumptions so the Product Analyst can probe them with laser focus during user interviews.

## Required Output Structure (\`.shark/specs/${specId}/artifacts/context-pack.md\`)
\`\`\`markdown
# Context Pack
[Summary of analyzed sources]

## 1. Regras de Negocio
- BR-01: ...
- BR-02: ...

## 2. Matriz de Conflitos
- [CONF-01] Source A says X, but Source B says Y...
- [CONF-02] ...

## 3. Perguntas Chave
1. ...
\`\`\`
${feedbackContent}
`;
    } else if (role === 'analyst') {
        let groundingSection = '';
        const contextPackPath = state.artifacts?.contextPack || path.join(getSpecDir(specId), 'artifacts', 'context-pack.md');
        if (fs.existsSync(contextPackPath)) {
            try {
                const cpContent = fs.readFileSync(contextPackPath, 'utf8');
                groundingSection = `\n## 🎯 Multi-Source Grounding: Unresolved Conflicts & Rules\nThe following context pack was synthesized from background documents and code:\n\n${cpContent}\n\n**CRITICAL:** Prioritize probing the user on the conflicts ([CONF-xx]) and key questions identified above!\n`;
            } catch {}
        }

        briefContent = `${baseFrontmatter}# Subagent Task Brief: Product Analyst (Interactive Elicitation)
**Spec ID:** ${specId}
**Goal:** Interactively discover, refine, and elicit requirements through collaborative dialogue with the user.
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/brief.md\`
${groundingSection}
## Mandatory Interactive Process
1. **DO NOT generate the brief artifact immediately.** First inspect the current project context and talk with the user.
2. **Ask Clarifying Questions One at a Time:**
   - Use \`talk_with_user\` to ask the user specific questions about business rules, edge cases, formulas, and constraints.
   - Example questions for shipping/dev features:
     - How is the rate computed (fixed brackets vs linear price per kg)?
     - What are the minimum and maximum boundaries?
     - How does free shipping above R$ 200 interact with discounts/coupons (subtotal vs final total)?
3. **Propose 2-3 Approaches with Trade-offs:**
   - Offer concrete options and ask for the user's preference.
4. **User Confirmation:**
   - Present the summarized requirements and ask the user for explicit confirmation before writing the file.
5. **Write Artifact:**
   - Write the finalized brief to \`.shark/specs/${specId}/artifacts/brief.md\`.
   - Output MUST contain:
     - \`# Problem\`
     - \`# Scope\` (explicit In Scope and Out of Scope)
     - \`# Acceptance Criteria\` (testable scenarios)
   - ZERO placeholders (\`[TBD]\`, \`[TODO]\`).
${feedbackContent}
`;
    } else if (role === 'spike-tester') {
        const briefArtifact = state.artifacts.brief || `.shark/specs/${specId}/artifacts/brief.md`;
        const hypothesesList = (state.hypotheses && state.hypotheses.length > 0)
            ? state.hypotheses.map(h => `- [${h.id}] (${h.status}): ${h.statement}`).join('\n')
            : '- No explicit hypotheses registered yet.';
        briefContent = `${baseFrontmatter}# Subagent Task Brief: Spike Tester & Empirical Researcher
**Spec ID:** ${specId}
**Requirements Input:** \`${briefArtifact}\`
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/spikes.md\`

## Registered Hypotheses to Verify:
${hypothesesList}

## Instructions
1. Formulate minimal, standalone test scripts in scratch/ to test each hypothesis.
2. Run empirical executions in Node.js/Vitest to verify real-world behavior (e.g. floating point, API schemas, error handling).
3. Record confirmed/refuted results with concrete evidence in \`.shark/specs/${specId}/artifacts/spikes.md\`.
4. Output MUST contain:
   - \`# Empirical Spikes\`
   - \`# Hypotheses Evaluation\`
   - \`# Findings\`
${feedbackContent}
`;
    } else if (role === 'architect') {
        const briefArtifact = state.artifacts.brief || `.shark/specs/${specId}/artifacts/brief.md`;
        let spikesSection = '';
        if (state.hypotheses && state.hypotheses.length > 0) {
            spikesSection = `\n## 🔬 Confirmed Spikes & Empirical Evidence\nThe following technical hypotheses were validated empirically before architecture design:\n` +
                state.hypotheses.map(h => `- [${h.id}] **${h.status}**: ${h.statement}${h.evidence ? ` (Evidence: ${h.evidence})` : ''}`).join('\n') + '\n';
        }
        briefContent = `${baseFrontmatter}# Subagent Task Brief: System Architect
**Spec ID:** ${specId}
**Input Brief:** \`${briefArtifact}\`
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/design.md\`
${spikesSection}
## Instructions
1. Inspect the codebase for patterns, interfaces, and dependencies.
2. Define the architectural solution to satisfy the requirements.
3. Specify exact files to be created or modified.
4. Output MUST contain:
   - \`# Architecture\`
   - \`# Affected Files\`
   - \`# Interfaces and Data Contracts\`
5. Detail data structures, APIs, and error-handling paths.
${feedbackContent}
`;
    } else if (role === 'reviewer') {
        const designArtifact = state.artifacts.design || `.shark/specs/${specId}/artifacts/design.md`;
        briefContent = `${baseFrontmatter}# Subagent Task Brief: Red Team / Adversarial Reviewer
**Spec ID:** ${specId}
**Design Under Review:** \`${designArtifact}\`
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/critique.md\`

## Rubrica de Avaliacao e Sistema de Pontuacao (0 a 10.0)
Avalie a arquitetura atraves de 4 dimensoes objetivas somando no maximo 10.0 pontos:

1. **Arquitetura, Modularidade & Contratos (Max: 4.0 pontos)**
   - Modularidade e baixo acoplamento (1.0 pt)
   - Tipagem TypeScript estrita e schemas de validacao explicitos (1.5 pts)
   - Alinhamento rigoroso com padroes e utilitarios existentes na codebase (1.5 pts)

2. **Seguranca, Resiliencia & Error Boundaries (Max: 3.0 pontos)**
   - Ausencia de brechas criticas, memory leaks ou vazamento de segredos (1.5 pts)
   - Tratamento de excecoes, degradacao graciosa e timeouts explicitos (1.5 pts)

3. **Casos de Borda & Robustez Logica/Numerica (Max: 2.0 pontos)**
   - Limites numericos, divisao por zero, centavos e precisao IEEE-754 (1.0 pt)
   - Inputs vazios, nulos, strings longas ou caracteres especiais (1.0 pt)

4. **Testabilidade & Viabilidade TDD (Max: 1.0 ponto)**
   - Facilidade de isolamento e determinismo em testes unitarios/integrados (1.0 pt)

## O que Cada Faixa Representa (Tiers de Decisao)
- **Faixa 9.0 a 10.0 (EXCELENTE - PASS)**
  - *Significado:* Design impecavel, robusto e sem pendencias criticas.
  - *Veredito:* \`VERDICT: PASS\`
  - *Acao:* O gate e aprovado imediatamente para decomposicao.

- **Faixa 7.0 a 8.9 (BOM COM RESSALVAS - PASS WITH WARNINGS)**
  - *Significado:* Design viavel e solido. Apresenta pequenos casos de borda ou sugestoes defensivas que NAO justificam retrabalho de arquitetura, devendo ser cobertas como testes no plano TDD.
  - *Veredito:* \`VERDICT: PASS WITH WARNINGS\`
  - *Acao:* O gate e aprovado **SEM ROLLBACK**. As ressalvas (\`- [WARN-xx] ...\`) sao repassadas diretamente ao Lead Planner para criacao de testes especificos.

- **Faixa 0.0 a 6.9 (INSUFICIENTE / CRITICO - BLOCKER)**
  - *Significado:* Falhas estruturais graves, contradicoes insolveis, contratos quebrados ou vulnerabilidades que tornam a implementacao arriscada.
  - *Veredito:* \`VERDICT: BLOCKER: <motivo detalhado>\`
  - *Acao:* O gate e **BLOQUEADO**, disparando rollback para o Arquiteto corrigir o design.

## Instructions
1. Analise criticamente o documento \`${designArtifact}\` contra o codigo real do repositorio.
2. Seu output em \`.shark/specs/${specId}/artifacts/critique.md\` DEVE conter:
   - \`# Risk Analysis\` (Analise de riscos e modos de falha)
   - \`# Edge Cases\` (Casos de borda identificados)
   - \`# Score Breakdown\` (Tabela/lista com a pontuacao de cada uma das 4 dimensoes e nota total)
   - \`# Audit Verdict\` (Contendo \`SCORE: X.X/10\` e a linha de veredito: \`VERDICT: PASS\`, \`VERDICT: PASS WITH WARNINGS\`, ou \`VERDICT: BLOCKER: <motivo>\`)
3. Se houver ressalvas na faixa 7.0-8.9, liste cada uma como \`- [WARN-xx] <descricao>\`.
`;
    } else if (role === 'planner') {
        const designArtifact = state.artifacts.design || `.shark/specs/${specId}/artifacts/design.md`;
        let warningsSection = '';
        if (state.auditWarnings && state.auditWarnings.length > 0) {
            const scoreDisplay = state.auditScore ? ` (Audit Score: ${state.auditScore}/10)` : '';
            warningsSection = `\n## ⚠️ Reviewer Warnings & Non-Blocking Observations${scoreDisplay}\nThe reviewer passed the architecture with the following non-blocking warnings. Address them as tests or defensive guards in the TDD plan:\n` +
                state.auditWarnings.map(w => `- ${w}`).join('\n') + '\n';
        }
        briefContent = `${baseFrontmatter}# Subagent Task Brief: Lead Planner (TDD Decomposition)
**Spec ID:** ${specId}
**Approved Design:** \`${designArtifact}\`
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/plan.md\`
${warningsSection}
## Instructions
1. Decompose the architecture into bite-sized, sequential tasks (2-5 minutes each).
2. Follow strict TDD: each task must specify failing test, implementation, verification command, and commit.
3. Output MUST contain:
   - \`# Implementation Plan\`
   - Tasks numbered sequentially: \`### Task 1: ...\`, \`### Task 2: ...\`
4. Format must be 100% ready for 'subagent-driven-development-lite'.
`;
    } else if (role === 'plan-auditor') {
        const briefArtifact = state.artifacts.brief || `.shark/specs/${specId}/artifacts/brief.md`;
        const designArtifact = state.artifacts.design || `.shark/specs/${specId}/artifacts/design.md`;
        const planArtifact = state.artifacts.plan || `.shark/specs/${specId}/artifacts/plan.md`;
        briefContent = `${baseFrontmatter}# Subagent Task Brief: Plan Quality & Traceability Auditor
**Spec ID:** ${specId}
**Requirements Brief:** \`${briefArtifact}\`
**Approved Design:** \`${designArtifact}\`
**Plan Under Audit:** \`${planArtifact}\`
**Target Output Artifact:** \`.shark/specs/${specId}/artifacts/plan-critique.md\`

## Rubrica de Avaliacao e Sistema de Pontuacao (0 a 10.0)
Avalie o plano de implementacao atraves de 4 dimensoes objetivas somando no maximo 10.0 pontos:

1. **Cobertura de Requisitos & Contratos (Max: 4.0 pontos)**
   - Mapeamento 1:1 de todos os Criterios de Aceitacao de \`brief.md\` em tarefas com testes (2.0 pts)
   - Todos os schemas, tipos e error boundaries de \`design.md\` contemplados nas tarefas (2.0 pts)

2. **Rigor TDD & Determinismo (Max: 3.0 pontos)**
   - Cada tarefa especifica o teste que falha primeiro, assercoes objetivas e comando de verificacao (ex: \`npm test\`) (2.0 pts)
   - Ausencia de tarefas sem testes ou que acumulam codigo sem validacao (1.0 pt)

3. **Sequenciamento & Atomicidade (Max: 2.0 pontos)**
   - Ordem estritamente sequencial sem forward-references (tarefa N nao depende da tarefa N+1) (1.0 pt)
   - Granularidade atomica (2 a 5 minutos por tarefa) (1.0 pt)

4. **Realismo de Arquivos & Padroes (Max: 1.0 ponto)**
   - Caminhos de arquivos criados/editados aderentes a codebase existente e convencoes do repo (1.0 pt)

## O que Cada Faixa Representa (Tiers de Decisao)
- **Faixa 9.0 a 10.0 (EXCELENTE - PASS)**
  - *Significado:* Plano impecavel, cobertura total e TDD rigoroso.
  - *Veredito:* \`VERDICT: PASS\`
  - *Acao:* Aprovado imediatamente para execucao no worktree.

- **Faixa 7.0 a 8.9 (VIAVEL COM RESSALVAS - PASS WITH WARNINGS)**
  - *Significado:* Plano solido e seguro para execucao. Apresenta apenas pequenas sugestoes de melhoria ou assercoes extras que NAO justificam reescrever o plano.
  - *Veredito:* \`VERDICT: PASS WITH WARNINGS\`
  - *Acao:* Aprovado **SEM ROLLBACK**. As ressalvas (\`- [WARN-xx] ...\`) sao anotadas para orientar os desenvolvedores.

- **Faixa 0.0 a 6.9 (INSUFICIENTE / CRITICO - BLOCKER)**
  - *Significado:* O plano ignora criterios vitais, pula testes TDD essenciais ou possui dependencias circulares.
  - *Veredito:* \`VERDICT: BLOCKER: <motivo detalhado>\`
  - *Acao:* O gate e **BLOQUEADO**, disparando rollback para o Lead Planner corrigir o plano.

## Instructions
1. Audite o plano \`${planArtifact}\` cruzando com \`${briefArtifact}\` e \`${designArtifact}\`.
2. Seu output em \`.shark/specs/${specId}/artifacts/plan-critique.md\` DEVE conter:
   - \`# Plan Audit\` (Avaliacao geral de viabilidade e qualidade)
   - \`# Coverage Matrix\` (Matriz mapeando cada AC e regra do design a uma Tarefa)
   - \`# Dependency & Order Review\` (Analise de sequenciamento e seguranca de dependencias)
   - \`# Score Breakdown\` (Tabela/lista com pontuacao das 4 dimensoes e nota total)
   - \`# Audit Verdict\` (Contendo \`SCORE: X.X/10\` e a linha de veredito: \`VERDICT: PASS\`, \`VERDICT: PASS WITH WARNINGS\`, ou \`VERDICT: BLOCKER: <motivo>\`)
3. Se houver ressalvas na faixa 7.0-8.9, liste cada uma como \`- [WARN-xx] <descricao>\`.
${feedbackContent}
`;
    }

    fs.writeFileSync(briefFile, briefContent, 'utf8');
    console.log(`\n✔ [SPEC-CTL] Brief successfully generated for '${role}' at:`);
    console.log(`📄 ${briefFile}`);
    console.log(`\n[INSTRUCTION] Dispatch the ${role} subagent with role: "${role}" and task_file: "${briefFile}".`);
}

function runValidation(specId, nodeDef, artifactOverride) {
    const state = loadState(specId);
    const artifactRel = artifactOverride || state.artifacts[nodeDef.defaultArtifact.replace('.md', '')] || `.shark/specs/${specId}/artifacts/${nodeDef.defaultArtifact}`;
    const artifactPath = path.resolve(artifactRel);

    const errors = [];
    const warnings = [];

    if (nodeDef.id === 'CONTEXT_GROUNDING') {
        if (!fs.existsSync(artifactPath) && (!state.groundingSources || state.groundingSources.length === 0)) {
            fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
            fs.writeFileSync(artifactPath, `# Context Pack\nNo external grounding sources registered. Direct elicitation mode.\n\n## 1. Regras de Negocio\n- Requirements will be gathered via interactive dialogue in DISCOVERY_ELICITATION.\n\n## 2. Matriz de Conflitos\n- No pre-existing sources to compare.\n\n## 3. Perguntas Chave\n- Proceed to analyst interview.\n`, 'utf8');
        }
    }

    if (nodeDef.id === 'HYPOTHESIS_SPIKES') {
        if (state.hypotheses && state.hypotheses.some(h => h.status === 'PENDING')) {
            const pendingList = state.hypotheses.filter(h => h.status === 'PENDING').map(h => h.id).join(', ');
            errors.push(`Pending hypotheses detected: [${pendingList}]. All hypotheses must be resolved before proceeding. Run 'node spec-ctl.mjs hypothesis resolve --hId <id> --status <CONFIRMED|REFUTED>'.`);
        }
        if (!fs.existsSync(artifactPath) && (!state.hypotheses || state.hypotheses.length === 0)) {
            fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
            fs.writeFileSync(artifactPath, `# Empirical Spikes\nNo empirical spikes were required for this spec.\n# Hypotheses Evaluation\nNo hypotheses registered.\n# Findings\nDirect transition to Technical Architecture.\n`, 'utf8');
        }
    }

    if (!fs.existsSync(artifactPath)) {
        errors.push(`Artifact file not found: ${artifactRel}`);
        return { ok: false, errors, warnings, artifactRel };
    }

    const content = fs.readFileSync(artifactPath, 'utf8');

    // 1. Check for forbidden placeholders
    const placeholders = ['[TBD]', '[TODO]', 'TODO:', 'FIXME', 'TBD'];
    for (const ph of placeholders) {
        if (content.includes(ph)) {
            errors.push(`Unresolved placeholder '${ph}' detected in artifact.`);
        }
    }

    // 2. Check required sections
    for (const sec of nodeDef.requiredSections) {
        if (!content.toLowerCase().includes(sec.toLowerCase())) {
            errors.push(`Missing mandatory section: '${sec}'`);
        }
    }

    // 3. Specific Node-Level Validations
    if (nodeDef.id === 'ADVERSARIAL_CRITIQUE') {
        const scoreMatch = content.match(/SCORE:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

        const hasPassWithWarnings = content.includes('VERDICT: PASS WITH WARNINGS');
        const hasPass = content.includes('VERDICT: PASS');
        const hasBlocker = content.includes('VERDICT: BLOCKER');

        if (score !== null) {
            state.auditScore = score;
            saveState(specId, state);

            if (score < 7.0) {
                const blockerLine = content.split('\n').find(l => l.includes('VERDICT: BLOCKER')) || `Score is ${score}/10 (Threshold is 7.0/10)`;
                errors.push(`Gate validation blocked: Red Team evaluated design with score ${score}/10 (below minimum 7.0). Details: ${blockerLine.trim()}. Design must be revised via rollback.`);
            } else {
                // Score >= 7.0: Passes directly or with warnings
                const extractedWarnings = [];
                const warnMatches = content.match(/\[(?:WARN|WARNING)[^\]]*\][^\n]+/gi);
                if (warnMatches) {
                    extractedWarnings.push(...warnMatches);
                } else {
                    const lines = content.split('\n');
                    const verdictIdx = lines.findIndex(l => l.includes('VERDICT:'));
                    if (verdictIdx !== -1) {
                        for (let i = verdictIdx + 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (line.startsWith('#')) break;
                            if (line.startsWith('-') || line.startsWith('*')) {
                                extractedWarnings.push(line.replace(/^[-*]\s*/, ''));
                            }
                        }
                    }
                }

                if (score < 9.0 && extractedWarnings.length === 0) {
                    extractedWarnings.push(`Score ${score}/10: Design approved with non-blocking reservations. Review critique.md for recommendations.`);
                }

                if (extractedWarnings.length > 0) {
                    state.auditWarnings = extractedWarnings;
                    saveState(specId, state);
                    for (const w of extractedWarnings) {
                        warnings.push(w);
                    }
                }
            }
        } else {
            // Backward compatibility when no numerical score is declared
            if (!hasPass && !hasBlocker) {
                errors.push(`Missing explicit verdict in critique. Expected 'SCORE: <X.X>/10' and 'VERDICT: PASS', 'VERDICT: PASS WITH WARNINGS', or 'VERDICT: BLOCKER: <reason>'.`);
            } else if (hasBlocker) {
                const blockerLine = content.split('\n').find(l => l.includes('VERDICT: BLOCKER')) || 'VERDICT: BLOCKER';
                errors.push(`Gate validation blocked: Red Team concluded with ${blockerLine.trim()}. Design must be revised via rollback.`);
            } else if (hasPassWithWarnings) {
                const lines = content.split('\n');
                const verdictIdx = lines.findIndex(l => l.includes('VERDICT: PASS WITH WARNINGS'));
                const extractedWarnings = [];
                for (let i = verdictIdx + 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('#')) break;
                    if (line.startsWith('-') || line.startsWith('*')) {
                        extractedWarnings.push(line.replace(/^[-*]\s*/, ''));
                    }
                }
                if (extractedWarnings.length === 0) {
                    const warnMatches = content.match(/\[(?:WARN|WARNING)[^\]]*\][^\n]+/gi);
                    if (warnMatches) {
                        extractedWarnings.push(...warnMatches);
                    }
                }
                state.auditWarnings = extractedWarnings;
                saveState(specId, state);
                for (const w of extractedWarnings) {
                    warnings.push(w);
                }
            }
        }
    }

    if (nodeDef.id === 'TDD_PLAN_DECOMPOSITION') {
        if (!content.includes('test') && !content.includes('Test')) {
            warnings.push(`Plan does not appear to emphasize TDD tests explicitly.`);
        }
    }

    if (nodeDef.id === 'PLAN_AUDIT') {
        const scoreMatch = content.match(/SCORE:\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i);
        const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

        const hasPassWithWarnings = content.includes('VERDICT: PASS WITH WARNINGS');
        const hasPass = content.includes('VERDICT: PASS');
        const hasBlocker = content.includes('VERDICT: BLOCKER');

        if (score !== null) {
            state.planAuditScore = score;
            saveState(specId, state);

            if (score < 7.0) {
                const blockerLine = content.split('\n').find(l => l.includes('VERDICT: BLOCKER')) || `Plan Score is ${score}/10 (Threshold is 7.0/10)`;
                errors.push(`Gate validation blocked: Plan Auditor evaluated plan with score ${score}/10 (below minimum 7.0). Details: ${blockerLine.trim()}. Plan must be revised via rollback.`);
            } else {
                // Score >= 7.0: Passes directly or with warnings
                const extractedWarnings = [];
                const warnMatches = content.match(/\[(?:WARN|WARNING)[^\]]*\][^\n]+/gi);
                if (warnMatches) {
                    extractedWarnings.push(...warnMatches);
                } else {
                    const lines = content.split('\n');
                    const verdictIdx = lines.findIndex(l => l.includes('VERDICT:'));
                    if (verdictIdx !== -1) {
                        for (let i = verdictIdx + 1; i < lines.length; i++) {
                            const line = lines[i].trim();
                            if (line.startsWith('#')) break;
                            if (line.startsWith('-') || line.startsWith('*')) {
                                extractedWarnings.push(line.replace(/^[-*]\s*/, ''));
                            }
                        }
                    }
                }

                if (score < 9.0 && extractedWarnings.length === 0) {
                    extractedWarnings.push(`Score ${score}/10: Plan approved with non-blocking reservations.`);
                }

                if (extractedWarnings.length > 0) {
                    state.planAuditWarnings = extractedWarnings;
                    saveState(specId, state);
                    for (const w of extractedWarnings) {
                        warnings.push(w);
                    }
                }
            }
        } else {
            // Backward compatibility when no numerical score is declared
            if (!hasPass && !hasBlocker) {
                errors.push(`Missing explicit verdict in plan critique. Expected 'SCORE: <X.X>/10' and 'VERDICT: PASS', 'VERDICT: PASS WITH WARNINGS', or 'VERDICT: BLOCKER: <reason>'.`);
            } else if (hasBlocker) {
                const blockerLine = content.split('\n').find(l => l.includes('VERDICT: BLOCKER')) || 'VERDICT: BLOCKER';
                errors.push(`Gate validation blocked: Plan Auditor concluded with ${blockerLine.trim()}. Plan must be revised via rollback.`);
            } else if (hasPassWithWarnings) {
                warnings.push(`Plan approved with non-blocking auditor warnings.`);
            }
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        artifactRel,
        content
    };
}

function cmdValidate(specIdArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }

    const state = loadState(specId);
    const nodeDef = NODES[state.currentNode];
    if (!nodeDef || !nodeDef.defaultArtifact) {
        console.log(`[INFO] Current node ${state.currentNode} requires no artifact validation.`);
        return;
    }

    console.log(`\n🔍 Validating Gate Criteria for: [${nodeDef.index}/6] ${nodeDef.title}...`);
    const result = runValidation(specId, nodeDef);

    if (!result.ok) {
        console.error(`\n❌ Gate Validation FAILED:`);
        for (const err of result.errors) console.error(`  - ${err}`);
        if (result.warnings.length) {
            for (const w of result.warnings) console.warn(`  ⚠️ ${w}`);
        }
        console.log(`\n[INSTRUCTION] Have the ${nodeDef.role} subagent resolve the errors in ${result.artifactRel} before attempting to transition.`);
        process.exit(1);
    } else {
        console.log(`\n✔ Gate Validation PASSED! All mandatory sections and zero placeholders confirmed.`);
        if (result.warnings.length) {
            for (const w of result.warnings) console.warn(`  ⚠️ Warning: ${w}`);
        }
        console.log(`[INSTRUCTION] You may now run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs transition --next' to advance the graph.`);
    }
}

function cmdTransition(specIdArg, options = {}) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }

    const state = loadState(specId);
    const currentNodeDef = NODES[state.currentNode];

    if (!currentNodeDef || !currentNodeDef.next) {
        console.error(`[ERROR] Cannot transition from current node: ${state.currentNode}`);
        process.exit(1);
    }

    if (state.status === 'CIRCUIT_BREAKER_TRIGGERED') {
        console.error(`\n❌ Transition BLOCKED: Circuit Breaker is active (5 rollbacks reached).`);
        console.error(`Human intervention is required before the graph can proceed.`);
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs intervene --decision "<resolution>"' to unlock.`);
        process.exit(1);
    }

    // Auto-run Gate Validation before transition
    const valResult = runValidation(specId, currentNodeDef, options.evidence);
    if (!valResult.ok) {
        console.error(`\n❌ Transition BLOCKED by Gate Validation:`);
        for (const err of valResult.errors) console.error(`  - ${err}`);
        console.log(`\n[INSTRUCTION] Fix artifact issues first before transitioning.`);
        process.exit(1);
    }

    // Special check for Red Team critique and Plan Audit verdicts
    if (currentNodeDef.id === 'ADVERSARIAL_CRITIQUE' || currentNodeDef.id === 'PLAN_AUDIT') {
        if (valResult.content.includes('VERDICT: BLOCKER')) {
            const targetNode = currentNodeDef.id === 'PLAN_AUDIT' ? 'TDD_PLAN_DECOMPOSITION' : 'TECHNICAL_ARCHITECTURE';
            console.error(`\n❌ Transition BLOCKED: ${currentNodeDef.role} concluded with VERDICT: BLOCKER!`);
            console.log(`[INSTRUCTION] You MUST execute a rollback to ${targetNode} using 'node skills/spec-driven-graph/scripts/spec-ctl.mjs rollback --to ${targetNode} --reason "<reason>"'.`);
            process.exit(1);
        }
    }

    // Register artifact into state
    const artifactKey = currentNodeDef.defaultArtifact.replace('.md', '');
    state.artifacts[artifactKey] = valResult.artifactRel;

    const nextNodeId = options.to || currentNodeDef.next;
    const prevNodeId = state.currentNode;
    state.currentNode = nextNodeId;
    state.history.push({
        fromNode: prevNodeId,
        toNode: nextNodeId,
        action: 'TRANSITIONED',
        artifact: valResult.artifactRel,
        timestamp: new Date().toISOString()
    });

    if (state.iterations[nextNodeId] !== undefined) {
        state.iterations[nextNodeId] = (state.iterations[nextNodeId] || 0) + 1;
    }

    saveState(specId, state);

    console.log(`\n======================================================`);
    console.log(`✔ [GRAPH TRANSITION SUCCESS]`);
    console.log(`  ${prevNodeId} ➔ ${nextNodeId}`);
    console.log(`======================================================`);

    if (nextNodeId === 'READY_FOR_EXECUTION') {
        console.log(`🎉 Specification Pipeline reached READY_FOR_EXECUTION!`);
        console.log(`[INSTRUCTION] 🛑 MANDATORY HUMAN CHECKPOINT: DO NOT call complete_task silently!`);
        console.log(`Use 'talk_with_user' to present the approved plan summary and ask the user if they wish to start code implementation via 'graph-driven-execution' now.`);
    } else {
        const nextDef = NODES[nextNodeId];
        console.log(`Current Node: [${nextDef.index}/6] ${nextDef.title}`);
        console.log(`Assigned Subagent: ${nextDef.role}`);
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs brief ${nextDef.role}' and dispatch the ${nextDef.role} subagent.`);
    }
}

function cmdRollback(specIdArg, targetNodeArg, reason, evidence) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }

    const state = loadState(specId);
    const fromNode = state.currentNode;

    // Smart default: if targetNode is omitted, roll back to previous node
    const targetNode = targetNodeArg || NODES[fromNode]?.prev;

    if (!targetNode || !NODES[targetNode]) {
        console.error(`[ERROR] Invalid rollback target node. Choices: ${Object.keys(NODES).join(', ')}`);
        process.exit(1);
    }

    if (!reason) {
        console.error(`[ERROR] Rollback requires --reason "<explanation of failure or blocker>"`);
        process.exit(1);
    }

    const targetDef = NODES[targetNode];

    // Purge obsolete downstream artifacts both on disk and in state
    for (const [nodeId, def] of Object.entries(NODES)) {
        if (def.index > targetDef.index && def.defaultArtifact) {
            const artifactKey = def.defaultArtifact.replace('.md', '');
            const candidates = [
                state.artifacts?.[artifactKey],
                path.join('.shark', 'specs', specId, 'artifacts', def.defaultArtifact)
            ].filter(Boolean);

            for (const relPath of candidates) {
                const fullPath = path.resolve(relPath);
                if (fs.existsSync(fullPath)) {
                    try {
                        fs.unlinkSync(fullPath);
                        console.log(`🧹 [CLEANUP] Removed obsolete downstream artifact: ${relPath}`);
                    } catch (e) {
                        console.warn(`⚠️ Could not remove artifact ${fullPath}: ${e.message}`);
                    }
                }
            }
            if (state.artifacts && state.artifacts[artifactKey]) {
                state.artifacts[artifactKey] = null;
            }
        }
    }

    state.currentNode = targetNode;
    state.rollbacksCount = (state.rollbacksCount || 0) + 1;

    // Human Circuit Breaker check (trigger at 5 rollbacks)
    if (state.rollbacksCount >= 5) {
        state.status = 'CIRCUIT_BREAKER_TRIGGERED';
    }

    state.history.push({
        fromNode,
        toNode: targetNode,
        action: 'ROLLBACK',
        reason,
        timestamp: new Date().toISOString()
    });

    appendFeedback(specId, {
        fromNode,
        toNode: targetNode,
        reason,
        evidence: evidence || null
    });

    saveState(specId, state);

    console.log(`\n======================================================`);
    console.log(`⚠️ [GRAPH ROLLBACK EXECUTED] (Cycle #${state.rollbacksCount})`);
    console.log(`  ${fromNode} ↩ ${targetNode}`);
    console.log(`  Reason: ${reason}`);
    console.log(`======================================================`);

    if (state.status === 'CIRCUIT_BREAKER_TRIGGERED') {
        console.log(`\n🚨 [CIRCUIT BREAKER TRIGGERED] 5 rollbacks reached!`);
        console.log(`Autonomous execution is PAUSED. Human decision required to proceed.`);
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs intervene --decision "<human resolution>"' to unblock.`);
    } else {
        console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/spec-ctl.mjs brief ${targetDef.role}' to regenerate the brief with the rollback audit notes, then re-dispatch ${targetDef.role}.`);
    }
}

function cmdIntervene(specIdArg, decision) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }
    if (!decision) {
        console.error("[ERROR] Intervene requires --decision \"<human decision/override>\"");
        process.exit(1);
    }

    const state = loadState(specId);
    state.status = 'IN_PROGRESS';
    state.history.push({
        node: state.currentNode,
        action: 'HUMAN_INTERVENTION',
        decision,
        timestamp: new Date().toISOString()
    });
    appendFeedback(specId, {
        type: 'HUMAN_INTERVENTION',
        node: state.currentNode,
        decision
    });
    saveState(specId, state);

    console.log(`\n======================================================`);
    console.log(`✔ [INTERVENTION RECORDED] Circuit breaker reset to IN_PROGRESS.`);
    console.log(`  Decision: "${decision}"`);
    console.log(`======================================================`);
    console.log(`[INSTRUCTION] Graph unlocked. You may now continue execution or run 'transition --next'.`);
}

function cmdSourceAdd(specIdArg, type, origin) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }
    if (!type || !origin) {
        console.error("[ERROR] Usage: spec-ctl source add --type <transcript|url|code|doc> --origin <path_or_url>");
        process.exit(1);
    }

    const state = loadState(specId);
    if (!state.groundingSources) state.groundingSources = [];
    state.groundingSources.push({
        type,
        origin,
        addedAt: new Date().toISOString()
    });
    saveState(specId, state);
    console.log(`\n✔ [GROUNDING SOURCE REGISTERED] [${type}] ${origin}`);
}

function cmdHypothesisAdd(specIdArg, hId, statement) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }
    if (!hId || !statement) {
        console.error("[ERROR] Usage: spec-ctl hypothesis add --hId <id> --statement \"<text>\"");
        process.exit(1);
    }

    const state = loadState(specId);
    if (!state.hypotheses) state.hypotheses = [];
    const existing = state.hypotheses.find(h => h.id === hId);
    if (existing) {
        existing.statement = statement;
        existing.status = 'PENDING';
    } else {
        state.hypotheses.push({
            id: hId,
            statement,
            status: 'PENDING',
            addedAt: new Date().toISOString()
        });
    }
    saveState(specId, state);
    console.log(`\n✔ [HYPOTHESIS REGISTERED] [${hId}] PENDING: "${statement}"`);
}

function cmdHypothesisResolve(specIdArg, hId, status, evidence) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }
    if (!hId || !status) {
        console.error("[ERROR] Usage: spec-ctl hypothesis resolve --hId <id> --status <CONFIRMED|REFUTED> [--evidence \"...\"]");
        process.exit(1);
    }

    const state = loadState(specId);
    if (!state.hypotheses) state.hypotheses = [];
    const item = state.hypotheses.find(h => h.id === hId);
    if (!item) {
        console.error(`[ERROR] Hypothesis '${hId}' not found in spec state.`);
        process.exit(1);
    }
    item.status = status;
    item.evidence = evidence || null;
    item.resolvedAt = new Date().toISOString();
    saveState(specId, state);
    console.log(`\n✔ [HYPOTHESIS RESOLVED] [${hId}] ${status}: "${item.statement}"`);
}

function cmdExport(specIdArg, outArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active spec found.");
        process.exit(1);
    }

    const state = loadState(specId);
    const planArtifact = state.artifacts.plan || path.join(getSpecDir(specId), 'artifacts', 'plan.md');

    if (!fs.existsSync(planArtifact)) {
        console.error(`[ERROR] Plan artifact does not exist: ${planArtifact}`);
        process.exit(1);
    }

    const today = new Date().toISOString().slice(0, 10);
    const defaultOut = path.resolve('docs', 'superpowers', 'plans', `${today}-${specId}.md`);
    const outPath = outArg ? path.resolve(outArg) : defaultOut;

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(planArtifact, outPath);

    console.log(`\n======================================================`);
    console.log(`✔ [EXPORT SUCCESS] Implementation plan ready!`);
    console.log(`📁 Destination: ${outPath}`);
    console.log(`======================================================`);
    console.log(`[INSTRUCTION] Implementation ready. You can now invoke the 'subagent-driven-development-lite' skill pointing to:\n${outPath}`);
}

// --- Main CLI Argument Parser ---
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
spec-ctl.mjs - Centralized Graph Controller for Spec-Driven Graph

Commands:
  init <id> [--title "Title"]                        Initialize a new specification graph
  status [--spec <id>]                               Check current graph node and instructions
  brief [--spec <id>] [role]                         Generate isolated brief for current subagent
  validate [--spec <id>]                             Validate gate criteria of active node
  transition [--spec <id>] [--next | --to <node>]    Advance graph to next state (verifies gates)
  rollback [--spec <id>] [--to <node>] --reason ".." Return to prior node on critical flaws
  intervene [--spec <id>] --decision "..."           Reset human circuit breaker with decision
  source add [--spec <id>] --type <type> --origin .. Register background context source (transcript/url/code)
  hypothesis add [--spec <id>] --statement "..."    Register an empirical hypothesis
  export [--spec <id>] [--out <path>]                Export finalized plan to superpowers/plans/
  handoff [--spec <id>]                              Automated transition of ready spec to execution worktree
  dashboard [--port <port>]                          Launch Real-Time Web Dashboard UI (default: 3333)
`);
        return;
    }

    const command = args[0];
    const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : null;
    };
    const hasFlag = (flag) => args.includes(flag);

    const specFromFlag = getArg('--spec');

    switch (command) {
        case 'init': {
            const specId = args[1] && !args[1].startsWith('--') ? args[1] : null;
            const title = getArg('--title');
            cmdInit(specId, title);
            break;
        }
        case 'status': {
            cmdStatus(specFromFlag);
            break;
        }
        case 'brief': {
            const role = args[1] && !args[1].startsWith('--') ? args[1] : null;
            cmdBrief(specFromFlag, role);
            break;
        }
        case 'validate': {
            cmdValidate(specFromFlag);
            break;
        }
        case 'transition': {
            const to = getArg('--to');
            const evidence = getArg('--evidence');
            cmdTransition(specFromFlag, { to, evidence });
            break;
        }
        case 'rollback': {
            const to = getArg('--to');
            const reason = getArg('--reason');
            const evidence = getArg('--evidence');
            cmdRollback(specFromFlag, to, reason, evidence);
            break;
        }
        case 'intervene': {
            const decision = getArg('--decision');
            cmdIntervene(specFromFlag, decision);
            break;
        }
        case 'source': {
            const subAction = args[1] && !args[1].startsWith('--') ? args[1] : null;
            if (subAction === 'add') {
                const type = getArg('--type');
                const origin = getArg('--origin');
                cmdSourceAdd(specFromFlag, type, origin);
            } else {
                console.error("[ERROR] Usage: spec-ctl source add --type <transcript|url|code|doc> --origin <path_or_url>");
                process.exit(1);
            }
            break;
        }
        case 'hypothesis': {
            const subAction = args[1] && !args[1].startsWith('--') ? args[1] : null;
            if (subAction === 'add') {
                const statement = getArg('--statement');
                const hId = getArg('--hId');
                cmdHypothesisAdd(specFromFlag, hId, statement);
            } else if (subAction === 'resolve') {
                const hId = getArg('--hId');
                const status = getArg('--status');
                const evidence = getArg('--evidence');
                cmdHypothesisResolve(specFromFlag, hId, status, evidence);
            } else {
                console.error("[ERROR] Usage: spec-ctl hypothesis <add|resolve> ...");
                process.exit(1);
            }
            break;
        }
        case 'export': {
            const out = getArg('--out');
            cmdExport(specFromFlag, out);
            break;
        }
        case 'handoff': {
            const epicCtlPath = path.join(path.dirname(process.argv[1]), 'epic-ctl.mjs');
            try {
                execSync(`node "${epicCtlPath}" handoff --spec ${specFromFlag || ''}`, { stdio: 'inherit' });
            } catch (err) {
                console.error(`Handoff exit: ${err.message}`);
            }
            break;
        }
        case 'dashboard': {
            const port = getArg('--port') || 3333;
            const dashboardScript = path.join(path.dirname(process.argv[1]), 'graph-dashboard.mjs');
            try {
                execSync(`node "${dashboardScript}" --port ${port}`, { stdio: 'inherit' });
            } catch (err) {
                console.error(`Dashboard exit: ${err.message}`);
            }
            break;
        }
        default:
            console.error(`Unknown command: '${command}'. Run with no arguments to see help.`);
            process.exit(1);
    }
}

main();
