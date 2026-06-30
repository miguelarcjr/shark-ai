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
        
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url || '', `http://localhost:${port}`);
            
            if (url.pathname === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(GRAPH_HTML_TEMPLATE);
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
                                    nodes.push({
                                        id: `box_${box.box_id}`,
                                        label: box.topic || `Topic ${box.box_id}`,
                                        type: 'box',
                                        size: 15 + Math.min((box.dialog_history?.length || 0) * 2, 20),
                                        details: {
                                            topic: box.topic,
                                            keywords: box.keywords,
                                            history: box.dialog_history
                                        }
                                    });
                                } else {
                                    // Add individual events
                                    box.events?.forEach((ev: string, idx: number) => {
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
                                    for (let i = 0; i < boxIds.length - 1; i++) {
                                        edges.push({
                                            from: `box_${boxIds[i]}`,
                                            to: `box_${boxIds[i+1]}`,
                                            label: `Trace ${trace.trace_id}`,
                                            arrows: 'to'
                                        });
                                    }
                                } else {
                                    // Draw timeline sequence links
                                    const entries = trace.entries || [];
                                    for (let i = 0; i < entries.length - 1; i++) {
                                        const fromEntry = entries[i];
                                        const toEntry = entries[i+1];
                                        if (fromEntry?.events?.length > 0 && toEntry?.events?.length > 0) {
                                            edges.push({
                                                from: `ev_${fromEntry.box_id}_0`,
                                                to: `ev_${toEntry.box_id}_0`,
                                                label: 'timeline',
                                                arrows: 'to'
                                            });
                                        }
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
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ nodes, edges }));
                return;
            }
            
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        });
        
        const startServer = (p: number) => {
            server.listen(p, () => {
                const url = `http://localhost:${p}/?mode=${mode}`;
                console.log(colors.success(`🚀 Memory Graph Server active at: ${url}`));
                
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
                console.log(colors.info(`⚠️ Port ${port} is busy. Retrying next port...`));
                port++;
                startServer(port);
            } else {
                console.error(colors.error('❌ Server startup error:'), err);
            }
        });
        
        startServer(port);
    });
