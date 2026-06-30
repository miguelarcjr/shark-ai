# Membox Memory Graph Command Implementation Plan (Updated with Active Glow & Edge Weights)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local HTTP server and an interactive HTML web-based memory network graph visualizer that displays memory boxes and event traces in real-time, featuring edge thickness based on similarity scores and active node highlighting (Active Glow) when launched via `shark dev --graph`.

**Architecture:** 
- A lightweight Node HTTP server is spawned by `shark graph` or automatically by `shark dev --graph`.
- The server serves a beautiful dark-mode single-page visualization and endpoints:
  - `GET /api/graph` - returns nodes, edges, and currently active glowing nodes.
  - `POST /api/active-nodes` - accepts a list of active node IDs to highlight.
- `MemboxManager.retrieveContext` makes a fire-and-forget POST to the active graph server port if `--graph` is enabled.

**Tech Stack:** Node.js http module, Commander.js, Vis.js Network, Tailwind CSS.

## Global Constraints
- Target Port: 4200 (auto-increment if occupied).
- Dark mode theme must use Inter font and glassmorphism cards.
- Live reload of graph data via client-side polling every 3 seconds.

---

### Task 1: Web Dashboard HTML Template (with Glow & Dynamic Edge weights)

**Files:**
- Create: `src/commands/graph-html.ts`

**Interfaces:**
- Produces: `export const GRAPH_HTML_TEMPLATE: string`

- [ ] **Step 1: Create/Update the HTML template string file**

Write the HTML template including Vis.js, Tailwind, active glow animation, and custom edge weights styling:

