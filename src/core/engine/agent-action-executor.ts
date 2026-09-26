import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentOutboundEvent } from './events.js';
import { AnchorStateManager } from '../workflow/anchor-state-manager.js';
import { handleReadFile, handleRunCommand, handleListFiles, handleSearchCode, handleSearchFile, handleProcessAction } from '../agents/agent-tools.js';
import { ProcessManager } from '../process/process-manager.js';
import { skillManager } from '../workflow/skill-manager.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { MemoryStore } from '../memory/memory-store.js';
import { StateDB } from '../memory/state-db.js';
import { executeMemoryTool, memoryToolSchema } from '../tools/memory-tool.js';
import { executeSessionSearchTool, sessionSearchToolSchema } from '../tools/session-search-tool.js';
import type { BridgeToolsManager } from '../tools/bridge/bridge-tools.js';
import { truncateToolOutput } from '../utils/text-truncator.js';
import type { MessageQueue } from '../workflow/message-queue.js';
import { detectMimeType } from '../utils/mime-detector.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';

export interface AgentActionExecutorOptions {
    projectRoot?: string;
    sessionId?: string;
    autoApprove?: boolean;
    emitOutbound: (event: AgentOutboundEvent) => void;
    requestApproval?: (toolName: string, args: any, fallbackText: string) => Promise<boolean>;
    bridgeToolsManager?: BridgeToolsManager;
    memoryStore?: MemoryStore;
    onMemoryUpdated?: () => Promise<void>;
    activeConversationId?: string;
    currentTaskId?: string;
    messageQueue?: MessageQueue;
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
    private requestApproval?: (toolName: string, args: any, fallbackText: string) => Promise<boolean>;
    private anchorManager: AnchorStateManager;
    private bridgeToolsManager?: BridgeToolsManager;
    private memoryStore: MemoryStore;
    private onMemoryUpdated?: () => Promise<void>;
    private activeConversationId?: string;
    private currentTaskId?: string;
    private messageQueue?: MessageQueue;
    private recentReadCounts = new Map<string, number>();

