#!/usr/bin/env node
/**
 * epic-ctl.mjs - Multi-Spec Epic Orchestrator & Automated Planning-to-Execution Handoff
 * 
 * Zero external dependencies. Uses built-in node:fs, node:path, node:child_process.
 * Manages:
 * - Multi-spec Epic Roadmaps with Dependency Graphs (.shark/epics/<id>/roadmap.json)
 * - Domain and Scope Boundary Decomposition (In Scope vs Out of Scope)
 * - Automated Handoff from spec-driven-graph (READY_FOR_EXECUTION) to graph-driven-execution
 * - Stacked Worktrees & Base Branch Rebase Sync
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SHARK_DIR = path.resolve('.shark');
const EPICS_DIR = path.join(SHARK_DIR, 'epics');
const SPECS_DIR = path.join(SHARK_DIR, 'specs');
const WORKTREES_DIR = path.join(SHARK_DIR, 'worktrees');

// --- Helper Functions ---
function getEpicDir(epicId) {
    return path.join(EPICS_DIR, epicId);
}

function getRoadmapPath(epicId) {
    return path.join(getEpicDir(epicId), 'roadmap.json');
}

function findActiveEpicId() {
    if (!fs.existsSync(EPICS_DIR)) return null;
    const entries = fs.readdirSync(EPICS_DIR, { withFileTypes: true });
    const epicDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    if (epicDirs.length === 0) return null;
    if (epicDirs.length === 1) return epicDirs[0];

    // Find most recently updated
    let latest = null;
    let latestMtime = 0;
    for (const id of epicDirs) {
        const road = getRoadmapPath(id);
        if (fs.existsSync(road)) {
            const mtime = fs.statSync(road).mtimeMs;
            if (mtime > latestMtime) {
                latestMtime = mtime;
                latest = id;
            }
        }
    }
    return latest;
}

function loadRoadmap(epicId) {
    const p = getRoadmapPath(epicId);
    if (!fs.existsSync(p)) {
        console.error(`[ERROR] Epic roadmap not found at: ${p}. Run 'epic-ctl.mjs init --epic ${epicId}' first.`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveRoadmap(epicId, data) {
    const d = getEpicDir(epicId);
    fs.mkdirSync(d, { recursive: true });
    data.updated = new Date().toISOString();
    fs.writeFileSync(getRoadmapPath(epicId), JSON.stringify(data, null, 2), 'utf8');
}

// --- CLI Commands ---

function cmdInit(epicIdArg, titleArg) {
    const epicId = epicIdArg || 'epic-' + Date.now();
    const title = titleArg || 'Multi-Spec Epic Roadmap';

    const epicDir = getEpicDir(epicId);
    fs.mkdirSync(epicDir, { recursive: true });

    const roadmap = {
        epicId,
        title,
        status: 'IN_PROGRESS',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        specs: [],
        history: [
            {
                action: 'INITIALIZED',
                timestamp: new Date().toISOString()
            }
        ]
    };

    saveRoadmap(epicId, roadmap);
    console.log(`\n======================================================`);
    console.log(`🗺️ [EPIC-CTL] Epic initialized successfully!`);
    console.log(`Epic ID : ${epicId}`);
    console.log(`Roadmap : ${getRoadmapPath(epicId)}`);
    console.log(`======================================================`);
    console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/epic-ctl.mjs decompose --epic ${epicId} --input <path>' to break down your task list into specs.`);
}

function cmdDecompose(epicIdArg, inputArg) {
    const epicId = epicIdArg || findActiveEpicId();
    if (!epicId) {
        console.error("[ERROR] No active epic found. Usage: epic-ctl decompose --epic <id> --input <path>");
        process.exit(1);
    }

    const roadmap = loadRoadmap(epicId);

    let rawTasks = '';
    if (inputArg && fs.existsSync(inputArg)) {
        rawTasks = fs.readFileSync(inputArg, 'utf8');
    } else if (inputArg) {
        rawTasks = inputArg;
    } else {
        console.error("[ERROR] Missing --input <file_path | raw_text>");
        process.exit(1);
    }

    console.log(`\n======================================================`);
    console.log(`🔍 [EPIC DECOMPOSER] Analyzing Tasks & Blast Radius...`);
    console.log(`======================================================`);

    // Parse major features/specs by numbered sections (1., 2.), headings (##), or top-level bullets
    const lines = rawTasks.split(/\r?\n/);
    const parsedItems = [];
    let currentItem = null;

    for (const line of lines) {
        const trimmed = line.trim();
        const headerMatch = trimmed.match(/^(?:(?:\d+\.|\#{2,3})\s+)(.+)$/);
        if (headerMatch) {
            if (currentItem) {
                parsedItems.push(currentItem);
            }
            currentItem = {
                title: headerMatch[1].trim(),
                content: [trimmed]
            };
        } else if (currentItem) {
            if (trimmed) currentItem.content.push(trimmed);
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            // Standalone bullet outside headers
            parsedItems.push({
                title: trimmed.replace(/^[-*]\s+/, ''),
                content: [trimmed]
            });
        }
    }
    if (currentItem) {
        parsedItems.push(currentItem);
    }

    if (parsedItems.length === 0 && rawTasks.trim()) {
        parsedItems.push({
            title: rawTasks.trim().slice(0, 50),
            content: [rawTasks.trim()]
        });
    }

    console.log(`Found ${parsedItems.length} candidate feature spec(s).`);

    // Heuristic domain clustering
    const domainKeywords = {
        auth: ['auth', 'login', 'oauth', 'token', 'jwt', 'security', 'permission'],
        checkout: ['checkout', 'carrinho', 'cart', 'desconto', 'frete', 'cupom', 'order', 'payment', 'pagamento'],
        database: ['db', 'banco', 'schema', 'migration', 'tabela', 'tenant', 'multitenancy', 'sql'],
        catalog: ['catalogo', 'produto', 'busca', 'search', 'query', 'listagem', 'catalog']
    };

    let specCounter = roadmap.specs.length + 1;
    const newSpecs = [];

    for (const item of parsedItems) {
        let detectedDomain = 'core';
        const lower = item.title.toLowerCase();
        for (const [dom, keywords] of Object.entries(domainKeywords)) {
            if (keywords.some(k => lower.includes(k))) {
                detectedDomain = dom;
                break;
            }
        }

        // Generate slug
        const cleanTitle = item.title.replace(/^\[.*?\]\s*/, '');
        const slug = cleanTitle
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 30);

        const specId = `${detectedDomain}-${slug || 'task' + specCounter}`;
        specCounter++;

        // Save spec context draft
        const specContextDir = path.join(SPECS_DIR, specId, 'context');
        fs.mkdirSync(specContextDir, { recursive: true });
        fs.writeFileSync(path.join(specContextDir, 'requirements.md'), item.content.join('\n'), 'utf8');

        // Determine if there is an obvious dependency (e.g. catalog depending on database)
        const dependsOn = [];
        if (detectedDomain === 'catalog') {
            const dbSpec = roadmap.specs.find(s => s.domain === 'database') || newSpecs.find(s => s.domain === 'database');
            if (dbSpec) dependsOn.push(dbSpec.specId);
        }

        const specEntry = {
            specId,
            title: item.title,
            domain: detectedDomain,
            dependsOn,
            planningStatus: 'QUEUED',
            executionStatus: 'NOT_STARTED',
            worktree: path.join('.shark', 'worktrees', specId).replace(/\\/g, '/'),
            branch: `feat/${specId}`,
            created: new Date().toISOString()
        };

        newSpecs.push(specEntry);
    }

    roadmap.specs.push(...newSpecs);
    saveRoadmap(epicId, roadmap);

    console.log(`\n✔ Decomposed into ${newSpecs.length} discrete specs:`);
    for (const s of newSpecs) {
        const depStr = s.dependsOn.length > 0 ? `(Depends on: ${s.dependsOn.join(', ')})` : '(Independent 🟢)';
        console.log(`  - [${s.domain.toUpperCase()}] ${s.specId}: "${s.title}" ${depStr}`);
    }
    console.log(`\n[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/epic-ctl.mjs status' to view roadmap matrix.`);
}

