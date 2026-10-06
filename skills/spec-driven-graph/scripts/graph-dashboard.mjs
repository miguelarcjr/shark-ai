#!/usr/bin/env node
/**
 * graph-dashboard.mjs - Real-Time Web Dashboard for Graph-Driven Specification & Execution
 * 
 * Zero external dependencies. Uses built-in node:http, node:fs, node:path.
 * Provides real-time visual monitoring of:
 * - Multi-spec Epic Roadmap & Dependencies
 * - Specification Graph (7 nodes: Grounding -> Elicit -> Spikes -> Arch -> Critique -> Plan -> Audit)
 * - Execution Graph (Worktree TDD cycle: Red -> Green -> Lint -> Review -> Commit -> Merge)
 * - Live Subagents stream (.shark/subagents.json)
 * - Instant Artifact & Git Diff Inspector
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PORT = 3333;
const args = process.argv.slice(2);
let customDir = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) customDir = args[i + 1];
}

function resolveSharkDir() {
    if (customDir) return path.resolve(customDir);
    const sandboxShark = path.resolve('test-sandbox/.shark');
    if (fs.existsSync(sandboxShark) && (fs.existsSync(path.join(sandboxShark, 'epics')) || fs.existsSync(path.join(sandboxShark, 'specs')))) {
        return sandboxShark;
    }
    return path.resolve('.shark');
}

const SHARK_DIR = resolveSharkDir();
const SPECS_DIR = path.join(SHARK_DIR, 'specs');
const WORKTREES_DIR = path.join(SHARK_DIR, 'worktrees');
const EPICS_DIR = path.join(SHARK_DIR, 'epics');
const SUBAGENTS_FILE = path.join(SHARK_DIR, 'subagents.json');

// --- Helper Functions to Read State ---
function getFullState() {
    const data = {
        timestamp: new Date().toISOString(),
        epics: [],
        specs: [],
        subagents: {},
        stats: {
            totalSpecs: 0,
            readyForExec: 0,
            inExecution: 0,
            completed: 0,
            activeSubagents: 0,
            totalRollbacks: 0
        }
    };

    // Read Subagents
    if (fs.existsSync(SUBAGENTS_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(SUBAGENTS_FILE, 'utf8'));
            data.subagents = raw.subagents || {};
            for (const sub of Object.values(data.subagents)) {
                if (sub.status === 'running') data.stats.activeSubagents++;
            }
        } catch {}
    }

    // Read Epics
    if (fs.existsSync(EPICS_DIR)) {
        try {
            const entries = fs.readdirSync(EPICS_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const roadmapPath = path.join(EPICS_DIR, entry.name, 'roadmap.json');
                    if (fs.existsSync(roadmapPath)) {
                        try {
                            data.epics.push(JSON.parse(fs.readFileSync(roadmapPath, 'utf8')));
                        } catch {}
                    }
                }
            }
        } catch {}
    }

    // Read Specs
    if (fs.existsSync(SPECS_DIR)) {
        try {
            const entries = fs.readdirSync(SPECS_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const specId = entry.name;
                    const specDir = path.join(SPECS_DIR, specId);
                    const statePath = path.join(specDir, 'state.json');
                    const execPath = path.join(specDir, 'execution.json');

                    let specState = null;
                    let execState = null;

                    if (fs.existsSync(statePath)) {
                        try { specState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
                    }
                    if (fs.existsSync(execPath)) {
                        try { execState = JSON.parse(fs.readFileSync(execPath, 'utf8')); } catch {}
                    }

                    if (specState || execState) {
                        data.stats.totalSpecs++;
                        const rollbacks = (specState?.rollbacksCount || 0) + (execState?.rollbacksCount || 0);
                        data.stats.totalRollbacks += rollbacks;

                        if (execState?.status === 'COMPLETED') data.stats.completed++;
                        else if (execState?.status === 'IN_PROGRESS') data.stats.inExecution++;
                        else if (specState?.currentNode === 'READY_FOR_EXECUTION') data.stats.readyForExec++;

                        // Collect artifacts list
                        const artifactsDir = path.join(specDir, 'artifacts');
                        const artifactsList = [];
                        if (fs.existsSync(artifactsDir)) {
                            try {
                                const files = fs.readdirSync(artifactsDir);
                                for (const f of files) {
                                    const stat = fs.statSync(path.join(artifactsDir, f));
                                    artifactsList.push({ name: f, size: stat.size, updated: stat.mtime });
                                }
                            } catch {}
                        }

                        data.specs.push({
                            specId,
                            title: specState?.title || specId,
                            specState,
                            execState,
                            artifacts: artifactsList,
                            worktreeExists: fs.existsSync(path.join(WORKTREES_DIR, specId))
                        });
                    }
                }
            }
        } catch {}
    }

    return data;
}

// --- Read Detailed Subagent History & Actions ---
async function getSubagentDetails(subId) {
    const data = {
        id: subId,
        role: 'subagent',
        status: 'idle',
        createdAt: null,
        lastActiveAt: null,
        lastSummary: null,
        lastAction: null,
        brief: null,
        sessionId: null,
        messages: []
    };

    // 1. Read from subagents.json ledger
    if (fs.existsSync(SUBAGENTS_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(SUBAGENTS_FILE, 'utf8'));
            if (raw.subagents && raw.subagents[subId]) {
                Object.assign(data, raw.subagents[subId]);
            }
        } catch {}
    }

    // 2. Read brief file from disk
    const briefCandidates = [
        path.join(SHARK_DIR, 'sdd', `task-${subId}-brief.md`),
        path.join(SHARK_DIR, 'sdd', `${subId}-brief.md`),
        path.join(SHARK_DIR, 'sdd', `task-${subId.replace(/^subagent-/, '')}-brief.md`)
    ];
    for (const cand of briefCandidates) {
        if (fs.existsSync(cand)) {
            try {
                data.brief = fs.readFileSync(cand, 'utf8');
                break;
            } catch {}
        }
    }

    // 3. Read session messages from state.db
    const stateDbPath = path.join(SHARK_DIR, 'state.db');
    if (fs.existsSync(stateDbPath)) {
        try {
            const { DatabaseSync } = await import('node:sqlite');
            const db = new DatabaseSync(stateDbPath);
            let row = db.prepare(`SELECT session_id FROM messages WHERE content LIKE ? AND role = 'user' AND (content LIKE '%modo SUBAGENTE%' OR content LIKE '%Seu ID é:%') LIMIT 1`).get('%' + subId + '%');
            if (!row) {
                row = db.prepare(`SELECT session_id FROM messages WHERE content LIKE ? AND role = 'user' AND content NOT LIKE '[Action invoke_subagent%' LIMIT 1`).get('%' + subId + '%');
            }

            if (row && row.session_id) {
                data.sessionId = row.session_id;
                const rows = db.prepare('SELECT id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC').all(row.session_id);
                data.messages = rows.map(r => {
                    let parsedThought = null;
                    let parsedAction = null;
                    let summary = null;
                    if (r.role === 'assistant') {
                        try {
                            const obj = JSON.parse(r.content);
                            parsedThought = obj.thought || null;
                            parsedAction = obj.action || null;
                            summary = obj.summary || null;
                        } catch {}
                    }
                    return {
                        id: r.id,
                        role: r.role,
                        content: r.content,
                        thought: parsedThought,
                        action: parsedAction,
                        summary,
                        timestamp: r.timestamp
                    };
                });
            }
        } catch (err) {
            console.error('Error reading subagent history from sqlite:', err);
        }
    }

    return data;
}

// --- SSE Client Registry ---
const sseClients = new Set();

function broadcastUpdate() {
    if (sseClients.size === 0) return;
    const payload = `data: ${JSON.stringify({ type: 'UPDATE', timestamp: Date.now() })}\n\n`;
    for (const res of sseClients) {
        try {
            res.write(payload);
        } catch {
            sseClients.delete(res);
        }
    }
}

// Watch filesystem for changes
function setupWatchers() {
    if (fs.existsSync(SHARK_DIR)) {
        try {
            fs.watch(SHARK_DIR, { recursive: true }, (eventType, filename) => {
                if (filename && (filename.endsWith('.json') || filename.endsWith('.md'))) {
                    broadcastUpdate();
                }
            });
        } catch {}
    }
}

// --- HTML Dashboard Page ---
function getDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shark AI — Live Graph Engineering Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-base: #060913;
            --bg-surface: rgba(14, 23, 42, 0.75);
            --bg-card: rgba(20, 32, 58, 0.65);
            --bg-card-hover: rgba(28, 45, 82, 0.85);
            --border-subtle: rgba(255, 255, 255, 0.08);
            --border-glow: rgba(0, 229, 255, 0.3);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --cyan-glow: #00e5ff;
            --blue-glow: #3b82f6;
            --purple-glow: #a855f7;
            --green-glow: #10b981;
            --red-glow: #f43f5e;
            --amber-glow: #f59e0b;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background-color: var(--bg-base);
            background-image: 
                radial-gradient(circle at 15% 15%, rgba(0, 229, 255, 0.07) 0%, transparent 40%),
                radial-gradient(circle at 85% 85%, rgba(168, 85, 247, 0.06) 0%, transparent 45%),
                linear-gradient(180deg, #060913 0%, #0a1020 100%);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            overflow-x: hidden;
        }

        /* --- Header --- */
        header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 32px;
            background: rgba(6, 9, 19, 0.85);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border-subtle);
            position: sticky;
            top: 0;
            z-index: 50;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand-logo {
            font-size: 26px;
            filter: drop-shadow(0 0 10px rgba(0, 229, 255, 0.6));
        }

        .brand-title {
            font-size: 20px;
            font-weight: 800;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #ffffff 0%, var(--cyan-glow) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .brand-subtitle {
            font-size: 11px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 600;
        }

        .connection-status {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: 500;
            color: var(--green-glow);
            background: rgba(16, 185, 129, 0.1);
            padding: 6px 14px;
            border-radius: 9999px;
            border: 1px solid rgba(16, 185, 129, 0.25);
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--green-glow);
            box-shadow: 0 0 10px var(--green-glow);
            animation: pulse-dot 2s infinite ease-in-out;
        }

        @keyframes pulse-dot {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.4); opacity: 0.7; }
        }

        /* --- Metrics Bar --- */
        .metrics-bar {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            padding: 24px 32px 0 32px;
        }

        .metric-card {
            background: var(--bg-surface);
            backdrop-filter: blur(16px);
            border: 1px solid var(--border-subtle);
            border-radius: 14px;
            padding: 16px 20px;
            display: flex;
            flex-direction: column;
            transition: all 0.25s ease;
        }

        .metric-card:hover {
            border-color: var(--border-glow);
            transform: translateY(-2px);
        }

        .metric-label {
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin-bottom: 6px;
        }

        .metric-value {
            font-size: 26px;
            font-weight: 800;
            font-family: 'JetBrains Mono', monospace;
            display: flex;
            align-items: baseline;
            gap: 8px;
        }

        /* --- Spec Selector Tabs --- */
        .spec-nav {
            padding: 24px 32px 12px 32px;
            display: flex;
            align-items: center;
            gap: 12px;
            overflow-x: auto;
        }

        .spec-tab {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            color: var(--text-secondary);
            padding: 10px 18px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .spec-tab:hover {
            background: var(--bg-card-hover);
            color: var(--text-primary);
        }

        .spec-tab.active {
            background: rgba(0, 229, 255, 0.12);
            color: var(--cyan-glow);
            border-color: var(--cyan-glow);
            box-shadow: 0 0 16px rgba(0, 229, 255, 0.2);
        }

        /* --- Main Content Layout --- */
        .main-container {
            display: flex;
            flex: 1;
            padding: 12px 32px 32px 32px;
            gap: 24px;
        }

        .graph-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .graph-section-card {
            background: var(--bg-surface);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border-subtle);
            border-radius: 18px;
            padding: 24px;
            position: relative;
            overflow: hidden;
        }

        .graph-section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
        }

        .section-title {
            font-size: 16px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--text-primary);
        }

        .section-badge {
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            text-transform: uppercase;
        }

        /* --- Nodes Pipeline Grid --- */
        .pipeline-track {
            display: flex;
            align-items: stretch;
            gap: 14px;
            overflow-x: auto;
            padding-bottom: 8px;
        }

        .pipeline-node {
            flex: 1;
            min-width: 170px;
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 12px;
            padding: 16px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            cursor: pointer;
            transition: all 0.25s ease;
            position: relative;
        }

        .pipeline-node:hover {
            transform: translateY(-3px);
            background: var(--bg-card-hover);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .pipeline-node.completed {
            border-color: rgba(16, 185, 129, 0.4);
            background: rgba(16, 185, 129, 0.05);
        }

        .pipeline-node.completed .node-step {
            color: var(--green-glow);
        }

        .pipeline-node.active {
            border-color: var(--cyan-glow);
            background: rgba(0, 229, 255, 0.08);
            box-shadow: 0 0 20px rgba(0, 229, 255, 0.25);
            animation: pulse-border 2s infinite ease-in-out;
        }

        .pipeline-node.active .node-step {
            color: var(--cyan-glow);
        }

        .pipeline-node.rollback {
            border-color: var(--red-glow);
            background: rgba(244, 63, 94, 0.08);
        }

        @keyframes pulse-border {
            0%, 100% { border-color: var(--cyan-glow); }
            50% { border-color: rgba(0, 229, 255, 0.4); }
        }

        .node-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .node-step {
            font-size: 11px;
            font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
            text-transform: uppercase;
        }

        .node-status-icon {
            font-size: 14px;
        }

        .node-title {
            font-size: 13px;
            font-weight: 700;
            line-height: 1.3;
            color: var(--text-primary);
        }

        .node-role-badge {
            font-size: 10px;
            font-weight: 600;
            padding: 3px 6px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.06);
            color: var(--text-secondary);
            width: fit-content;
            font-family: 'JetBrains Mono', monospace;
        }

        .node-artifact-pill {
            font-size: 11px;
            color: var(--cyan-glow);
            background: rgba(0, 229, 255, 0.08);
            padding: 4px 8px;
            border-radius: 6px;
            margin-top: auto;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border: 1px solid rgba(0, 229, 255, 0.15);
        }

        /* --- Subagents Live Sidebar --- */
        .subagents-sidebar {
            width: 360px;
            background: var(--bg-surface);
            backdrop-filter: blur(20px);
            border: 1px solid var(--border-subtle);
            border-radius: 18px;
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-height: calc(100vh - 180px);
            position: sticky;
            top: 90px;
        }

        .sidebar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--border-subtle);
        }

        .sidebar-title {
            font-size: 14px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .subagent-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
            padding-right: 4px;
        }

        .subagent-item {
            background: var(--bg-card);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            cursor: pointer;
            position: relative;
        }

        .subagent-item:hover {
            border-color: var(--cyan-glow);
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 229, 255, 0.15);
            background: var(--bg-card-hover);
        }

        .subagent-item.running {
            border-color: var(--cyan-glow);
            box-shadow: 0 0 12px rgba(0, 229, 255, 0.15);
        }

        .subagent-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .subagent-role {
            font-size: 12px;
            font-weight: 700;
            color: var(--cyan-glow);
            font-family: 'JetBrains Mono', monospace;
        }

        .subagent-status {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            padding: 2px 6px;
            border-radius: 4px;
        }

        .subagent-status.running {
            background: rgba(0, 229, 255, 0.2);
            color: var(--cyan-glow);
        }

        .subagent-status.completed {
            background: rgba(16, 185, 129, 0.2);
            color: var(--green-glow);
        }

        .subagent-status.failed {
            background: rgba(244, 63, 94, 0.2);
            color: var(--red-glow);
        }

        .subagent-action {
            font-size: 11px;
            color: var(--text-secondary);
            font-family: 'JetBrains Mono', monospace;
            background: rgba(0, 0, 0, 0.25);
            padding: 4px 6px;
            border-radius: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .subagent-view-hint {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: var(--cyan-glow);
            font-weight: 600;
            opacity: 0.8;
            margin-top: 4px;
            transition: opacity 0.2s ease;
        }

        .subagent-item:hover .subagent-view-hint {
            opacity: 1;
            text-decoration: underline;
        }

        /* --- Slide-Over Inspector Drawer --- */
        .drawer-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(4px);
            z-index: 100;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }

        .drawer-overlay.open {
            opacity: 1;
            pointer-events: auto;
        }

        .drawer {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 650px;
            max-width: 90vw;
            background: #090f1e;
            border-left: 1px solid var(--border-subtle);
            box-shadow: -10px 0 30px rgba(0, 0, 0, 0.8);
            z-index: 101;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
        }

        .drawer.open {
            transform: translateX(0);
        }

        .drawer-header {
            padding: 20px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid var(--border-subtle);
        }

        .drawer-title {
            font-size: 18px;
            font-weight: 700;
            color: var(--cyan-glow);
        }

        .drawer-close {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-size: 20px;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 6px;
        }

        .drawer-close:hover {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.1);
        }

        .drawer-body {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.6;
            color: #cbd5e1;
            word-break: break-word;
        }

        .drawer-body.raw-text {
            font-family: 'JetBrains Mono', monospace;
            white-space: pre-wrap;
        }

        /* Markdown code blocks styling inside drawer */
        .drawer-body pre {
            background: #040711;
            padding: 16px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            overflow-x: auto;
            margin: 12px 0;
        }

        /* --- Subagent Detailed Inspector Styles --- */
        .sub-details-container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            font-family: 'Outfit', sans-serif;
        }

        .sub-meta-card {
            background: rgba(14, 23, 42, 0.85);
            border: 1px solid var(--border-subtle);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .sub-meta-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
        }

        .sub-meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: 12px;
            margin-top: 4px;
            font-size: 12px;
        }

        .sub-meta-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .sub-meta-label {
            color: var(--text-muted);
            font-size: 11px;
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .sub-meta-val {
            color: var(--text-primary);
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
        }

        .sub-refresh-btn {
            background: rgba(0, 229, 255, 0.1);
            color: var(--cyan-glow);
            border: 1px solid rgba(0, 229, 255, 0.3);
            border-radius: 6px;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .sub-refresh-btn:hover {
            background: rgba(0, 229, 255, 0.2);
            box-shadow: 0 0 10px rgba(0, 229, 255, 0.3);
        }

        .sub-brief-details {
            background: rgba(10, 16, 30, 0.6);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            padding: 12px 16px;
        }

        .sub-brief-details summary {
            cursor: pointer;
            font-weight: 600;
            color: var(--cyan-glow);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
        }

        .sub-brief-box {
            margin-top: 12px;
            max-height: 250px;
            overflow-y: auto;
            background: rgba(4, 7, 17, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            white-space: pre-wrap;
            color: #94a3b8;
        }

        .timeline-section-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .turn-card {
            background: rgba(14, 23, 42, 0.7);
            border: 1px solid var(--border-subtle);
            border-radius: 10px;
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: relative;
        }

        .turn-card.user {
            border-left: 4px solid var(--blue-glow);
        }

        .turn-card.assistant {
            border-left: 4px solid var(--purple-glow);
            background: rgba(20, 28, 52, 0.75);
        }

        .turn-card.tool-success {
            border-left: 4px solid var(--green-glow);
        }

        .turn-card.tool-error {
            border-left: 4px solid var(--red-glow);
        }

        .turn-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 11px;
            color: var(--text-muted);
        }

        .turn-badge {
            font-weight: 700;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .turn-badge.prompt {
            background: rgba(59, 130, 246, 0.15);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
        }

        .turn-badge.agent {
            background: rgba(168, 85, 247, 0.15);
            color: #c084fc;
            border: 1px solid rgba(168, 85, 247, 0.3);
        }

        .turn-badge.tool {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .turn-badge.error {
            background: rgba(244, 63, 94, 0.15);
            color: #fb7185;
            border: 1px solid rgba(244, 63, 94, 0.3);
        }

        .thought-bubble {
            background: rgba(168, 85, 247, 0.08);
            border: 1px solid rgba(168, 85, 247, 0.2);
            border-radius: 8px;
            padding: 10px 12px;
            color: #e2e8f0;
            font-size: 12px;
            line-height: 1.5;
            font-style: italic;
        }

        .action-bubble {
            background: rgba(0, 229, 255, 0.05);
            border: 1px solid rgba(0, 229, 255, 0.2);
            border-radius: 8px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .action-title {
            color: var(--cyan-glow);
            font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .action-args {
            background: rgba(4, 7, 17, 0.8) !important;
            border-radius: 6px;
            padding: 8px 10px !important;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: #94a3b8;
            max-height: 150px;
            overflow-y: auto;
            white-space: pre-wrap;
            margin: 0 !important;
        }

        .output-box {
            background: rgba(4, 7, 17, 0.85);
            border-radius: 6px;
            padding: 10px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: #cbd5e1;
            max-height: 220px;
            overflow-y: auto;
            white-space: pre-wrap;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <div class="brand-logo">🦈</div>
            <div>
                <div class="brand-title">SHARK AI • GRAPH ENGINE</div>
                <div class="brand-subtitle">Autonomous Graph Orchestrator</div>
            </div>
        </div>
        <div class="connection-status">
            <div class="status-dot"></div>
            <span>LIVE MONITORING</span>
        </div>
    </header>

    <div class="metrics-bar" id="metricsBar">
        <div class="metric-card">
            <span class="metric-label">Total Specs</span>
            <div class="metric-value" id="valTotalSpecs">-</div>
        </div>
        <div class="metric-card">
            <span class="metric-label">In Execution</span>
            <div class="metric-value" style="color: var(--cyan-glow);" id="valInExecution">-</div>
        </div>
        <div class="metric-card">
            <span class="metric-label">Completed</span>
            <div class="metric-value" style="color: var(--green-glow);" id="valCompleted">-</div>
        </div>
        <div class="metric-card">
            <span class="metric-label">Active Subagents</span>
            <div class="metric-value" style="color: var(--purple-glow);" id="valActiveSubagents">-</div>
        </div>
        <div class="metric-card">
            <span class="metric-label">Rollbacks Caught</span>
            <div class="metric-value" style="color: var(--red-glow);" id="valRollbacks">-</div>
        </div>
    </div>

    <div class="spec-nav" id="specTabs">
        <!-- Spec tabs rendered dynamically -->
    </div>

    <div class="main-container">
        <div class="graph-area">
            <!-- SPECIFICATION GRAPH -->
            <div class="graph-section-card">
                <div class="graph-section-header">
                    <div class="section-title">
                        <span>📐 Specification Pipeline (spec-driven-graph)</span>
                        <span class="section-badge" style="background: rgba(0,229,255,0.15); color: var(--cyan-glow);" id="specGraphStatus">READY</span>
                    </div>
                </div>
                <div class="pipeline-track" id="specPipelineTrack">
                    <!-- Nodes rendered dynamically -->
                </div>
            </div>

            <!-- EXECUTION GRAPH -->
            <div class="graph-section-card">
                <div class="graph-section-header">
                    <div class="section-title">
                        <span>⚡ TDD Worktree Execution (graph-driven-execution)</span>
                        <span class="section-badge" style="background: rgba(16,185,129,0.15); color: var(--green-glow);" id="execGraphStatus">IN_PROGRESS</span>
                    </div>
                </div>
                <div class="pipeline-track" id="execPipelineTrack">
                    <!-- Tasks rendered dynamically -->
                </div>
            </div>
        </div>

        <!-- SUBAGENTS SIDEBAR -->
        <div class="subagents-sidebar">
            <div class="sidebar-header">
                <div class="sidebar-title">
                    <span>🤖 Subagents Fleet</span>
                </div>
                <span class="section-badge" style="background: rgba(168,85,247,0.15); color: var(--purple-glow);" id="subagentCountBadge">0</span>
            </div>
            <div class="subagent-list" id="subagentList">
                <!-- Subagents rendered dynamically -->
            </div>
        </div>
    </div>

    <!-- INSPECTOR DRAWER -->
    <div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>
    <div class="drawer" id="drawer">
        <div class="drawer-header">
            <div class="drawer-title" id="drawerTitle">Artifact Inspector</div>
            <button class="drawer-close" onclick="closeDrawer()">✕</button>
        </div>
        <div class="drawer-body" id="drawerBody">Loading...</div>
    </div>

    <script>
        let currentSpecId = null;
        let globalState = null;

        const SPEC_NODES = [
            { id: 'CONTEXT_GROUNDING', title: 'Context Grounding', role: 'researcher', artifact: 'context-pack.md' },
            { id: 'DISCOVERY_ELICITATION', title: 'Discovery Elicitation', role: 'analyst', artifact: 'brief.md' },
            { id: 'HYPOTHESIS_SPIKES', title: 'Empirical Spikes', role: 'spike-tester', artifact: 'spikes.md' },
            { id: 'TECHNICAL_ARCHITECTURE', title: 'Technical Architecture', role: 'architect', artifact: 'design.md' },
            { id: 'ADVERSARIAL_CRITIQUE', title: 'Adversarial Critique', role: 'reviewer', artifact: 'critique.md' },
            { id: 'TDD_PLAN_DECOMPOSITION', title: 'TDD Decomposition', role: 'planner', artifact: 'plan.md' },
            { id: 'PLAN_AUDIT', title: 'Plan Audit', role: 'plan-auditor', artifact: 'plan-critique.md' },
            { id: 'READY_FOR_EXECUTION', title: 'Ready for Execution', role: 'coordinator', artifact: null }
        ];

        async function fetchState() {
            try {
                const res = await fetch('/api/state');
                const data = await res.json();
                globalState = data;
                renderDashboard(data);
            } catch (err) {
                console.error('Fetch error:', err);
            }
        }

        function renderDashboard(data) {
            // Metrics
            document.getElementById('valTotalSpecs').textContent = data.stats.totalSpecs;
            document.getElementById('valInExecution').textContent = data.stats.inExecution;
            document.getElementById('valCompleted').textContent = data.stats.completed;
            document.getElementById('valActiveSubagents').textContent = data.stats.activeSubagents;
            document.getElementById('valRollbacks').textContent = data.stats.totalRollbacks;

            // Spec Tabs
            const tabsContainer = document.getElementById('specTabs');
            tabsContainer.innerHTML = '';
            if (data.specs.length > 0) {
                if (!currentSpecId || !data.specs.some(s => s.specId === currentSpecId)) {
                    currentSpecId = data.specs[0].specId;
                }
                data.specs.forEach(s => {
                    const btn = document.createElement('button');
                    btn.className = 'spec-tab' + (s.specId === currentSpecId ? ' active' : '');
                    btn.innerHTML = '<span>📄</span> ' + s.specId;
                    btn.onclick = () => {
                        currentSpecId = s.specId;
                        renderDashboard(data);
                    };
                    tabsContainer.appendChild(btn);
                });
            }

            // Current Spec Data
            const currentSpec = data.specs.find(s => s.specId === currentSpecId);
            if (!currentSpec) return;

            renderSpecPipeline(currentSpec);
            renderExecPipeline(currentSpec);
            renderSubagents(data.subagents);
        }

        function renderSpecPipeline(spec) {
            const track = document.getElementById('specPipelineTrack');
            track.innerHTML = '';

            const specState = spec.specState || {};
            const currentNode = specState.currentNode || 'CONTEXT_GROUNDING';
            const history = specState.history || [];
            const rollbacksCount = specState.rollbacksCount || 0;

            document.getElementById('specGraphStatus').textContent = currentNode;

            const currentIndex = SPEC_NODES.findIndex(n => n.id === currentNode);

            SPEC_NODES.forEach((node, idx) => {
                const el = document.createElement('div');
                let statusClass = '';
                let statusIcon = '⏳';

                if (idx < currentIndex || currentNode === 'READY_FOR_EXECUTION') {
                    statusClass = 'completed';
                    statusIcon = '✅';
                } else if (idx === currentIndex) {
                    statusClass = 'active';
                    statusIcon = '⚡';
                }

                if (node.id === 'ADVERSARIAL_CRITIQUE' && rollbacksCount > 0) {
                    statusClass += ' rollback';
                }

                el.className = 'pipeline-node ' + statusClass;
                el.innerHTML = \`
                    <div class="node-top">
                        <span class="node-step">Node \${idx}</span>
                        <span class="node-status-icon">\${statusIcon}</span>
                    </div>
                    <div class="node-title">\${node.title}</div>
                    <div class="node-role-badge">\${node.role}</div>
                    \${node.id === 'ADVERSARIAL_CRITIQUE' && specState.auditScore !== undefined ? \`
                        <div style="margin-top:6px; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; display:inline-block; background:\${specState.auditScore >= 9 ? 'rgba(16,185,129,0.15)' : specState.auditScore >= 7 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'}; color:\${specState.auditScore >= 9 ? '#10b981' : specState.auditScore >= 7 ? '#f59e0b' : '#ef4444'};">
                            ⭐ \${specState.auditScore}/10
                        </div>\` : ''}
                    \${node.id === 'PLAN_AUDIT' && specState.planAuditScore !== undefined ? \`
                        <div style="margin-top:6px; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; display:inline-block; background:\${specState.planAuditScore >= 9 ? 'rgba(16,185,129,0.15)' : specState.planAuditScore >= 7 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'}; color:\${specState.planAuditScore >= 9 ? '#10b981' : specState.planAuditScore >= 7 ? '#f59e0b' : '#ef4444'};">
                            ⭐ \${specState.planAuditScore}/10
                        </div>\` : ''}
                    \${node.artifact ? \`<div class="node-artifact-pill">📄 \${node.artifact}</div>\` : ''}
                \`;

                if (node.artifact) {
                    el.onclick = () => openArtifact(spec.specId, node.artifact);
                }

                track.appendChild(el);
            });
        }

        function renderExecPipeline(spec) {
            const track = document.getElementById('execPipelineTrack');
            track.innerHTML = '';

            const execState = spec.execState;
            if (!execState) {
                track.innerHTML = '<div style="color: var(--text-muted); font-size: 13px; padding: 12px;">No active execution for this spec yet.</div>';
                document.getElementById('execGraphStatus').textContent = 'NOT_STARTED';
                return;
            }

            document.getElementById('execGraphStatus').textContent = execState.status;

            const tasks = execState.tasks || [];
            tasks.forEach((task, idx) => {
                const el = document.createElement('div');
                let statusClass = '';
                let statusIcon = '⏳';

                if (task.status === 'COMPLETED') {
                    statusClass = 'completed';
                    statusIcon = '✅';
                } else if (task.status === 'IN_PROGRESS') {
                    statusClass = 'active';
                    statusIcon = '⚡';
                }

                el.className = 'pipeline-node ' + statusClass;
                el.innerHTML = \`
                    <div class="node-top">
                        <span class="node-step">Task \${task.taskNumber || idx + 1}</span>
                        <span class="node-status-icon">\${statusIcon}</span>
                    </div>
                    <div class="node-title">\${task.title}</div>
                    \${task.commitHash ? \`<div class="node-role-badge" style="color: var(--green-glow);">commit \${task.commitHash}</div>\` : '<div class="node-role-badge">TDD Cycle</div>'}
                    <div class="node-artifact-pill">🔍 View Task Critique</div>
                \`;

                el.onclick = () => openArtifact(spec.specId, \`task-\${task.taskNumber}-critique.md\`);

                track.appendChild(el);
            });
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderSubagents(subagents) {
            const list = document.getElementById('subagentList');
            list.innerHTML = '';

            const entries = Object.values(subagents || {});
            document.getElementById('subagentCountBadge').textContent = entries.length;

            if (entries.length === 0) {
                list.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 8px;">No subagents recorded.</div>';
                return;
            }

            entries.slice().reverse().forEach(sub => {
                const el = document.createElement('div');
                const subRole = sub.role || 'subagent';
                const subStatus = sub.status || (sub.lastAction ? 'running' : 'idle');
                el.className = 'subagent-item ' + (subStatus === 'running' ? 'running' : '');
                
                const actionTool = sub.lastAction?.tool || 'idle';
                const ts = sub.lastActiveAt || sub.endedAt || sub.createdAt;
                let timeFormatted = '';
                if (ts) {
                    const d = new Date(ts);
                    timeFormatted = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                }

                el.innerHTML = \`
                    <div class="subagent-header">
                        <span class="subagent-role">\${escapeHtml(subRole)}</span>
                        <span class="subagent-status \${escapeHtml(subStatus)}">\${escapeHtml(subStatus)}</span>
                    </div>
                    <div class="subagent-action">🛠️ \${escapeHtml(actionTool)}</div>
                    \${timeFormatted ? \`<div style="font-size: 11px; color: var(--cyan-glow); display: flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums;"><span>🕒</span> <span>\${timeFormatted}</span></div>\` : ''}
                    \${sub.lastSummary ? \`<div style="font-size: 11px; color: var(--text-muted); line-height: 1.3;" title="\${escapeHtml(sub.lastSummary)}">\${escapeHtml(sub.lastSummary)}</div>\` : ''}
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                        <span style="font-size: 9px; color: var(--text-muted); font-family: monospace; opacity: 0.7;">\${escapeHtml(sub.id ? sub.id.slice(0, 16) + '...' : '')}</span>
                        <span class="subagent-view-hint">Ver histórico 🔍 ➔</span>
                    </div>
                \`;

                el.onclick = () => openSubagentDetails(sub.id);

                list.appendChild(el);
            });
        }

        // --- Drawer Functions ---
        let activeSubagentId = null;

        async function openSubagentDetails(subId) {
            activeSubagentId = subId;
            const drawer = document.getElementById('drawer');
            const overlay = document.getElementById('drawerOverlay');
            const title = document.getElementById('drawerTitle');
            const body = document.getElementById('drawerBody');

            title.innerHTML = \`🤖 Subagente <span style="font-family: monospace; font-size: 13px; color: var(--cyan-glow); font-weight: normal;">\${escapeHtml(subId.slice(0, 18))}...</span>\`;
            body.className = 'drawer-body';
            body.innerHTML = \`
                <div style="display: flex; align-items: center; gap: 12px; color: var(--cyan-glow); padding: 30px 20px;">
                    <div class="status-dot" style="animation: pulse 1.5s infinite;"></div>
                    <span style="font-size: 14px;">Carregando histórico do subagente...</span>
                </div>
            \`;

            drawer.classList.add('open');
            overlay.classList.add('open');

            try {
                const res = await fetch(\`/api/subagent-details?id=\${encodeURIComponent(subId)}\`);
                if (!res.ok) throw new Error(\`Falha ao obter histórico (\${res.status})\`);
                const data = await res.json();
                renderSubagentDrawer(data, body, title);
            } catch (err) {
                body.innerHTML = \`<div style="color: var(--red-glow); padding: 20px;">Erro ao carregar histórico: \${escapeHtml(err.message)}</div>\`;
            }
        }

        function renderSubagentDrawer(data, body, title) {
            const subRole = data.role || 'subagent';
            const subStatus = data.status || 'idle';
            const subId = data.id || 'unknown';

            title.innerHTML = \`🤖 \${escapeHtml(subRole)} <span style="font-family: monospace; font-size: 12px; color: var(--text-muted); font-weight: normal;">(\${escapeHtml(subId.slice(0, 14))}...)</span>\`;

            let metaHtml = \`
                <div class="sub-meta-card">
                    <div class="sub-meta-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="subagent-role" style="font-size: 14px;">\${escapeHtml(subRole)}</span>
                            <span class="subagent-status \${escapeHtml(subStatus)}">\${escapeHtml(subStatus)}</span>
                        </div>
                        <button class="sub-refresh-btn" onclick="openSubagentDetails('\${escapeHtml(subId)}')">
                            🔄 Atualizar Histórico
                        </button>
                    </div>
                    <div class="sub-meta-grid">
                        <div class="sub-meta-item">
                            <span class="sub-meta-label">ID do Subagente</span>
                            <span class="sub-meta-val" title="\${escapeHtml(subId)}">\${escapeHtml(subId.slice(0, 20))}...</span>
                        </div>
                        <div class="sub-meta-item">
                            <span class="sub-meta-label">Status</span>
                            <span class="sub-meta-val" style="color: \${subStatus === 'running' ? 'var(--cyan-glow)' : subStatus === 'completed' ? 'var(--green-glow)' : subStatus === 'failed' ? 'var(--red-glow)' : 'var(--text-primary)'}; font-weight: 700;">\${escapeHtml(subStatus.toUpperCase())}</span>
                        </div>
                        <div class="sub-meta-item">
                            <span class="sub-meta-label">Iniciado Em</span>
                            <span class="sub-meta-val">\${data.createdAt ? new Date(data.createdAt).toLocaleTimeString() : '-'}</span>
                        </div>
                        <div class="sub-meta-item">
                            <span class="sub-meta-label">Última Atividade</span>
                            <span class="sub-meta-val">\${data.lastActiveAt ? new Date(data.lastActiveAt).toLocaleTimeString() : '-'}</span>
                        </div>
                    </div>
                    \${data.lastSummary ? \`
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-subtle); font-size: 12px; color: var(--text-secondary);">
                            <span style="color: var(--text-muted); font-weight: 600;">Resumo:</span> \${escapeHtml(data.lastSummary)}
                        </div>
                    \` : ''}
                    \${data.lastAction ? \`
                        <div style="font-size: 11px; color: var(--cyan-glow); font-family: 'JetBrains Mono', monospace;">
                            🛠️ Última Ação Executada: <strong>\${escapeHtml(data.lastAction.tool || 'none')}</strong>
                        </div>
                    \` : ''}
                </div>
            \`;

            let briefHtml = '';
            if (data.brief) {
                briefHtml = \`
                    <details class="sub-brief-details">
                        <summary>📄 Brief & Instruções da Tarefa (\${data.brief.split('\\n').length} linhas)</summary>
                        <div class="sub-brief-box">\${escapeHtml(data.brief)}</div>
                    </details>
                \`;
            }

            const messages = data.messages || [];
            let timelineHtml = \`
                <div>
                    <div class="timeline-section-title">
                        <span>💬 Histórico de Mensagens & Ações (\${messages.length} eventos)</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
            \`;

            if (messages.length === 0) {
                timelineHtml += \`
                    <div style="background: rgba(14, 23, 42, 0.5); border: 1px dashed var(--border-subtle); border-radius: 8px; padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;">
                        Nenhuma mensagem ou ação gravada ainda para este subagente no banco de dados local.
                    </div>
                \`;
            } else {
                messages.forEach((msg, idx) => {
                    const isAssistant = msg.role === 'assistant';
                    const isUser = msg.role === 'user';
                    const isToolResult = isUser && msg.content && (msg.content.startsWith('[Action ') || msg.content.startsWith('[SYSTEM ERROR]'));
                    const isError = isUser && msg.content && msg.content.startsWith('[SYSTEM ERROR]');
                    const isInitialPrompt = isUser && idx === 0;

                    let cardClass = isAssistant ? 'assistant' : isError ? 'tool-error' : isToolResult ? 'tool-success' : 'user';
                    let badgeClass = isInitialPrompt ? 'prompt' : isAssistant ? 'agent' : isError ? 'error' : isToolResult ? 'tool' : 'prompt';
                    let badgeLabel = isInitialPrompt ? '🎯 Instrução Inicial' : isAssistant ? '🤖 Agente' : isError ? '⚠️ Erro Validação' : isToolResult ? '✔ Tool Output' : '👤 User';

                    let timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : '';

                    timelineHtml += \`
                        <div class="turn-card \${cardClass}">
                            <div class="turn-header">
                                <span class="turn-badge \${badgeClass}">\${badgeLabel} #\${msg.id || idx + 1}</span>
                                <span>\${escapeHtml(timeStr)}</span>
                            </div>
                    \`;

                    if (isAssistant) {
                        if (msg.thought) {
                            timelineHtml += \`
                                <div class="thought-bubble">
                                    <div style="font-weight: 700; color: #c084fc; margin-bottom: 4px; font-style: normal; font-size: 11px;">💭 Raciocínio (Thought):</div>
                                    \${escapeHtml(msg.thought)}
                                </div>
                            \`;
                        }

                        if (msg.action) {
                            timelineHtml += \`
                                <div class="action-bubble">
                                    <div class="action-title">
                                        <span>🛠️ Ação Chamada:</span>
                                        <span style="color: #fff; background: rgba(0, 229, 255, 0.15); padding: 2px 6px; border-radius: 4px;">\${escapeHtml(msg.action.type || 'unknown')}</span>
                                    </div>
                                    \${msg.action.args ? \`
                                        <pre class="action-args">\${escapeHtml(JSON.stringify(msg.action.args, null, 2))}</pre>
                                    \` : ''}
                                </div>
                            \`;
                        }

                        if (!msg.thought && !msg.action && msg.content) {
                            timelineHtml += \`<div class="output-box">\${escapeHtml(msg.content)}</div>\`;
                        }
                    } else if (isToolResult || isError) {
                        timelineHtml += \`
                            <div class="output-box">\${escapeHtml(msg.content)}</div>
                        \`;
                    } else {
                        // User Prompt
                        timelineHtml += \`
                            <div class="output-box" style="max-height: 180px;">\${escapeHtml(msg.content)}</div>
                        \`;
                    }

                    timelineHtml += \`</div>\`;
                });
            }

            timelineHtml += \`
                    </div>
                </div>
            \`;

            body.innerHTML = \`
                <div class="sub-details-container">
                    \${metaHtml}
                    \${briefHtml}
                    \${timelineHtml}
                </div>
            \`;
        }

        async function openArtifact(specId, filename) {
            activeSubagentId = null;
            const drawer = document.getElementById('drawer');
            const overlay = document.getElementById('drawerOverlay');
            const title = document.getElementById('drawerTitle');
            const body = document.getElementById('drawerBody');

            title.textContent = filename;
            body.className = 'drawer-body raw-text';
            body.textContent = 'Loading ' + filename + '...';

            drawer.classList.add('open');
            overlay.classList.add('open');

            try {
                const res = await fetch(\`/api/artifact?spec=\${specId}&name=\${filename}\`);
                if (res.ok) {
                    const text = await res.text();
                    body.textContent = text;
                } else {
                    body.textContent = 'Artifact file not yet generated or not found: ' + filename;
                }
            } catch (err) {
                body.textContent = 'Error loading artifact: ' + err.message;
            }
        }

        function closeDrawer() {
            activeSubagentId = null;
            document.getElementById('drawer').classList.remove('open');
            document.getElementById('drawerOverlay').classList.remove('open');
        }

        // --- SSE Live Updates ---
        function initSSE() {
            const evtSource = new EventSource('/api/stream');
            evtSource.onmessage = (event) => {
                fetchState();
            };
            evtSource.onerror = () => {
                setTimeout(initSSE, 3000);
            };
        }

        // Start
        fetchState();
        initSSE();
        // Polling fallback every 3s
        setInterval(fetchState, 3000);
    </script>
</body>
</html>`;
}

// --- HTTP Request Handler ---
async function handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
        return;
    }

    if (parsedUrl.pathname === '/api/state') {
        const state = getFullState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
    }

    if (parsedUrl.pathname === '/api/subagent-details') {
        const subId = parsedUrl.searchParams.get('id');
        if (!subId) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing subagent id param');
            return;
        }

        try {
            const details = await getSubagentDetails(subId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(details));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error retrieving subagent details: ' + err.message);
        }
        return;
    }

    if (parsedUrl.pathname === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
        sseClients.add(res);

        req.on('close', () => {
            sseClients.delete(res);
        });
        return;
    }

    if (parsedUrl.pathname === '/api/artifact') {
        const specId = parsedUrl.searchParams.get('spec');
        const name = parsedUrl.searchParams.get('name');
        if (!specId || !name) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing spec or name param');
            return;
        }

        // Sanitize name
        const cleanName = path.basename(name);
        const artifactPath = path.join(SPECS_DIR, specId, 'artifacts', cleanName);

        if (fs.existsSync(artifactPath)) {
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
            res.end(fs.readFileSync(artifactPath, 'utf8'));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end(`Artifact not found: ${cleanName}`);
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
}

// --- Server Launcher ---
export function startServer(port = DEFAULT_PORT) {
    const server = http.createServer(handleRequest);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} is in use, trying port ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, () => {
        console.log(`\n======================================================`);
        console.log(`🦈 [SHARK AI] Live Graph Engineering Dashboard`);
        console.log(`🌐 Dashboard running at: http://localhost:${port}`);
        console.log(`⚡ Real-time SSE active on: ${SHARK_DIR}`);
        console.log(`======================================================\n`);
        setupWatchers();
    });
}

// If executed directly from CLI
if (process.argv[1] && process.argv[1].endsWith('graph-dashboard.mjs')) {
    const portArg = process.argv.find((a, i) => process.argv[i - 1] === '--port') || DEFAULT_PORT;
    startServer(parseInt(portArg, 10));
}
