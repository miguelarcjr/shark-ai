import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentOutboundEvent } from './events.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import { handleReadFile, handleRunCommand, handleListFiles, handleSearchCode } from '../agents/agent-tools.js';
import type { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';

export interface AgentActionExecutorOptions {
    projectRoot?: string;
    sessionId?: string;
    autoApprove?: boolean;
    emitOutbound: (event: AgentOutboundEvent) => void;
    requestApproval?: (toolName: string, args: any) => Promise<boolean>;
    bridgeToolsManager?: BridgeToolsManager;
}

export interface ActionResult {
    success: boolean;
    output: string;
}

export class AgentActionExecutor {
    private projectRoot: string;
    private sessionId: string;
    private autoApprove: boolean;
    private emitOutbound: (event: AgentOutboundEvent) => void;
    private requestApproval?: (toolName: string, args: any) => Promise<boolean>;
    private anchorManager: AnchorStateManager;
    private bridgeToolsManager?: BridgeToolsManager;
    private recentReadCounts = new Map<string, number>();

    constructor(options: AgentActionExecutorOptions) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.sessionId = options.sessionId || 'default';
        this.autoApprove = options.autoApprove !== false;
        this.emitOutbound = options.emitOutbound;
        this.requestApproval = options.requestApproval;
        this.bridgeToolsManager = options.bridgeToolsManager;
        this.anchorManager = new AnchorStateManager();
    }

    public async executeAction(action: { type: string; [key: string]: any }): Promise<ActionResult> {
        const toolName = action.type;
        const details = this.getToolDetails(action);

        this.emitOutbound({
            type: 'tool_progress',
            sessionId: this.sessionId,
            toolName,
            status: 'starting',
            details
        });

        try {
            // Checa aprovação se necessário
            const isSensitive = ['create_file', 'modify_file', 'run_command'].includes(toolName);
            if (isSensitive && !this.autoApprove && this.requestApproval) {
                const approved = await this.requestApproval(toolName, action);
                if (!approved) {
                    const result = { success: false, output: `[Action ${toolName} User Denied]` };
                    this.emitOutbound({
                        type: 'tool_progress',
                        sessionId: this.sessionId,
                        toolName,
                        status: 'failed',
                        error: 'Action was denied by user'
                    });
                    return result;
                }
            }

            let output = '';

            switch (toolName) {
                case 'read_file': {
                    const filePath = action.args?.path || action.path || '';
                    const readCount = (this.recentReadCounts.get(filePath) || 0) + 1;
                    this.recentReadCounts.set(filePath, readCount);

                    if (readCount >= 3) {
                        output = `[Action read_file(${filePath}) Blocked]: Leitura redundante bloqueada. O conteúdo já está no histórico.`;
                    } else {
                        try {
                            const content = this.anchorManager.getAnchoredContent(filePath);
                            const lines = content.split('\n');
                            const totalLines = Math.max(0, lines.length - 1);
                            output = `[Action read_file(${filePath}) Success - ${totalLines} linhas]:\n[START_OF_FILE]\n${content}\n[END_OF_FILE]`;
                        } catch (e: any) {
                            output = `[Action read_file(${filePath}) Failed]: ${e.message}`;
                        }
                    }
                    break;
                }

                case 'create_file': {
                    const filePath = action.args?.path || action.path || '';
                    const content = action.args?.content || action.content || '';
                    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(this.projectRoot, filePath);
                    const dir = path.dirname(resolved);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(resolved, content, 'utf-8');
                    output = `[Action create_file(${filePath}) Success]`;
                    break;
                }

                case 'modify_file': {
                    const filePath = action.args?.path || action.path || '';
                    const startAnchor = action.args?.start_anchor || action.start_anchor || '';
                    const endAnchor = action.args?.end_anchor || action.end_anchor || '';
                    const content = action.args?.content || action.content || '';
                    this.anchorManager.applyAnchoredEdit(filePath, startAnchor, endAnchor, content);
                    this.recentReadCounts.clear();
                    output = `[Action modify_file(${filePath}) Success]`;
                    break;
                }

                case 'list_files': {
                    const dirPath = action.args?.path || action.path || '.';
                    output = handleListFiles(dirPath);
                    break;
                }

                case 'search_code': {
                    const query = action.args?.query || action.query || '';
                    const pattern = action.args?.pattern || action.pattern || '**/*';
                    const isRegex = action.args?.is_regex || action.is_regex || false;
                    output = handleSearchCode(query, pattern, isRegex);
                    break;
                }

                case 'run_command': {
                    const command = action.args?.command || action.command || '';
                    output = await handleRunCommand(command);
                    break;
                }

                default: {
                    if (this.bridgeToolsManager && this.bridgeToolsManager.isBridgeTool(toolName)) {
                        output = await this.bridgeToolsManager.executeTool(toolName, action.args || action);
                    } else {
                        output = `Unknown action type: ${toolName}`;
                    }
                    break;
                }
            }

            this.emitOutbound({
                type: 'tool_progress',
                sessionId: this.sessionId,
                toolName,
                status: 'completed',
                details: `Finished ${toolName}`
            });

            return { success: true, output };
        } catch (error: any) {
            this.emitOutbound({
                type: 'tool_progress',
                sessionId: this.sessionId,
                toolName,
                status: 'failed',
                error: error.message
            });
            return { success: false, output: `[Action ${toolName} Error]: ${error.message}` };
        }
    }

    private getToolDetails(action: { type: string; [key: string]: any }): string {
        switch (action.type) {
            case 'read_file':
            case 'create_file':
            case 'modify_file':
                return `File: ${action.args?.path || action.path || ''}`;
            case 'run_command':
                return `Cmd: ${action.args?.command || action.command || ''}`;
            case 'list_files':
                return `Dir: ${action.args?.path || action.path || '.'}`;
            case 'search_code':
                return `Query: ${action.args?.query || action.query || ''}`;
            default:
                return action.type;
        }
    }
}
