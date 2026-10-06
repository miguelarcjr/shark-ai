#!/usr/bin/env node
/**
 * exec-ctl.mjs - Centralized Graph Controller CLI for Graph-Driven Execution
 * 
 * Strict TDD, git worktree isolation, deterministic machine gates,
 * and adversarial code review loops for critical implementations.
 * 
 * Usage:
 *   node exec-ctl.mjs init [--spec <spec-id>] [--plan <path>]
 *   node exec-ctl.mjs status [--spec <spec-id>]
 *   node exec-ctl.mjs brief [--spec <spec-id>] [role]
 *   node exec-ctl.mjs verify [--spec <spec-id>] <red|green|lint|review>
 *   node exec-ctl.mjs transition [--spec <spec-id>] [--next]
 *   node exec-ctl.mjs rollback [--spec <spec-id>] --to <node> --reason "<text>"
 *   node exec-ctl.mjs finish [--spec <spec-id>] [--merge]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const TASK_NODES = {
    WORKTREE_SETUP: {
        id: 'WORKTREE_SETUP',
        index: 0,
        title: 'Git Worktree Isolation & Dependency Check',
        role: null,
        next: 'RED_TEST',
        prev: null,
    },
    RED_TEST: {
        id: 'RED_TEST',
        index: 1,
        title: 'TDD RED: Failing Test & Failure Proof',
        role: 'tdd-dev',
        next: 'GREEN_CODE',
        prev: null,
    },
    GREEN_CODE: {
        id: 'GREEN_CODE',
        index: 2,
        title: 'TDD GREEN: Minimal Implementation',
        role: 'tdd-dev',
        next: 'LINT_TYPECHECK',
        prev: 'RED_TEST',
    },
    LINT_TYPECHECK: {
        id: 'LINT_TYPECHECK',
        index: 3,
        title: 'Static Typecheck & Lint Enforcement',
        role: null,
        next: 'ADVERSARIAL_REVIEW',
        prev: 'GREEN_CODE',
    },
    ADVERSARIAL_REVIEW: {
        id: 'ADVERSARIAL_REVIEW',
        index: 4,
        title: 'Adversarial Code Review & Security Audit',
        role: 'code-reviewer',
        next: 'ATOMIC_COMMIT',
        prev: 'GREEN_CODE',
    },
    ATOMIC_COMMIT: {
        id: 'ATOMIC_COMMIT',
        index: 5,
        title: 'Atomic Git Commit & Clean Tree Verification',
        role: null,
        next: 'NEXT_TASK_OR_FINISH',
        prev: 'ADVERSARIAL_REVIEW',
    },
    READY_FOR_MERGE: {
        id: 'READY_FOR_MERGE',
        index: 6,
        title: 'Full Suite Verification & Clean Merge Handoff',
        role: null,
        next: null,
        prev: 'ATOMIC_COMMIT',
    }
};

const SHARK_SPECS_DIR = path.resolve('.shark', 'specs');
const SHARK_WORKTREES_DIR = path.resolve('.shark', 'worktrees');

// --- Helper Functions ---
function getSpecDir(specId) {
    return path.join(SHARK_SPECS_DIR, specId);
}

function getExecutionPath(specId) {
    return path.join(getSpecDir(specId), 'execution.json');
}

function findActiveSpecId() {
    if (!fs.existsSync(SHARK_SPECS_DIR)) return null;
    const entries = fs.readdirSync(SHARK_SPECS_DIR, { withFileTypes: true });
    const specDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (specDirs.length === 0) return null;
    if (specDirs.length === 1) return specDirs[0];

    let latestSpec = null;
    let latestMtime = 0;
    for (const id of specDirs) {
        const execFile = getExecutionPath(id);
        const stateFile = path.join(getSpecDir(id), 'state.json');
        const target = fs.existsSync(execFile) ? execFile : (fs.existsSync(stateFile) ? stateFile : null);
        if (target) {
            const mtime = fs.statSync(target).mtimeMs;
            if (mtime > latestMtime) {
                latestMtime = mtime;
                latestSpec = id;
            }
        }
    }
    return latestSpec;
}

function loadExecutionState(specId) {
    const execFile = getExecutionPath(specId);
    if (!fs.existsSync(execFile)) {
        console.error(`[ERROR] Execution state not found: ${execFile}. Run 'init' first.`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(execFile, 'utf8'));
}

function saveExecutionState(specId, state) {
    const specDir = getSpecDir(specId);
    fs.mkdirSync(specDir, { recursive: true });
    state.updated = new Date().toISOString();
    fs.writeFileSync(getExecutionPath(specId), JSON.stringify(state, null, 2), 'utf8');
}

function runInWorktree(worktreePath, cmd) {
    try {
        return execSync(cmd, {
            cwd: path.resolve(worktreePath),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
    } catch (err) {
        const error = new Error(`Command failed: ${cmd}\n${err.stderr || err.stdout || err.message}`);
        error.stdout = err.stdout;
        error.stderr = err.stderr;
        error.status = err.status;
        throw error;
    }
}

function parsePlanTasks(planContent) {
    const tasks = [];
    const taskRegex = /### Task\s+(\d+):\s*([^\n\r]+)/gi;
    let match;
    const matches = [];

    while ((match = taskRegex.exec(planContent)) !== null) {
        matches.push({
            index: parseInt(match[1], 10),
            title: match[2].trim(),
            startPos: match.index
        });
    }

    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const nextPos = (i + 1 < matches.length) ? matches[i + 1].startPos : planContent.length;
        const taskBody = planContent.slice(current.startPos, nextPos).trim();

        // Extract files mentioned
        const filesMentioned = [];
        const fileMatches = taskBody.match(/(?:src\/|test\/|\.\/)[a-zA-Z0-9_\-\.\/]+\.(?:ts|js|json|css|html)/g) || [];
        for (const f of fileMatches) {
            const clean = f.replace(/^\.\//, '');
            if (!filesMentioned.includes(clean)) filesMentioned.push(clean);
        }

        // Extract test command if present
        let testCmd = 'npm test';
        const cmdMatch = taskBody.match(/```bash[\r\n]+(npm test[^\r\n]*)[\r\n]+```/i);
        if (cmdMatch) {
            testCmd = cmdMatch[1].trim();
        }

        tasks.push({
            id: `task-${current.index}`,
            taskNumber: current.index,
            title: current.title,
            status: 'PENDING',
            content: taskBody,
            allowedFiles: filesMentioned,
            testCmd,
            commitHash: null,
            evidence: {}
        });
    }

    return tasks;
}

// --- Commands ---

function cmdInit(specIdArg, planArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No spec specified and none found. Usage: node exec-ctl.mjs init --spec <id>");
        process.exit(1);
    }

    const defaultPlanPath = path.join('.shark', 'specs', specId, 'artifacts', 'plan.md');
    const planPath = planArg ? path.resolve(planArg) : path.resolve(defaultPlanPath);

    if (!fs.existsSync(planPath)) {
        console.error(`[ERROR] Plan artifact not found at: ${planPath}`);
        process.exit(1);
    }

    const planContent = fs.readFileSync(planPath, 'utf8');
    const tasks = parsePlanTasks(planContent);

    if (tasks.length === 0) {
        console.error(`[ERROR] No tasks parsed from ${planPath}. Expected format: '### Task 1: ...'`);
        process.exit(1);
    }

    // Git Worktree setup
    const worktreePath = path.join(SHARK_WORKTREES_DIR, specId);
    const branchName = `feat/${specId}`;

    fs.mkdirSync(SHARK_WORKTREES_DIR, { recursive: true });

    let currentBaseBranch = 'main';
    try {
        currentBaseBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim() || 'main';
    } catch {}

    console.log(`\n======================================================`);
    console.log(`🚀 [EXEC-CTL] Initializing Graph-Driven Execution`);
    console.log(`Spec ID: ${specId}`);
    console.log(`Total Tasks Parsed: ${tasks.length}`);
    console.log(`Target Worktree: ${worktreePath}`);
    console.log(`Target Branch: ${branchName}`);
    console.log(`======================================================`);

    if (fs.existsSync(worktreePath)) {
        console.log(`✔ Worktree directory already exists at ${worktreePath}`);
    } else {
        console.log(`🌿 Creating isolated git worktree...`);
        try {
            // Check if branch already exists
            let branchExists = false;
            try {
                execSync(`git show-ref --verify --quiet refs/heads/${branchName}`);
                branchExists = true;
            } catch {}

            if (branchExists) {
                execSync(`git worktree add "${worktreePath}" "${branchName}"`, { stdio: 'inherit' });
            } else {
                execSync(`git worktree add -b "${branchName}" "${worktreePath}"`, { stdio: 'inherit' });
            }
            console.log(`✔ Worktree created successfully.`);
        } catch (err) {
            console.error(`❌ Failed to create worktree: ${err.message}`);
            process.exit(1);
        }
    }

    const initialState = {
        specId,
        planArtifact: path.relative(process.cwd(), planPath).replace(/\\/g, '/'),
        status: 'IN_PROGRESS',
        currentTaskNumber: 1,
        totalTasks: tasks.length,
        currentNode: TASK_NODES.RED_TEST.id,
        worktree: {
            path: path.relative(process.cwd(), worktreePath).replace(/\\/g, '/'),
            branch: branchName,
            baseBranch: currentBaseBranch,
            created: new Date().toISOString()
        },
        rollbacksCount: 0,
        iterations: {
            RED_TEST: 1,
            GREEN_CODE: 0,
            LINT_TYPECHECK: 0,
            ADVERSARIAL_REVIEW: 0,
            ATOMIC_COMMIT: 0
        },
        tasks,
        history: [
            {
                taskNumber: 1,
                action: 'INITIALIZED',
                timestamp: new Date().toISOString()
            }
        ]
    };

    // Mark task 1 as IN_PROGRESS
    if (initialState.tasks[0]) {
        initialState.tasks[0].status = 'IN_PROGRESS';
    }

    saveExecutionState(specId, initialState);
    console.log(`\n✔ [EXEC-CTL] Execution graph initialized at: ${getExecutionPath(specId)}`);
    console.log(`📍 Current State: Task [1/${tasks.length}] ➔ Node: RED_TEST`);
    console.log(`[INSTRUCTION] Run 'node skills/graph-driven-execution/scripts/exec-ctl.mjs brief tdd-dev' to generate brief for writing the failing test.`);
}

function cmdStatus(specIdArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    const currentTask = state.tasks.find(t => t.taskNumber === state.currentTaskNumber) || state.tasks[0];
    const nodeDef = TASK_NODES[state.currentNode] || { title: state.currentNode, index: 0, role: 'none' };

    console.log(`\n======================================================`);
    console.log(`📊 GRAPH-DRIVEN EXECUTION: ${state.specId}`);
    console.log(`======================================================`);
    console.log(`Worktree: ${state.worktree.path} (Branch: ${state.worktree.branch})`);
    console.log(`Status  : ${state.status} | Rollbacks: ${state.rollbacksCount}`);
    console.log(`------------------------------------------------------`);

    // Task Level Progress Bar
    const tasksPipeline = state.tasks.map(t => {
        if (t.status === 'COMPLETED') return `[✔ T${t.taskNumber}]`;
        if (t.taskNumber === state.currentTaskNumber) return `[▶ T${t.taskNumber}]`;
        return `[ T${t.taskNumber} ]`;
    }).join(' ➔ ');
    console.log(`Tasks: ${tasksPipeline}`);
    console.log(`Active Task: [${currentTask.taskNumber}/${state.totalTasks}] ${currentTask.title}`);
    console.log(`------------------------------------------------------`);

    if (state.currentNode === 'READY_FOR_MERGE') {
        console.log(`🎉 All tasks completed and verified! Ready for integration.`);
        console.log(`[INSTRUCTION] 🛑 MANDATORY HUMAN CHECKPOINT: DO NOT call complete_task directly!`);
        console.log(`Use 'talk_with_user' to present the completion report and integration options:`);
        console.log(`  1. Direct Merge: 'node skills/graph-driven-execution/scripts/exec-ctl.mjs finish --merge'`);
        console.log(`  2. Keep branch for PR: 'node skills/graph-driven-execution/scripts/exec-ctl.mjs finish'`);
        console.log(`  3. Discard worktree`);
        console.log(`Wait for user confirmation before executing the choice.`);
        return;
    }

    // Inner Task TDD Cycle
    const cycleKeys = ['RED_TEST', 'GREEN_CODE', 'LINT_TYPECHECK', 'ADVERSARIAL_REVIEW', 'ATOMIC_COMMIT'];
    const cyclePipeline = cycleKeys.map(k => {
        const item = TASK_NODES[k];
        if (k === state.currentNode) return `[▶ ${item.index}.${k}]`;
        return `[ ${item.index}.${k} ]`;
    }).join(' ➔ ');
    console.log(`Current Cycle: ${cyclePipeline}`);
    console.log(`Current Node : [${nodeDef.index}/5] ${nodeDef.title}`);
    console.log(`------------------------------------------------------`);

    const briefRelPath = `.shark/specs/${specId}/briefs/exec-${nodeDef.role}-task-${currentTask.taskNumber}.md`;
    const briefFullPath = path.join(getSpecDir(specId), 'briefs', `exec-${nodeDef.role}-task-${currentTask.taskNumber}.md`);
    const critiqueFullPath = path.join(getSpecDir(specId), 'artifacts', `task-${currentTask.taskNumber}-critique.md`);

    console.log(`\n👉 [MANDATORY ACTION DIRECTIVE FOR AGENT]:`);
    if (state.currentNode === 'ADVERSARIAL_REVIEW') {
        if (fs.existsSync(critiqueFullPath)) {
            const critiqueContent = fs.readFileSync(critiqueFullPath, 'utf8');
            if (critiqueContent.includes('BLOCKER')) {
                console.log(`❌ Review critique verdict is BLOCKER!`);
                console.log(`You MUST execute rollback to GREEN_CODE now:`);
                console.log(`  node skills/graph-driven-execution/scripts/exec-ctl.mjs rollback --to GREEN_CODE --reason "Adversarial critique reported blocker issues"`);
            } else if (critiqueContent.includes('VERDICT: PASS')) {
                console.log(`✔ Review critique approved (${critiqueContent.includes('WARNINGS') ? 'PASS WITH WARNINGS' : 'PASS'})!`);
                console.log(`You MUST advance the gate to ATOMIC_COMMIT:`);
                console.log(`  node skills/graph-driven-execution/scripts/exec-ctl.mjs transition`);
            } else {
                console.log(`Advance gate now: node skills/graph-driven-execution/scripts/exec-ctl.mjs transition`);
            }
        } else if (fs.existsSync(briefFullPath)) {
            console.log(`Brief already generated at "${briefRelPath}".`);
            console.log(`You MUST execute action 'invoke_subagent' with args:`);
            console.log(`  { "task_file": "${briefRelPath}" }`);
            console.log(`Immediately after, call action 'wait' with args: {} to await completion.`);
            console.log(`DO NOT write code or run commands yourself.`);
        } else {
            console.log(`Generate brief now: node skills/graph-driven-execution/scripts/exec-ctl.mjs brief ${nodeDef.role}`);
        }
    } else if (nodeDef.role) {
        if (fs.existsSync(briefFullPath)) {
            console.log(`Brief already generated at "${briefRelPath}".`);
            console.log(`You MUST execute action 'invoke_subagent' with args:`);
            console.log(`  { "task_file": "${briefRelPath}" }`);
            console.log(`Immediately after, call action 'wait' with args: {} to await completion.`);
            console.log(`DO NOT write code or run commands yourself.`);
        } else {
            console.log(`Generate brief now: node skills/graph-driven-execution/scripts/exec-ctl.mjs brief ${nodeDef.role}`);
        }
    } else {
        console.log(`Run gate verification and advance to next node:`);
        console.log(`  node skills/graph-driven-execution/scripts/exec-ctl.mjs transition`);
    }
}

function cmdBrief(specIdArg, roleArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    const currentTask = state.tasks.find(t => t.taskNumber === state.currentTaskNumber);
    const currentNodeDef = TASK_NODES[state.currentNode];
    const role = roleArg || currentNodeDef?.role || 'tdd-dev';

    const briefDir = path.join(getSpecDir(specId), 'briefs');
    fs.mkdirSync(briefDir, { recursive: true });
    const briefFile = path.join(briefDir, `exec-${role}-task-${currentTask.taskNumber}.md`);

    const baseFrontmatter = `---
type: subagent
role: ${role}
spec_id: ${specId}
task_number: ${currentTask.taskNumber}
node: ${state.currentNode}
worktree_path: ${state.worktree.path}
---

`;

    let briefContent = '';

    if (state.currentNode === 'RED_TEST') {
        briefContent = `${baseFrontmatter}# Subagent Task: TDD RED Test Phase
**Spec ID:** ${specId}
**Task [${currentTask.taskNumber}/${state.totalTasks}]:** ${currentTask.title}
**Target Worktree:** \`${state.worktree.path}\`

## Task Instructions from Plan:
${currentTask.content}

## Your Mission (RED Phase ONLY):
1. Navigate to the worktree \`${state.worktree.path}\`.
2. Write ONLY the failing test specified in the task plan.
3. DO NOT implement the solution code yet!
4. Run the test command (\`${currentTask.testCmd}\`) and verify that it FAILS with an assertion error.
5. Report the exact failure output and call complete_task.
`;
    } else if (state.currentNode === 'GREEN_CODE') {
        const failureEvidence = currentTask.evidence.redTestOutput || 'Test failure verified.';
        briefContent = `${baseFrontmatter}# Subagent Task: TDD GREEN Implementation Phase
**Spec ID:** ${specId}
**Task [${currentTask.taskNumber}/${state.totalTasks}]:** ${currentTask.title}
**Target Worktree:** \`${state.worktree.path}\`

## Confirmed RED Failure:
\`\`\`text
${failureEvidence}
\`\`\`

## Task Instructions from Plan:
${currentTask.content}

## Your Mission (GREEN Phase):
1. In the worktree \`${state.worktree.path}\`, write the MINIMAL implementation code required to make the test pass.
2. Run \`${currentTask.testCmd}\` to verify that all tests pass cleanly.
3. Keep code strictly within the allowed task files:
${currentTask.allowedFiles.map(f => `   - \`${f}\``).join('\n')}
4. Complete task once the tests are green.
`;
    } else if (state.currentNode === 'ADVERSARIAL_REVIEW') {
        let diff = '';
        try {
            runInWorktree(state.worktree.path, 'git add -N .');
            diff = runInWorktree(state.worktree.path, 'git diff HEAD');
        } catch {
            diff = 'git diff could not be retrieved.';
        }

        briefContent = `${baseFrontmatter}# Subagent Task: Adversarial Code & Security Reviewer
**Spec ID:** ${specId}
**Task [${currentTask.taskNumber}/${state.totalTasks}]:** ${currentTask.title}
**Worktree Path:** \`${state.worktree.path}\`

## Real Git Diff Under Review:
\`\`\`diff
${diff}
\`\`\`

## Approved Design Reference:
\`.shark/specs/${specId}/artifacts/design.md\`

## Rubrica de Avaliacao do Diff (0 a 10.0 pontos):
Avalie as alteracoes de codigo atraves de 4 dimensoes objetivas somando no maximo 10.0 pontos:

1. **Contratos & Requisitos da Tarefa (Max: 4.0 pontos)**
   - O diff implementa exatamente o comportamento prescrito na tarefa sem alterar contratos nao autorizados (2.0 pts)
   - Todos os cenarios e edge cases do AC correspondente contemplados (2.0 pts)

2. **Segurança & Resiliencia (Max: 3.0 pontos)**
   - Ausencia de injecao, memory leaks, unhandled exceptions, race conditions ou overflow (2.0 pts)
   - Validacoes estritas de boundaries, types e erros (1.0 pt)

3. **Rigor dos Testes & TDD (Max: 2.0 pontos)**
   - Testes reais sem assercoes tautologicas ou mocks que mascarem a logica real (1.0 pt)
   - Assercoes completas sobre valores de retorno e mensagens de erro esperadas (1.0 pt)

4. **Blast Radius & Limpeza (Max: 1.0 ponto)**
   - Modificacoes estritamente restritas aos arquivos autorizados da tarefa, sem arquivos espurios ou codigo morto (1.0 pt)

## O que Cada Faixa Representa (Tiers de Decisao):
- **Faixa 9.0 a 10.0 (PASS):** Aprovado diretamente para commit atomico (ATOMIC_COMMIT).
- **Faixa 7.0 a 8.9 (PASS WITH WARNINGS):** Aprovado SEM ROLLBACK. Sugestoes e ressalvas anotadas como \`- [WARN-xx] <descricao>\`.
- **Faixa 0.0 a 6.9 (BLOCKER):** Reprovado. Dispara rollback para GREEN_CODE com motivo tecnico exato para correcao.

## Instructions:
1. Analise criticamente o git diff acima cruzando com o design e os requisitos da tarefa.
2. Escreva seu parecer em \`.shark/specs/${specId}/artifacts/task-${currentTask.taskNumber}-critique.md\`.
3. Seu output DEVE conter obrigatoriamente:
   - \`# Code Review\` (Analise detalhada de corretude, seguranca e boas praticas)
   - \`# Score Breakdown\` (Tabela/lista com pontuacao das 4 dimensoes e nota total)
   - \`# Audit Verdict\` (Contendo \`SCORE: X.X/10\` e a linha de veredito: \`VERDICT: PASS\`, \`VERDICT: PASS WITH WARNINGS\`, ou \`VERDICT: BLOCKER: <motivo detalhado>\`)
4. Se houver ressalvas na faixa 7.0-8.9, liste cada uma como \`- [WARN-xx] <descricao>\`.
`;
    }

    fs.writeFileSync(briefFile, briefContent, 'utf8');
    const briefRelPath = path.relative(process.cwd(), briefFile).replace(/\\/g, '/');
    console.log(`\n✔ [EXEC-CTL] Brief successfully generated for '${role}' at:`);
    console.log(`📄 ${briefFile}`);
    console.log(`\n👉 [MANDATORY ACTION DIRECTIVE FOR AGENT]:`);
    console.log(`You MUST now execute the action 'invoke_subagent' with args:`);
    console.log(`  { "task_file": "${briefRelPath}" }`);
    console.log(`Immediately after, call the 'wait' action with args: {} to await completion.`);
    console.log(`DO NOT write code or run other commands. The isolated subagent '${role}' must perform this work.`);
}

function cmdVerify(specIdArg, type) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    const currentTask = state.tasks.find(t => t.taskNumber === state.currentTaskNumber);
    const worktree = state.worktree.path;

    console.log(`\n🔍 [DETERMINISTIC GATE] Verifying: ${type.toUpperCase()} for Task ${currentTask.taskNumber}...`);

    switch (type) {
        case 'red': {
            console.log(`▶ Running test command in worktree: '${currentTask.testCmd}'`);
            try {
                const output = runInWorktree(worktree, currentTask.testCmd);
                // If it succeeded, that's a FAILURE for the RED gate!
                console.error(`\n❌ RED GATE FAILED: Test passed with exit code 0!`);
                console.error(`Tautological test detected. A new test MUST fail before implementation is written.`);
                process.exit(1);
            } catch (err) {
                const output = err.stdout || err.stderr || err.message;
                console.log(`✔ RED GATE PASSED: Test failed as expected (exit code != 0).`);
                currentTask.evidence.redTestOutput = output.slice(0, 500);
                saveExecutionState(specId, state);
                return true;
            }
        }
        case 'green': {
            console.log(`▶ Running test command in worktree: '${currentTask.testCmd}'`);
            try {
                const output = runInWorktree(worktree, currentTask.testCmd);
                console.log(`✔ GREEN GATE PASSED: All tests passed cleanly (exit code 0).`);
                currentTask.evidence.greenTestOutput = output.slice(0, 500);
                saveExecutionState(specId, state);
                return true;
            } catch (err) {
                console.error(`\n❌ GREEN GATE FAILED: Tests are still failing!`);
                console.error(err.stdout || err.stderr || err.message);
                process.exit(1);
            }
        }
        case 'lint': {
            console.log(`▶ Checking TypeScript compilation & lint in worktree...`);
            let tscOk = false;
            try {
                runInWorktree(worktree, 'npx tsc --noEmit');
                console.log(`✔ Typecheck PASSED (0 compiler errors).`);
                tscOk = true;
            } catch (err) {
                console.error(`\n❌ LINT GATE FAILED: TypeScript compiler errors detected!`);
                console.error(err.stdout || err.stderr || err.message);
                process.exit(1);
            }
            return tscOk;
        }
        case 'review': {
            const critiquePath = path.resolve(path.join(getSpecDir(specId), 'artifacts', `task-${currentTask.taskNumber}-critique.md`));
            if (!fs.existsSync(critiquePath)) {
                console.error(`\n❌ REVIEW GATE FAILED: Critique artifact not found at ${critiquePath}`);
                process.exit(1);
            }
            const content = fs.readFileSync(critiquePath, 'utf8');
            const scoreMatch = content.match(/SCORE:\s*([\d.]+)\s*\/\s*10/i);
            const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

            if (content.includes('VERDICT: BLOCKER')) {
                const blockerMatch = content.match(/VERDICT:\s*BLOCKER:\s*([^\n]+)/i);
                const reason = blockerMatch ? blockerMatch[1].trim() : 'Code review blocker identified';
                console.error(`\n❌ REVIEW GATE BLOCKED: Code Reviewer concluded with BLOCKER!`);
                console.error(`Reason: ${reason}`);
                process.exit(1);
            }

            const isPassWithWarn = content.includes('VERDICT: PASS WITH WARNINGS');
            const verdict = isPassWithWarn ? 'PASS WITH WARNINGS' : 'PASS';
            currentTask.evidence.reviewVerdict = verdict;
            if (score !== null) currentTask.evidence.reviewScore = score;

            const warnMatches = [...content.matchAll(/-\s*\[WARN-\d+\]\s*([^\n]+)/gi)].map(m => m[0].trim());
            if (warnMatches.length > 0) {
                currentTask.evidence.reviewWarnings = warnMatches;
            }
            saveExecutionState(specId, state);

            console.log(`✔ REVIEW GATE PASSED: Code review approved (${verdict}${score !== null ? `, Score: ${score}/10` : ''}).`);
            if (warnMatches.length > 0) {
                console.log(`  Warnings noted (${warnMatches.length}):`);
                warnMatches.forEach(w => console.log(`    ${w}`));
            }
            return true;
        }
        default:
            console.error(`[ERROR] Unknown verification type: ${type}. Choices: red, green, lint, review`);
            process.exit(1);
    }
}

function cmdTransition(specIdArg) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    const currentTask = state.tasks.find(t => t.taskNumber === state.currentTaskNumber);
    const currentNode = state.currentNode;

    // Run deterministic verification before transitioning
    if (currentNode === 'RED_TEST') {
        cmdVerify(specId, 'red');
        state.currentNode = 'GREEN_CODE';
    } else if (currentNode === 'GREEN_CODE') {
        cmdVerify(specId, 'green');
        state.currentNode = 'LINT_TYPECHECK';
    } else if (currentNode === 'LINT_TYPECHECK') {
        cmdVerify(specId, 'lint');
        state.currentNode = 'ADVERSARIAL_REVIEW';
    } else if (currentNode === 'ADVERSARIAL_REVIEW') {
        cmdVerify(specId, 'review');
        state.currentNode = 'ATOMIC_COMMIT';
    } else if (currentNode === 'ATOMIC_COMMIT') {
        // Execute git commit in worktree
        console.log(`💾 [ATOMIC COMMIT] Committing Task ${currentTask.taskNumber} in worktree...`);
        try {
            runInWorktree(state.worktree.path, 'git add -A');
            const commitMsg = `feat(${state.specId}): task ${currentTask.taskNumber} - ${currentTask.title}`;
            runInWorktree(state.worktree.path, `git commit -m "${commitMsg}"`);
            const commitHash = runInWorktree(state.worktree.path, 'git rev-parse --short HEAD').trim();
            currentTask.commitHash = commitHash;
            currentTask.status = 'COMPLETED';
            console.log(`✔ Commit recorded: ${commitHash} ("${commitMsg}")`);
        } catch (err) {
            console.warn(`⚠️ Git commit returned non-zero (possibly no new changes): ${err.message}`);
        }

        // Check if there are more tasks
        if (state.currentTaskNumber < state.totalTasks) {
            state.currentTaskNumber += 1;
            state.currentNode = 'RED_TEST';
            const nextTask = state.tasks.find(t => t.taskNumber === state.currentTaskNumber);
            if (nextTask) nextTask.status = 'IN_PROGRESS';
            console.log(`\n======================================================`);
            console.log(`✔ Advanced to Task [${state.currentTaskNumber}/${state.totalTasks}]: ${nextTask.title}`);
            console.log(`======================================================`);
        } else {
            state.currentNode = 'READY_FOR_MERGE';
            console.log(`\n🎉 All ${state.totalTasks} tasks completed! Advanced to READY_FOR_MERGE.`);
        }
    }

    state.history.push({
        taskNumber: currentTask.taskNumber,
        fromNode: currentNode,
        toNode: state.currentNode,
        timestamp: new Date().toISOString()
    });

    saveExecutionState(specId, state);
    cmdStatus(specId);
}

function cmdRollback(specIdArg, toNodeArg, reason) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }
    if (!reason) {
        console.error("[ERROR] Rollback requires --reason \"<text>\"");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    const fromNode = state.currentNode;
    const targetNode = toNodeArg || 'GREEN_CODE';

    state.currentNode = targetNode;
    state.rollbacksCount = (state.rollbacksCount || 0) + 1;
    state.history.push({
        taskNumber: state.currentTaskNumber,
        action: 'ROLLBACK',
        fromNode,
        toNode: targetNode,
        reason,
        timestamp: new Date().toISOString()
    });

    saveExecutionState(specId, state);
    console.log(`\n⚠️ [ROLLBACK EXECUTED] ${fromNode} ↩ ${targetNode}`);
    console.log(`Reason: ${reason}`);
    console.log(`[INSTRUCTION] Run 'brief tdd-dev' to re-dispatch the developer with rollback notes.`);
}

function cmdFinish(specIdArg, merge) {
    const specId = specIdArg || findActiveSpecId();
    if (!specId) {
        console.error("[ERROR] No active execution spec found.");
        process.exit(1);
    }

    const state = loadExecutionState(specId);
    console.log(`\n🔍 Running final test suite across worktree...`);
    try {
        runInWorktree(state.worktree.path, 'npm test');
        console.log(`✔ Final test suite PASSED 100%!`);
    } catch (err) {
        console.error(`❌ Final verification failed!`);
        process.exit(1);
    }

    if (merge) {
        console.log(`🔀 Merging branch ${state.worktree.branch} into ${state.worktree.baseBranch}...`);
        try {
            execSync(`git merge "${state.worktree.branch}" --no-ff -m "feat: complete spec ${specId}"`, { stdio: 'inherit' });
            console.log(`✔ Merged successfully.`);
            console.log(`🧹 Removing worktree ${state.worktree.path}...`);
            execSync(`git worktree remove "${state.worktree.path}"`, { stdio: 'inherit' });
            console.log(`✔ Worktree removed cleanly.`);
        } catch (err) {
            console.error(`⚠️ Merge or worktree removal error: ${err.message}`);
        }
    }

    state.status = 'COMPLETED';
    saveExecutionState(specId, state);
    if (merge) {
        console.log(`\n🎉 Execution for spec '${specId}' merged into ${state.worktree.baseBranch} and marked as COMPLETED!`);
    } else {
        console.log(`\n✔ Execution for spec '${specId}' verified. Branch '${state.worktree.branch}' preserved.`);
        console.log(`[INSTRUCTION] Inform the user that the branch is ready for PR or manual review.`);
    }
}

// --- Main CLI ---
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
exec-ctl.mjs - Graph-Driven Execution & Worktree Controller

Commands:
  init [--spec <id>] [--plan <path>]     Initialize execution graph & isolated worktree
  status [--spec <id>]                    Check active task, node, and TDD cycle
  brief [--spec <id>] [role]              Generate isolated brief for subagent
  verify [--spec <id>] <red|green|lint>   Run deterministic machine gate check
  transition [--spec <id>] [--next]       Advance TDD cycle after gate passes
  rollback [--spec <id>] --to <node>      Rollback to prior node on audit failure
  finish [--spec <id>] [--merge]          Finalize suite and merge worktree cleanly
  sync-base [--spec <id>]                 Rebase active worktree over latest main
  dashboard [--port <port>]               Launch Real-Time Web Dashboard UI (default: 3333)
`);
        return;
    }

    const command = args[0];
    const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : null;
    };

    const specFromFlag = getArg('--spec');

    switch (command) {
        case 'init': {
            const plan = getArg('--plan');
            cmdInit(specFromFlag, plan);
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
        case 'verify': {
            const type = args[1] && !args[1].startsWith('--') ? args[1] : 'green';
            cmdVerify(specFromFlag, type);
            break;
        }
        case 'transition': {
            cmdTransition(specFromFlag);
            break;
        }
        case 'rollback': {
            const to = getArg('--to');
            const reason = getArg('--reason');
            cmdRollback(specFromFlag, to, reason);
            break;
        }
        case 'finish': {
            const merge = args.includes('--merge');
            cmdFinish(specFromFlag, merge);
            break;
        }
        case 'sync-base': {
            const epicCtlPath = path.join(path.dirname(process.argv[1]), 'epic-ctl.mjs');
            try {
                execSync(`node "${epicCtlPath}" sync-base --spec ${specFromFlag || ''}`, { stdio: 'inherit' });
            } catch (err) {
                console.error(`Sync-base exit: ${err.message}`);
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
            console.error(`Unknown command: ${command}`);
            process.exit(1);
    }
}

main();