    constructor(options: AgentActionExecutorOptions) {
        this.projectRoot = options.projectRoot || process.cwd();
        this.sessionId = options.sessionId || 'default';
        this.autoApprove = options.autoApprove !== false;
        this.emitOutbound = options.emitOutbound;
        this.requestApproval = options.requestApproval;
        this.bridgeToolsManager = options.bridgeToolsManager;
        this.memoryStore = options.memoryStore || new MemoryStore();
        this.onMemoryUpdated = options.onMemoryUpdated;
        this.activeConversationId = options.activeConversationId;
        this.currentTaskId = options.currentTaskId;
        this.messageQueue = options.messageQueue;
        this.anchorManager = new AnchorStateManager();

        if (this.messageQueue) {
            ProcessManager.getInstance().setMessageQueue(this.messageQueue);
        }
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
            // Checagem de aprovação para ações sensíveis
            const isSensitive = ['create_file', 'modify_file', 'delete_file', 'run_command', 'tool_call'].includes(toolName) ||
                (toolName === 'process' && ['kill', 'write'].includes(action.args?.action || action.action));
            if (isSensitive && !this.autoApprove && this.requestApproval) {
                const fallbackText = this.getApprovalPrompt(action);
                const approved = await this.requestApproval(toolName, action, fallbackText);
                if (!approved) {
                    const deniedOutput = toolName === 'tool_call'
                        ? `[Action tool_call("${action.args?.name || action.tool_name || ''}") Aborted]: Execução cancelada pelo usuário.`
                        : `[Action ${toolName} Aborted]: Execução cancelada pelo usuário.`;
                    const result = { success: false, output: deniedOutput };
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
                        output = `[Action read_file(${filePath}) Blocked]: Leitura redundante bloqueada. O conteúdo já está no seu contexto acima. NÃO chame read_file novamente neste arquivo. Prossiga IMEDIATAMENTE para aplicar alterações com 'create_file' ou 'modify_file', ou verificar com testes via 'run_command'.`;
                    } else {
                        try {
                            const content = this.anchorManager.getAnchoredContent(filePath);
                            const lines = content.split('\n');
                            const totalLines = Math.max(0, lines.length - 1);
                            output = `[Action read_file(${filePath}) Success - ${totalLines} linhas, Arquivo completo]:\n[START_OF_FILE]\n${content}\n[END_OF_FILE]`;
                            if (readCount === 2) {
                                output += `\n\n⚠️ [LOOP NOTICE]: Você já leu '${filePath}' anteriormente. O arquivo completo já está disponível. Prossiga com a implementação ('create_file' / 'modify_file') ou testes ('run_command').`;
                            }
                        } catch (e: any) {
                            output = `[Action read_file(${filePath}) Failed]: ${e.message}`;
                        }
                    }
                    break;
                }

                case 'create_file': {
                    const filePath = action.args?.path || action.path || '';
                    const content = action.args?.content || action.content || '';
                    try {
                        const resolvedPath = path.resolve(this.projectRoot, filePath);
                        const dir = path.dirname(resolvedPath);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        fs.writeFileSync(resolvedPath, content, 'utf-8');
                        this.recentReadCounts.clear();
                        output = `[Action create_file(${filePath}) Success]`;
                    } catch (e: any) {
                        output = `[Action create_file(${filePath}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'modify_file': {
                    const filePath = action.args?.path || action.path || '';
                    const startAnchor = action.args?.start_anchor || action.start_anchor || '';
                    const endAnchor = action.args?.end_anchor || action.end_anchor || '';
                    const content = action.args?.content || action.content || '';
                    try {
                        this.anchorManager.applyAnchoredEdit(filePath, startAnchor, endAnchor, content);
                        this.recentReadCounts.clear();
                        output = `[Action modify_file(${filePath}) Success]`;
                    } catch (e: any) {
                        output = `[Action modify_file(${filePath}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'delete_file': {
                    const filePath = action.args?.path || action.path || '';
                    try {
                        const resolvedPath = path.resolve(this.projectRoot, filePath);
                        if (fs.existsSync(resolvedPath)) {
                            fs.rmSync(resolvedPath, { force: true });
                        }
                        output = `[Action delete_file(${filePath}) Success]`;
                    } catch (e: any) {
                        output = `[Action delete_file(${filePath}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'list_files': {
                    const dirPath = action.args?.path || action.path || '.';
                    try {
                        const result = handleListFiles(dirPath);
                        output = `[Action list_files(${dirPath}) Success]:\n${result}`;
                    } catch (e: any) {
                        output = `[Action list_files(${dirPath}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'search_file': {
                    const pattern = action.args?.path || action.path || '';
                    try {
                        const result = handleSearchFile(pattern);
                        output = `[Action search_file(${pattern}) Success]:\n${result}`;
                    } catch (e: any) {
                        output = `[Action search_file(${pattern}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'search_code': {
                    const glob = action.args?.path || action.path || '**/*';
                    const query = action.args?.query || action.query || '';
                    const isRegex = (action.args?.is_regex ?? action.is_regex) === true;
                    try {
                        const result = handleSearchCode(glob, query, isRegex);
                        output = `[Action search_code("${query}" in "${glob}") Success]:\n${result}`;
                    } catch (e: any) {
                        output = `[Action search_code("${query}" in "${glob}") Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'run_command': {
                    const command = action.args?.command || action.command || '';
                    const background = action.args?.background ?? action.background;
                    const timeoutSeconds = action.args?.timeout_seconds ?? action.timeout_seconds;
                    const notifyOnComplete = action.args?.notify_on_complete ?? action.notify_on_complete;
                    const watchPatterns = action.args?.watch_patterns || action.watch_patterns;
                    try {
                        const rawOutput = await handleRunCommand(command, {
                            background,
                            timeoutSeconds,
                            notifyOnComplete,
                            watchPatterns,
                            sessionId: this.sessionId
                        });
                        output = `[Action run_command(${command}) Success]:\n${rawOutput}`;
                        output = truncateToolOutput(output, 100000);
                    } catch (e: any) {
                        output = `[Action run_command(${command}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'process': {
                    const processAction = (action.args?.action || action.action || 'list') as any;
                    const processId = action.args?.process_id || action.process_id;
                    const data = action.args?.data || action.data;
                    const lines = action.args?.lines ?? action.lines;
                    const offset = action.args?.offset ?? action.offset;
                    try {
                        const res = await handleProcessAction({
                            action: processAction,
                            process_id: processId,
                            data,
                            lines,
                            offset,
                            sessionId: this.sessionId
                        });
                        output = `[Action process(${processAction}) Success]:\n${res}`;
                        output = truncateToolOutput(output, 100000);
                    } catch (e: any) {
                        output = `[Action process(${processAction}) Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'send_file': {
                    const rawPath = action.args?.path || action.path || '';
                    const caption = action.args?.caption || action.caption;
                    if (!rawPath) {
                        output = `[Action send_file Failed]: Nenhum caminho de arquivo fornecido.`;
                        break;
                    }
                    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(this.projectRoot, rawPath);
                    if (!fs.existsSync(resolvedPath)) {
                        output = `[Action send_file Failed]: Arquivo não encontrado no caminho: ${resolvedPath}`;
                        break;
                    }
                    const mimeType = detectMimeType(resolvedPath);
                    this.emitOutbound({
                        type: 'media_attachment',
                        sessionId: this.sessionId,
                        filePath: resolvedPath,
                        mimeType,
                        caption
                    });
                    output = `[Action send_file("${resolvedPath}") Success]: Arquivo (${mimeType}) enviado com sucesso.`;
                    break;
                }

                case 'memory': {
                    const target = (action.args?.target || action.target || 'memory') as 'memory' | 'user';
                    const act = action.args?.action || action.action || 'read';
                    try {
                        const memArgs = memoryToolSchema.parse({
                            action: act,
                            target,
                            content: action.args?.content || action.content || '',
                            old_str: action.args?.old_str || action.old_str
                        });
                        const res = await executeMemoryTool(this.memoryStore, memArgs);
                        output = `[Action memory(${memArgs.action}, ${memArgs.target}) Success]: ${res.usage ? `Usage: ${res.usage}` : (res.content || 'OK')}`;
                        if (['add', 'replace', 'remove'].includes(memArgs.action) && this.onMemoryUpdated) {
                            await this.onMemoryUpdated();
                        }
                    } catch (e: any) {
                        output = `[Action memory Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'session_search': {
                    const query = action.args?.query || action.query || '';
                    const rawLimit = action.args?.limit ?? action.limit;
                    const limit = typeof rawLimit === 'number' ? rawLimit : 5;
                    try {
                        const stateDb = new StateDB();
                        const searchArgs = sessionSearchToolSchema.parse({ query, limit });
                        const res = executeSessionSearchTool(stateDb, searchArgs);
                        stateDb.close();
                        const formatted = res.results.map(r => `[${r.timestamp}] (${r.role}): ${r.content}`).join('\n---\n');
                        output = `[Action session_search("${query}") Success - ${res.totalFound} found]:\n${formatted || 'Nenhuma mensagem encontrada.'}`;
                    } catch (e: any) {
                        output = `[Action session_search Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'skills_list': {
                    const query = action.args?.query || action.query;
                    try {
                        const catalog = await skillManager.listSkills(query);
                        output = `[Action skills_list Success]:\n${catalog}`;
                    } catch (e: any) {
                        output = `[Action skills_list Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'skill_view': {
                    const name = action.args?.name || action.args?.skill_name || action.name || action.skill_name || '';
                    const filePath = action.args?.file_path || action.file_path;
                    const convId = this.activeConversationId || 'conv-default';
                    try {
                        const content = await skillManager.viewSkill(name, filePath, convId);
                        output = `[Action skill_view("${name}") Success]:\n${content}`;
                    } catch (e: any) {
                        output = `[Action skill_view("${name}") Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'skill_manage': {
                    const act = action.args?.action || action.action;
                    const name = action.args?.name || action.name || '';
                    try {
                        const res = await skillManager.manageSkill({
                            action: act,
                            name,
                            content: action.args?.content || action.content,
                            file_path: action.args?.file_path || action.file_path,
                            old_string: action.args?.old_string || action.old_string,
                            new_string: action.args?.new_string || action.new_string,
                            scope: action.args?.scope || action.scope,
                        });
                        if (res.status === 'success') {
                            output = `[Action skill_manage("${act}", "${name}") Success]: ${res.message}`;
                        } else if (res.status === 'pending') {
                            output = `[Action skill_manage("${act}", "${name}") Pending Approval]: ${res.message}`;
                        } else {
                            output = `[Action skill_manage("${act}", "${name}") Failed]: ${res.message}`;
                        }
                    } catch (e: any) {
                        output = `[Action skill_manage("${act}", "${name}") Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'activate_skill': {
                    const name = action.args?.name || action.args?.skill_name || action.name || action.skill_name || '';
                    try {
                        await skillManager.activateSkill(name);
                        output = `[System]: Skill '${name}' activated successfully.`;
                    } catch (e: any) {
                        output = `[System]: Failed to activate skill '${name}': ${e.message}`;
                    }
                    break;
                }

                case 'invoke_subagent': {
                    try {
                        const taskFile = action.args?.task_file || action.task_file;
                        if (!taskFile) {
                            throw new Error('Action invoke_subagent requires "task_file" parameter');
                        }
                        const resolvedPath = path.resolve(this.projectRoot, taskFile);
                        const parsed = subagentManager.parseTaskBrief(resolvedPath);
                        const parentId = this.currentTaskId || 'parent';
                        const invoked = await subagentManager.invokeSubagents(
                            [{ TypeName: parsed.type, Role: parsed.role, Prompt: parsed.prompt }],
                            parentId,
                            this.messageQueue
                        );
                        output = `[Action invoke_subagent Success]: Invoked subagent:\n${invoked.map(s => `- ID: ${s.id}, Type: ${s.TypeName}, Role: ${s.Role}`).join('\n')}`;
                    } catch (e: any) {
                        output = `[Action invoke_subagent Failed]: ${e.message}`;
                    }
                    break;
                }

                case 'notify_user': {
                    const messageContent = action.args?.content || action.content || '';
                    if (messageContent) {
                        tui.log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(messageContent);
                    }
                    output = `[Action notify_user Success]: Notificação exibida com sucesso para o usuário.`;
                    break;
                }

                case 'tool_search': {
                    if (this.bridgeToolsManager) {
                        const queries = action.args?.queries || (action.query ? [action.query] : []);
                        const res = await this.bridgeToolsManager.executeToolSearch({
                            queries,
                            limit: action.args?.limit
                        });
                        output = res.success ? JSON.stringify(res.output, null, 2) : res.error!;
                    } else {
                        output = `Bridge tools manager not initialized`;
                    }
                    break;
                }

                case 'tool_describe': {
                    if (this.bridgeToolsManager) {
                        const names = action.args?.names || (action.tool_name ? [action.tool_name] : []);
                        const res = await this.bridgeToolsManager.executeToolDescribe({ names });
                        output = res.success ? JSON.stringify(res.output, null, 2) : res.error!;
                    } else {
                        output = `Bridge tools manager not initialized`;
                    }
                    break;
                }

                case 'tool_call': {
                    if (this.bridgeToolsManager) {
                        const toolNameInner = action.args?.name || action.tool_name || '';
                        const rawArgs = action.args?.arguments ?? action.tool_args;
                        let toolArguments: Record<string, any> = {};
                        if (typeof rawArgs === 'string') {
                            try { toolArguments = JSON.parse(rawArgs); } catch { toolArguments = {}; }
                        } else if (typeof rawArgs === 'object' && rawArgs !== null) {
                            toolArguments = rawArgs;
                        }
                        const res = await this.bridgeToolsManager.executeToolCall({
                            name: toolNameInner,
                            arguments: toolArguments
                        });
                        output = res.success
                            ? `[Action tool_call("${toolNameInner}") Success]:\n${typeof res.output === 'string' ? res.output : JSON.stringify(res.output, null, 2)}`
                            : res.error!;
                    } else {
                        output = `Bridge tools manager not initialized`;
                    }
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

    private getApprovalPrompt(action: { type: string; [key: string]: any }): string {
        switch (action.type) {
            case 'modify_file': {
                const p = action.args?.path || action.path || '';
                return `Approve modify_file changes to ${p}?`;
            }
            case 'create_file': {
                const p = action.args?.path || action.path || '';
                return `Approve create_file changes to ${p}?`;
            }
            case 'delete_file': {
                const p = action.args?.path || action.path || '';
                return `Approve delete_file changes to ${p}?`;
            }
            case 'run_command': {
                const cmd = action.args?.command || action.command || '';
                return `Execute run_command: ${cmd}?`;
            }
            case 'process': {
                const act = action.args?.action || action.action || '';
                const pId = action.args?.process_id || action.process_id || '';
                return `Approve process action '${act}' on '${pId}'?`;
            }
            case 'tool_call': {
                const tName = action.args?.name || action.tool_name || '';
                const rawArgs = action.args?.arguments ?? action.tool_args;
                let formatted = '{}';
                if (typeof rawArgs === 'string') formatted = rawArgs;
                else if (typeof rawArgs === 'object') formatted = JSON.stringify(rawArgs, null, 2);
                return `Deseja executar a ferramenta MCP '${tName}'?\nArgumentos:\n${formatted}`;
            }
            default:
                return `Approve execution of ${action.type}?`;
        }
    }

    private getToolDetails(action: { type: string; [key: string]: any }): string {
        switch (action.type) {
            case 'read_file':
            case 'create_file':
            case 'modify_file':
            case 'delete_file':
            case 'send_file':
                return `File: ${action.args?.path || action.path || ''}`;
            case 'run_command':
                return `Cmd: ${action.args?.command || action.command || ''}`;
            case 'process':
                return `Action: ${action.args?.action || action.action} on ${action.args?.process_id || action.process_id || 'all'}`;
            case 'list_files':
                return `Dir: ${action.args?.path || action.path || '.'}`;
            case 'search_code':
                return `Query: ${action.args?.query || action.query || ''}`;
            case 'memory':
                return `Action: ${action.args?.action || action.action} on ${action.args?.target || action.target}`;
            case 'invoke_subagent':
                return `TaskFile: ${action.args?.task_file || action.task_file || ''}`;
            case 'tool_call':
                return `MCP Tool: ${action.args?.name || action.tool_name || ''}`;
            default:
                return action.type;
        }
    }
}
