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
                <p class="text-sm text-gray-400">Start a chat session using <code class="bg-black/30 px-1.5 py-0.5 rounded text-blue-400">shark dev</code> in another terminal to generate memory boxes.</p>
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
                if (currentDataString === lastDataString) return;
                lastDataString = currentDataString;
                
                updateNetwork(data);
            } catch (err) {
                console.error("Error fetching graph data:", err);
            }
        }

        function updateNetwork(data) {
            graphData = data;
            const container = document.getElementById('network');
            
            const visNodes = new vis.DataSet(data.nodes.map(n => ({
                id: n.id,
                label: n.label,
                size: n.size || 15,
                shape: n.type === 'box' ? 'dot' : 'circle',
                color: {
                    background: n.type === 'box' ? '#1e40af' : '#065f46',
                    border: n.type === 'box' ? '#3b82f6' : '#10b981',
                    highlight: { background: '#2563eb', border: '#60a5fa' }
                },
                font: { color: '#f3f4f6', face: 'Inter', size: 12 }
            })));

            const visEdges = new vis.DataSet(data.edges.map(e => ({
                from: e.from,
                to: e.to,
                label: e.label,
                arrows: e.arrows || '',
                color: { color: '#4b5563', highlight: '#9ca3af' },
                font: { color: '#9ca3af', face: 'Inter', size: 10 }
            })));

            if (network) {
                network.setData({ nodes: visNodes, edges: visEdges });
            } else {
                const options = {
                    physics: {
                        solver: 'forceAtlas2Based',
                        forceAtlas2Based: { gravitationalConstant: -50, centralGravity: 0.01, springLength: 100 }
                    },
                    interaction: { hover: true }
                };
                network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, options);
                
                network.on('click', function(params) {
                    if (params.nodes.length > 0) {
                        showSidebar(params.nodes[0]);
                    } else {
                        hideSidebar();
                    }
                });
            }
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
`;