```typescript
export const GRAPH_HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shark Dev Memory Graph</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #0b0f19; color: #f3f4f6; }
        .glass { background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08); }
    </style>
</head>
<body class="h-screen w-screen overflow-hidden flex flex-col">
    <!-- Header -->
    <header class="h-16 px-6 border-b border-white/5 flex items-center justify-between glass z-10">
        <div class="flex items-center gap-3">
            <span class="text-2xl">🦈</span>
            <h1 class="text-lg font-semibold tracking-wide">Shark Memory Graph</h1>
        </div>
        <div class="flex items-center gap-4">
            <input type="text" id="searchInput" placeholder="Search topics/events..." class="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-blue-500/50 w-64">
            <div class="flex bg-white/5 rounded-lg p-0.5 border border-white/5">
                <button id="btnBoxes" class="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white transition-all">Boxes Network</button>
                <button id="btnTimeline" class="px-4 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white transition-all">Event Flow</button>
            </div>
        </div>
    </header>

    <!-- Main Content -->
    <div class="flex-1 flex relative">
        <!-- Canvas -->
        <div id="network" class="flex-1 h-full"></div>

        <!-- Sidebar -->
        <aside id="sidebar" class="w-96 glass border-l border-white/5 flex flex-col translate-x-full transition-transform duration-300 absolute right-0 top-0 bottom-0 z-20">
            <div class="p-6 border-b border-white/5 flex items-center justify-between">
                <h2 id="sidebarTitle" class="text-lg font-semibold text-blue-400">Node Details</h2>
                <button id="btnCloseSidebar" class="text-gray-400 hover:text-white text-lg">&times;</button>
            </div>
            <div id="sidebarContent" class="flex-1 overflow-y-auto p-6 space-y-4">
                <!-- Filled dynamically -->
            </div>
        </aside>

        <!-- Empty State overlay -->
        <div id="emptyState" class="absolute inset-0 bg-[#0b0f19]/90 flex items-center justify-center hidden z-30">
            <div class="max-w-md p-8 rounded-2xl glass text-center space-y-4">
                <div class="text-4xl">💭</div>
                <h3 class="text-xl font-bold">Awaiting Memories...</h3>
                <p class="text-sm text-gray-400">Start a chat session using <code class="bg-black/30 px-1.5 py-0.5 rounded text-blue-400">shark dev --graph</code> in another terminal to generate memory boxes.</p>
            </div>
        </div>
    </div>

    <script>
        let network = null;
        let currentMode = 'boxes';
        let graphData = { nodes: [], edges: [] };
        let lastDataString = '';
        
        async function fetchGraphData() {
            try {
                const res = await fetch(\`/api/graph?mode=\${currentMode}\`);
                const data = await res.json();
                
                const container = document.getElementById('emptyState');
                if (data.nodes.length === 0) {
                    container.classList.remove('hidden');
                    return;
                }
                container.classList.add('hidden');
                
                const currentDataString = JSON.stringify(data);
                if (currentDataString === lastDataString) {
                    highlightActiveNodes(data.activeNodes);
                    return;
                }
                lastDataString = currentDataString;
                
                updateNetwork(data);
            } catch (err) {
                console.error("Error fetching graph data:", err);
            }
        }

        function getOptionsForMode(mode) {
            if (mode === 'timeline') {
                return {
                    layout: {
                        hierarchical: {
                            enabled: true,
                            direction: 'LR',
                            sortMethod: 'directed',
                            nodeSpacing: 200,
                            levelSeparation: 250
                        }
                    },
                    physics: { enabled: false },
                    interaction: { hover: true }
                };
            } else {
                return {
                    layout: { hierarchical: { enabled: false } },
                    physics: {
                        enabled: true,
                        solver: 'forceAtlas2Based',
                        forceAtlas2Based: { gravitationalConstant: -50, centralGravity: 0.01, springLength: 100 }
                    },
                    interaction: { hover: true }
                };
            }
        }

        function updateNetwork(data) {
            graphData = data;
            const container = document.getElementById('network');
            
            const visNodes = new vis.DataSet(data.nodes.map(n => {
                const isActive = data.activeNodes && data.activeNodes.includes(n.id);
                return {
                    id: n.id,
                    label: n.label,
                    size: n.size || 15,
                    shape: n.type === 'box' ? 'dot' : 'circle',
                    color: {
                        background: isActive ? '#f59e0b' : (n.type === 'box' ? '#1e40af' : '#065f46'),
                        border: isActive ? '#fbbf24' : (n.type === 'box' ? '#3b82f6' : '#10b981'),
                        highlight: { background: '#2563eb', border: '#60a5fa' }
                    },
                    font: { color: '#f3f4f6', face: 'Inter', size: 12 }
                };
            }));

            const visEdges = new vis.DataSet(data.edges.map(e => {
                // Similarity-based edge thickness (e.similarity from 0.0 to 1.0)
                const width = e.similarity ? Math.max(1, Math.round(e.similarity * 6)) : 2;
                const isWeak = e.similarity && e.similarity < 0.6;
                return {
                    from: e.from,
                    to: e.to,
                    label: e.label,
                    arrows: e.arrows || '',
                    width: width,
                    dashes: isWeak ? true : false,
                    color: { color: '#4b5563', highlight: '#9ca3af' },
                    font: { color: '#9ca3af', face: 'Inter', size: 10 }
                };
            }));

            if (network) {
                network.setData({ nodes: visNodes, edges: visEdges });
                network.setOptions(getOptionsForMode(currentMode));
            } else {
                network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, getOptionsForMode(currentMode));
                
                network.on('click', function(params) {
                    if (params.nodes.length > 0) {
                        showSidebar(params.nodes[0]);
                    } else {
                        hideSidebar();
                    }
                });
            }
        }

        function highlightActiveNodes(activeNodeIds) {
            if (!network || !activeNodeIds || activeNodeIds.length === 0) return;
            // Update node colors dynamically in vis dataset to glow yellow
            const nodesDataset = network.body.data.nodes;
            graphData.nodes.forEach(n => {
                const isActive = activeNodeIds.includes(n.id);
                nodesDataset.update({
                    id: n.id,
                    color: {
                        background: isActive ? '#f59e0b' : (n.type === 'box' ? '#1e40af' : '#065f46'),
                        border: isActive ? '#fbbf24' : (n.type === 'box' ? '#3b82f6' : '#10b981')
                    }
                });
            });
        }

        function showSidebar(nodeId) {
            const node = graphData.nodes.find(n => n.id === nodeId);
            if (!node || !node.details) return;

            document.getElementById('sidebarTitle').innerText = node.label;
            const content = document.getElementById('sidebarContent');
            content.innerHTML = '';

            if (node.type === 'box') {
                const detail = node.details;
                if (detail.keywords && detail.keywords.length > 0) {
                    const tagContainer = document.createElement('div');
                    tagContainer.className = 'flex flex-wrap gap-2';
                    detail.keywords.forEach(kw => {
                        const span = document.createElement('span');
                        span.className = 'px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded text-xs border border-blue-500/20';
                        span.innerText = kw;
                        tagContainer.appendChild(span);
                    });
                    content.appendChild(tagContainer);
                }

                if (detail.history) {
                    const historyTitle = document.createElement('h4');
                    historyTitle.className = 'text-sm font-semibold border-b border-white/5 pb-2 mt-4';
                    historyTitle.innerText = 'Dialogue Logs';
                    content.appendChild(historyTitle);

                    detail.history.forEach(msg => {
                        const bubble = document.createElement('div');
                        bubble.className = \`p-3 rounded-lg text-sm \${msg.role === 'user' ? 'bg-white/5 border border-white/5' : 'bg-blue-600/10 border border-blue-600/20'}\`;
                        bubble.innerHTML = \`<strong class="block text-xs text-gray-400 mb-1">\${msg.role.toUpperCase()}</strong>\${msg.content}\`;
                        content.appendChild(bubble);
                    });
                }
            } else {
                const eventDesc = document.createElement('p');
                eventDesc.className = 'text-sm text-gray-300';
                eventDesc.innerText = node.details.event || '';
                content.appendChild(eventDesc);
            }

            document.getElementById('sidebar').classList.remove('translate-x-full');
        }

        function hideSidebar() {
            document.getElementById('sidebar').classList.add('translate-x-full');
        }

        document.getElementById('btnCloseSidebar').addEventListener('click', hideSidebar);

        document.getElementById('btnBoxes').addEventListener('click', () => {
            currentMode = 'boxes';
            lastDataString = '';
            document.getElementById('btnBoxes').className = 'px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white transition-all';
            document.getElementById('btnTimeline').className = 'px-4 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white transition-all';
            fetchGraphData();
        });

        document.getElementById('btnTimeline').addEventListener('click', () => {
            currentMode = 'timeline';
            lastDataString = '';
            document.getElementById('btnTimeline').className = 'px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white transition-all';
            document.getElementById('btnBoxes').className = 'px-4 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-white transition-all';
            fetchGraphData();
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            if (!val) return;
            const node = graphData.nodes.find(n => n.label.toLowerCase().includes(val));
            if (node && network) {
                network.focus(node.id, { scale: 1.2, animation: true });
                showSidebar(node.id);
            }
        });

        fetchGraphData();
        setInterval(fetchGraphData, 3000);
    </script>
</body>
</html>
\`;
```