function cmdStatus(epicIdArg) {
    const epicId = epicIdArg || findActiveEpicId();
    if (!epicId) {
        console.error("[ERROR] No active epic found.");
        process.exit(1);
    }

    const roadmap = loadRoadmap(epicId);

    console.log(`\n======================================================`);
    console.log(`🗺️ EPIC ROADMAP: ${roadmap.epicId} ("${roadmap.title}")`);
    console.log(`======================================================`);
    console.log(`Total Specs: ${roadmap.specs.length} | Status: ${roadmap.status}`);
    console.log(`------------------------------------------------------`);

    for (let i = 0; i < roadmap.specs.length; i++) {
        const s = roadmap.specs[i];
        
        // Sync with actual files in .shark/specs/<specId>/state.json
        const stateFile = path.join(SPECS_DIR, s.specId, 'state.json');
        const execFile = path.join(SPECS_DIR, s.specId, 'execution.json');

        if (fs.existsSync(stateFile)) {
            try {
                const specData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                s.planningStatus = specData.currentNode || 'IN_PROGRESS';
            } catch {}
        }
        if (fs.existsSync(execFile)) {
            try {
                const execData = JSON.parse(fs.readFileSync(execFile, 'utf8'));
                s.executionStatus = execData.status || 'IN_PROGRESS';
            } catch {}
        }

        const planBadge = s.planningStatus === 'READY_FOR_EXECUTION' ? '✔ PLAN READY' : `▶ ${s.planningStatus}`;
        const execBadge = s.executionStatus === 'COMPLETED' ? '✔ EXEC DONE' : (s.executionStatus === 'IN_PROGRESS' ? '▶ EXECUTING' : '⏸ WAITING');

        const depInfo = s.dependsOn.length > 0 ? `[Blocked by: ${s.dependsOn.join(', ')}]` : '[Independent 🟢]';

        console.log(`${i + 1}. [${s.domain.toUpperCase()}] ${s.specId}`);
        console.log(`   Title    : ${s.title}`);
        console.log(`   Pipeline : [${planBadge}] ➔ [${execBadge}]`);
        console.log(`   Relation : ${depInfo}`);
        console.log(`   Worktree : ${s.worktree} (${s.branch})`);
        console.log(`------------------------------------------------------`);
    }

    saveRoadmap(epicId, roadmap);
    console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/epic-ctl.mjs handoff --all-ready' to auto-launch executions for ready specs.`);
    console.log(`[INSTRUCTION] Run 'node skills/spec-driven-graph/scripts/graph-dashboard.mjs' to view in Real-Time Web UI.`);
}

