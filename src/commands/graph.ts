import { Command, Argument } from 'commander';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { GRAPH_HTML_TEMPLATE } from './graph-html.js';
import { colors } from '../ui/colors.js';

interface GraphNode {
    id: string;
    label: string;
    type: string;
    size?: number;
    details?: any;
}

interface GraphEdge {
    from: string;
    to: string;
    label: string;
    arrows: string;
    similarity?: number;
}

export const graphCommand = new Command('graph')
    .description('Visualize episodic memory and trace graphs in your browser')
    .addArgument(new Argument('[mode]', 'Default view mode (boxes or timeline)').choices(['boxes', 'timeline']).default('boxes'))
    .option('-p, --port <number>', 'Port to host the server', '4200')
    .action(async (mode, options) => {
        let port = parseInt(options.port, 10);
        if (isNaN(port)) {
            console.error(colors.error('❌ Invalid port number.'));
            process.exit(1);
        }

        let activeNodes: string[] = [];
        let activeNodesTimestamp = 0;

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || '', `http://localhost:${port}`);
            
            if (url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(GRAPH_HTML_TEMPLATE);
                return;
            }

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
            
            if (url.pathname === '/api/graph') {
                const graphMode = url.searchParams.get('mode') || 'boxes';
                const runDir = path.join(process.cwd(), '.shark', 'membox');
                const boxesFile = path.join(runDir, 'boxes.jsonl');
                const tracesFile = path.join(runDir, 'traces.jsonl');

                const nodes: GraphNode[] = [];
                const edges: GraphEdge[] = [];
                
                try {
                    if (fs.existsSync(boxesFile)) {
                        const fileContent = await fs.promises.readFile(boxesFile, 'utf-8');
                        const lines = fileContent.trim().split('\n').filter(Boolean);
                        lines.forEach((line) => {
                            try {
                                const box = JSON.parse(line);
                                if (graphMode === 'boxes') {
                                    // Map dialog history from content_text
                                    const history: any[] = [];
                                    if (box.content_text) {
                                        const turns = box.content_text.split(/\n(?=user:|assistant:)/i);
                                        turns.forEach((turn: string) => {
                                            const match = turn.match(/^(user|assistant):\s*([\s\S]*)$/i);
                                            if (match) {
                                                const role = match[1].toLowerCase();
                                                let content = match[2].trim();
                                                if (content.startsWith('{')) {
                                                    try {
                                                        const parsed = JSON.parse(content);
                                                        if (parsed.action && parsed.action.content) {
                                                            content = parsed.action.content;
                                                        } else if (parsed.summary) {
                                                            content = parsed.summary;
                                                        }
                                                    } catch {
                                                        // use raw JSON if parsing fails
                                                    }
                                                }
                                                history.push({ role, content: content.replace(/\n/g, '<br>') });
                                            } else {
                                                history.push({ role: 'log', content: turn.trim().replace(/\n/g, '<br>') });
                                            }
                                        });
                                    }
                                    
                                    nodes.push({
                                        id: `box_${box.box_id}`,
                                        label: box.features?.topic || `Topic ${box.box_id}`,
                                        type: 'box',
                                        size: 15 + Math.min((box.features?.events?.length || 0) * 2, 20),
                                        details: {
                                            topic: box.features?.topic,
                                            keywords: box.features?.keywords,
                                            history: history
                                        }
                                    });
                                } else {
                                    // Add individual events
                                    box.features?.events?.forEach((ev: string, idx: number) => {
                                        nodes.push({
                                            id: `ev_${box.box_id}_${idx}`,
                                            label: ev.length > 30 ? ev.substring(0, 30) + '...' : ev,
                                            type: 'event',
                                            details: { event: ev }
                                        });
                                    });
                                }
                            } catch (e) {
                                // Skip unparseable line
                            }
                        });
                    }
                    
                    if (fs.existsSync(tracesFile)) {
                        const fileContent = await fs.promises.readFile(tracesFile, 'utf-8');
                        const lines = fileContent.trim().split('\n').filter(Boolean);
                        lines.forEach((line) => {
                            try {
                                const trace = JSON.parse(line);
                                if (graphMode === 'boxes') {
                                    // Draw links between consecutive boxes in the trace
                                    const boxIds = trace.box_ids || [];
                                    const entries = trace.entries || [];
                                    for (let i = 0; i < boxIds.length - 1; i++) {
                                        const entry = entries.find((e: any) => e.box_id === boxIds[i+1]);
                                        edges.push({
                                            from: `box_${boxIds[i]}`,
                                            to: `box_${boxIds[i+1]}`,
                                            label: `Trace ${trace.trace_id}`,
                                            arrows: 'to',
                                            similarity: entry?.similarity ?? 1.0
                                        });
                                    }
                                } else {
                                    // Draw timeline sequence links chronologically through all trace events
                                    const traceEventIds: string[] = [];
                                    const entries = trace.entries || [];
                                    const eventSimilarities: number[] = [];
                                    entries.forEach((entry: any) => {
                                        if (entry?.events) {
                                            entry.events.forEach((_: string, idx: number) => {
                                                traceEventIds.push(`ev_${entry.box_id}_${idx}`);
                                                eventSimilarities.push(entry.similarity ?? 1.0);
                                            });
                                        }
                                    });
                                    
                                    for (let i = 0; i < traceEventIds.length - 1; i++) {
                                        edges.push({
                                            from: traceEventIds[i],
                                            to: traceEventIds[i+1],
                                            label: `Trace ${trace.trace_id}`,
                                            arrows: 'to',
                                            similarity: eventSimilarities[i+1] ?? 1.0
                                        });
                                    }
                                }
                            } catch (e) {
                                // Skip unparseable line
                            }
                        });
                    }
                } catch (e) {
                    console.error('Error parsing memory graph files:', e);
                }
                
                const activeNodeList = (Date.now() - activeNodesTimestamp < 15000) ? activeNodes : [];
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ nodes, edges, activeNodes: activeNodeList }));
                return;
            }
            
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        });
        
        const startServer = (p: number) => {
            server.listen(p, () => {
                const url = `http://localhost:${p}/?mode=${mode}`;
                console.log(colors.success(`🚀 Memory Graph Server active at: ${url}`));

                // Save active server details to .shark/membox/graph-server.json
                const runDir = path.join(process.cwd(), '.shark', 'membox');
                if (!fs.existsSync(runDir)) {
                    fs.mkdirSync(runDir, { recursive: true });
                }
                fs.writeFileSync(
                    path.join(runDir, 'graph-server.json'),
                    JSON.stringify({ active: true, port: p, timestamp: Date.now() }),
                    'utf-8'
                );
                
                if (process.platform === 'win32') {
                    exec(`start "" "${url}"`);
                } else if (process.platform === 'darwin') {
                    exec(`open "${url}"`);
                } else {
                    exec(`xdg-open "${url}"`);
                }
            });
        };
        
        server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(colors.secondary(`⚠️ Port ${port} is busy. Retrying next port...`));
                port++;
                startServer(port);
            } else {
                console.error(colors.error('❌ Server startup error:'), err);
            }
        });

        const cleanup = () => {
            try {
                const runDir = path.join(process.cwd(), '.shark', 'membox');
                const file = path.join(runDir, 'graph-server.json');
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                }
            } catch {}
        };
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });
        
        startServer(port);
    });
