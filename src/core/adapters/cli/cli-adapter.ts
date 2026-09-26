import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentChannelAdapter } from '../adapter.interface.js';
import type { AgentInboundEvent, AgentOutboundEvent } from '../../engine/events.js';
import { tui } from '../../../ui/tui.js';
import { colors } from '../../../ui/colors.js';

export interface CliAdapterOptions {
    auto?: boolean;
}

export class CliAdapter implements AgentChannelAdapter {
    readonly channelId = 'cli';
    private inboundHandler?: (event: AgentInboundEvent) => Promise<void>;
    private isAuto: boolean;

    constructor(options: CliAdapterOptions = {}) {
        this.isAuto = options.auto === true;
    }

    public onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void {
        this.inboundHandler = handler;
    }

    public async dispatchUserText(text: string, sessionId: string = 'cli:local') {
        if (!this.inboundHandler) return;
        await this.inboundHandler({
            type: 'user_message',
            sessionId,
            text,
            role: 'user',
            origin: { channelId: 'cli', senderId: 'local' }
        });
    }

    public emit(event: AgentOutboundEvent): void {
        switch (event.type) {
            case 'text_delta':
                process.stdout.write(event.delta);
                break;
            case 'reasoning_delta':
                if (event.delta.startsWith('[info] ')) {
                    tui.log.info(event.delta.replace(/^\[info\]\s*/, ''));
                } else if (event.delta.startsWith('[warning] ')) {
                    tui.log.warning(event.delta.replace(/^\[warning\]\s*/, ''));
                } else if (event.delta.startsWith('[success] ')) {
                    tui.log.success(event.delta.replace(/^\[success\]\s*/, ''));
                } else {
                    process.stdout.write(colors.dim(event.delta));
                }
                break;
            case 'tool_progress':
                if (event.status === 'starting') {
                    this.logToolStarting(event.toolName, event.details);
                } else if (event.status === 'completed') {
                    // opcional log de sucesso
                } else if (event.status === 'failed') {
                    tui.log.error(colors.error(`❌ [${event.toolName}] falhou: ${event.error || event.details || ''}`));
                }
                break;
            case 'action_approval_request':
                if (this.isAuto) {
                    this.inboundHandler?.({
                        type: 'action_approval_response',
                        sessionId: event.sessionId,
                        approvalId: event.approvalId,
                        decision: 'approved'
                    });
                } else {
                    const promptMsg = event.fallbackText || `Approve ${event.toolName}?`;
                    tui.confirm({ message: promptMsg }).then((approved) => {
                        this.inboundHandler?.({
                            type: 'action_approval_response',
                            sessionId: event.sessionId,
                            approvalId: event.approvalId,
                            decision: approved ? 'approved' : 'rejected'
                        });
                    });
                }
                break;
            case 'turn_completed':
                tui.log.success(`✔ Task Completed: ${event.summary}`);
                break;
            case 'turn_interrupted':
                tui.log.warn(colors.warning(`🛑 Turno interrompido: ${event.reason}`));
                break;
            case 'media_attachment': {
                const icon = event.mimeType.startsWith('video/')
                    ? '🎥'
                    : event.mimeType.startsWith('image/')
                        ? '🖼️'
                        : event.mimeType.startsWith('audio/')
                            ? '🎵'
                            : '📎';
                const captionText = event.caption ? ` - ${colors.bold(event.caption)}` : '';
                const fileUrl = pathToFileURL(path.resolve(event.filePath)).href;
                tui.log.info(`${icon} ${colors.primary('Mídia Anexada:')}${captionText}\n   Arquivo: ${colors.secondary(event.filePath)}\n   Tipo: ${colors.dim(event.mimeType)}\n   Link: ${colors.dim(fileUrl)}`);
                break;
            }
        }
    }

    private logToolStarting(toolName: string, details?: string) {
        const raw = details || '';
        switch (toolName) {
            case 'send_file':
                tui.log.info(`📤 Sending file: ${colors.bold(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'modify_file':
                tui.log.warning(`📝 Modify (Anchored): ${colors.bold(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'create_file':
                tui.log.warning(`📝 Create file: ${colors.bold(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'delete_file':
                tui.log.warning(`🗑️ Delete file: ${colors.bold(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'read_file':
                tui.log.info(`📖 Reading (Anchored): ${colors.dim(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'list_files':
                tui.log.info(`📂 Scanning: ${colors.dim(raw.replace(/^Dir:\s*/, ''))}`);
                break;
            case 'search_file':
                tui.log.info(`🔍 Searching files: ${colors.dim(raw.replace(/^File:\s*/, ''))}`);
                break;
            case 'search_code':
                tui.log.info(`🔎 Search code: ${colors.dim(raw)}`);
                break;
            case 'run_command':
                tui.log.info(`💻 Executing: ${colors.dim(raw.replace(/^Cmd:\s*/, ''))}`);
                break;
            case 'tool_call':
                tui.log.info(`🔧 Tool call: ${colors.bold(raw.replace(/^MCP Tool:\s*/, ''))}`);
                break;
            case 'memory':
                tui.log.info(`🧠 Memory: ${raw}`);
                break;
            case 'invoke_subagent':
                tui.log.info(`🚀 Invoking subagent from brief: ${raw.replace(/^TaskFile:\s*/, '')}`);
                break;
            case 'skills_list':
                tui.log.info(`📋 Listing skills...`);
                break;
            case 'skill_view':
                tui.log.info(`📖 Loading skill: ${raw}`);
                break;
            case 'skill_manage':
                tui.log.info(`🛠️ Skill Manage: ${raw}`);
                break;
            case 'activate_skill':
                tui.log.info(`⚡ Activating skill: ${colors.bold(raw)}`);
                break;
            default:
                tui.log.info(colors.primary(`⚙️ [${toolName}] ${raw || 'executando...'}`));
                break;
        }
    }
}