function cmdHandoff(epicIdArg, specIdArg, allReady) {
    const epicId = epicIdArg || findActiveEpicId();
    if (!epicId) {
        console.error("[ERROR] No active epic found.");
        process.exit(1);
    }

    const roadmap = loadRoadmap(epicId);
    let targetSpecs = [];

    if (specIdArg) {
        const found = roadmap.specs.find(s => s.specId === specIdArg);
        if (!found) {
            console.error(`[ERROR] Spec '${specIdArg}' not found in epic roadmap.`);
            process.exit(1);
        }
        targetSpecs.push(found);
    } else {
        // Auto-detect ready specs
        for (const s of roadmap.specs) {
            const stateFile = path.join(SPECS_DIR, s.specId, 'state.json');
            if (fs.existsSync(stateFile)) {
                try {
                    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                    if (st.currentNode === 'READY_FOR_EXECUTION') {
                        s.planningStatus = 'READY_FOR_EXECUTION';
                        if (s.executionStatus === 'NOT_STARTED' || s.executionStatus === 'QUEUED') {
                            targetSpecs.push(s);
                        }
                    }
                } catch {}
            }
        }
    }

    if (targetSpecs.length === 0) {
        console.log(`\nℹ️ [HANDOFF] No specs currently waiting for execution handoff.`);
        console.log(`Check if your spec has completed 'PLAN_AUDIT' and reached 'READY_FOR_EXECUTION'.`);
        return;
    }

    console.log(`\n======================================================`);
    console.log(`🚀 [AUTOMATED HANDOFF] Transitioning ${targetSpecs.length} Spec(s) to Execution...`);
    console.log(`======================================================`);

    for (const s of targetSpecs) {
        // Check dependency satisfaction
        let canExecute = true;
        for (const depId of s.dependsOn) {
            const depSpec = roadmap.specs.find(item => item.specId === depId);
            if (depSpec && depSpec.executionStatus !== 'COMPLETED') {
                console.warn(`⚠️ Cannot handoff '${s.specId}' yet: dependency '${depId}' is not COMPLETED (status: ${depSpec.executionStatus}).`);
                canExecute = false;
                break;
            }
        }

        if (!canExecute) continue;

        const defaultPlanPath = path.join(SPECS_DIR, s.specId, 'artifacts', 'plan.md');
        if (!fs.existsSync(defaultPlanPath)) {
            console.error(`❌ Plan artifact not found for '${s.specId}' at: ${defaultPlanPath}`);
            continue;
        }

        console.log(`\n▶ Initializing Worktree for: ${s.specId}`);
        try {
            const execCtlPath = path.join('skills', 'graph-driven-execution', 'scripts', 'exec-ctl.mjs');
            const initCmd = `node "${execCtlPath}" init --spec "${s.specId}" --plan "${defaultPlanPath}"`;
            execSync(initCmd, { stdio: 'inherit' });
            
            s.executionStatus = 'IN_PROGRESS';
            roadmap.history.push({
                specId: s.specId,
                action: 'AUTO_HANDOFF_TO_EXECUTION',
                timestamp: new Date().toISOString()
            });
            console.log(`✔ [HANDOFF SUCCESS] Spec '${s.specId}' is now active in worktree: ${s.worktree}`);
        } catch (err) {
            console.error(`❌ Failed to init execution for '${s.specId}': ${err.message}`);
        }
    }

    saveRoadmap(epicId, roadmap);
}