- [ ] **Step 2: Commit template**

```bash
git add src/commands/graph-html.ts
git commit -m "feat(graph): add HTML template with active glow and variable edges"
```

---

### Task 2: Implement Graph CLI endpoints and Active Node State

**Files:**
- Modify: `src/commands/graph.ts`

- [ ] **Step 1: Update API Server in graph.ts to handle active nodes & edge similarity**

We will update the `/api/graph` endpoint to output `activeNodes` and read edge similarities, and add a `POST /api/active-nodes` endpoint:

```typescript
// Add global active nodes state with timestamp
let activeNodes: string[] = [];
let activeNodesTimestamp = 0;

// Inside the server creation block in src/commands/graph.ts:
if (req.method === 'POST' && url.pathname === '/api/active-nodes') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        try {
            const data = JSON.parse(body);
            activeNodes = data.nodeIds || [];
            activeNodesTimestamp = Date.now();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
        } catch {
            res.writeHead(400);
            res.end('Bad Request');
        }
    });
    return;
}

// In the GET /api/graph endpoint response:
const activeNodeList = (Date.now() - activeNodesTimestamp < 15000) ? activeNodes : [];
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ nodes, edges, activeNodes: activeNodeList }));
```

Also, read and output the similarity fields when building timeline or boxes connections:
```typescript
if (trace.entries) {
    trace.entries.forEach((entry: any, i: number) => {
        // use entry.similarity if available, or default to 1.0
        ...
    });
}
```

- [ ] **Step 2: Save graph server configuration to file**

During startup, save the active port number to a configuration file `.shark/membox/graph-server.json`:
```typescript
fs.writeFileSync(
    path.join(runDir, 'graph-server.json'),
    JSON.stringify({ active: true, port: p, timestamp: Date.now() }),
    'utf-8'
);
```

- [ ] **Step 3: Verify & Commit**

```bash
git add src/commands/graph.ts
git commit -m "feat(graph): add API endpoints for active node highlighting and similarity scores"
```

---

### Task 3: Integrate with `shark dev --graph` and `MemboxManager`

**Files:**
- Modify: `src/commands/dev.ts`
- Modify: `src/core/workflow/membox-manager.ts`

- [ ] **Step 1: Add `--graph` option to `shark dev`**

Modify `src/commands/dev.ts` to accept `--graph` flag:
```typescript
export const devCommand = new Command('dev')
    .description('Start interactive development session')
    .option('--graph', 'Enable real-time memory graph visualization', false)
```
When `--graph` is true, invoke `graphCommand.action` asynchronously in the background.

- [ ] **Step 2: Write active nodes signal during `retrieveContext`**

In `src/core/workflow/membox-manager.ts` inside `retrieveContext`, check if `.shark/membox/graph-server.json` is fresh and active. If yes, post the retrieved box IDs to `http://localhost:<port>/api/active-nodes`:

```typescript
const serverConfigFile = path.join(this.dbDir, 'graph-server.json');
if (fs.existsSync(serverConfigFile)) {
    try {
        const config = JSON.parse(fs.readFileSync(serverConfigFile, 'utf-8'));
        if (config.active && Date.now() - config.timestamp < 3600000) { // active within last hour
            const nodeIds = retrievedBoxes.map(b => `box_${b.box_id}`);
            // Fire-and-forget POST
            const req = http.request({
                hostname: 'localhost',
                port: config.port,
                path: '/api/active-nodes',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            req.write(JSON.stringify({ nodeIds }));
            req.end();
        }
    } catch {
        // Ignore network errors to keep execution smooth
    }
}
```

- [ ] **Step 3: Compile & Verify**

Run: `npm run build`
Expected: Success

- [ ] **Step 4: Commit**

```bash
git add src/commands/dev.ts src/core/workflow/membox-manager.ts
git commit -m "feat(graph): integrate active node highlighting with shark dev --graph"
```