function cmdSyncBase(epicIdArg, specIdArg) {
    const epicId = epicIdArg || findActiveEpicId();
    if (!epicId) {
        console.error("[ERROR] No active epic found.");
        process.exit(1);
    }

    const roadmap = loadRoadmap(epicId);
    console.log(`\n======================================================`);
    console.log(`🔄 [SYNC BASE] Rebasing Active Worktrees on 'main'...`);
    console.log(`======================================================`);

    for (const s of roadmap.specs) {
        if (specIdArg && s.specId !== specIdArg) continue;

        const worktreePath = path.resolve(s.worktree);
        if (fs.existsSync(worktreePath) && s.executionStatus === 'IN_PROGRESS') {
            console.log(`▶ Rebasing worktree '${s.specId}' on main...`);
            try {
                execSync('git fetch . main', { cwd: worktreePath, stdio: 'pipe' });
                execSync('git rebase main', { cwd: worktreePath, stdio: 'inherit' });
                console.log(`✔ Worktree '${s.specId}' rebased cleanly on latest main.`);
            } catch (err) {
                console.error(`⚠️ Conflict during rebase on '${s.specId}': ${err.message}`);
                console.log(`[INSTRUCTION] Dispatch 'tdd-dev' to resolve conflict in '${s.worktree}'.`);
            }
        }
    }
}

// --- Main CLI ---
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log(`
epic-ctl.mjs - Multi-Spec Epic Orchestrator & Automated Handoff

Commands:
  init [--epic <id>] [--title <title>]       Initialize a new Epic roadmap
  decompose [--epic <id>] --input <file>    Break down broad task list into discrete specs
  status [--epic <id>]                      Inspect all specs, dependencies & pipeline status
  handoff [--epic <id>] [--spec <id>]       Auto-launch execution worktree for ready specs
  sync-base [--epic <id>] [--spec <id>]     Rebase active worktree branches over main
  dashboard [--port <port>]                 Start Real-Time Web Dashboard UI
`);
        return;
    }

    const command = args[0];
    const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : null;
    };

    const epicFromFlag = getArg('--epic');

    switch (command) {
        case 'init': {
            const title = getArg('--title');
            cmdInit(epicFromFlag, title);
            break;
        }
        case 'decompose': {
            const input = getArg('--input');
            cmdDecompose(epicFromFlag, input);
            break;
        }
        case 'status': {
            cmdStatus(epicFromFlag);
            break;
        }
        case 'handoff': {
            const specId = getArg('--spec');
            const allReady = args.includes('--all-ready');
            cmdHandoff(epicFromFlag, specId, allReady);
            break;
        }
        case 'sync-base': {
            const specId = getArg('--spec');
            cmdSyncBase(epicFromFlag, specId);
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
