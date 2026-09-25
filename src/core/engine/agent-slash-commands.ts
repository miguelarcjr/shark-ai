import * as path from 'node:path';
import * as fs from 'node:fs';
import { HistoryManager } from '../workflow/history-manager.js';
import { ContextCompressor } from '../workflow/context-compressor.js';
import { ConfigManager } from '../config-manager.js';
import type { ForkReviewAgent } from '../workflow/fork-review-agent.js';
import type { SkillManager } from '../workflow/skill-manager.js';
import { workflowManager } from '../workflow/workflow-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';

export interface SlashCommandHandlerContext {
    projectRoot: string;
    activeConversationId?: string;
    conversationKey?: string;
    forkReviewAgent: ForkReviewAgent;
    skillManager: SkillManager;
    autoApproveTools: boolean;
    onLog: (type: 'info' | 'warning' | 'error' | 'success', message: string) => void;
    onPromptSelect?: (options: { message: string; options: Array<{ label: string; value: string }> }) => Promise<string | null>;
}

export interface SlashCommandResult {
    handled: boolean;
    autoApproveTools?: boolean;
    activeConversationId?: string;
}

export async function handleSlashCommand(
    command: string,
    ctx: SlashCommandHandlerContext
): Promise<SlashCommandResult> {
    const trimmed = command.trim();

    if (trimmed === '/refine' || trimmed.startsWith('/refine ') || trimmed.startsWith('/refine')) {
        const focus = trimmed.startsWith('/refine ') ? trimmed.slice(8).trim() : undefined;
        ctx.onLog('info', '🧠 Acionando revisão do Learning Loop em segundo plano...');
        let historyToReview: Array<{ role: string; content: string }> = [];

        if (ctx.activeConversationId) {
            historyToReview = await HistoryManager.getRawHistory(ctx.activeConversationId);
        }

        if (historyToReview.length === 0) {
            const historyDir = path.resolve(ctx.projectRoot, '_sharkrc', 'history');
            if (fs.existsSync(historyDir)) {
                const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.raw.json') && !f.startsWith('review_'));
                if (files.length > 0) {
                    const sorted = files.map(f => ({
                        file: f,
                        mtime: fs.statSync(path.join(historyDir, f)).mtimeMs
                    })).sort((a, b) => b.mtime - a.mtime);
                    const latestId = sorted[0].file.replace('.raw.json', '');
                    historyToReview = await HistoryManager.getRawHistory(latestId);
                }
            }
        }

        const triggered = await ctx.forkReviewAgent.triggerManualReview(historyToReview, focus);
        if (!triggered) {
            ctx.onLog('warning', '⚠️ [Review em andamento, aguarde a conclusão...]');
        } else {
            ctx.onLog('success', 'Revisão iniciada com sucesso.');
        }
        return { handled: true };
    }

    if (trimmed === '/auto') {
        const nextState = !ctx.autoApproveTools;
        if (nextState) {
            ctx.onLog('info', '⚡ Auto-aprovação de ferramentas ATIVADA.');
        } else {
            ctx.onLog('info', '🔒 Auto-aprovação de ferramentas DESATIVADA (solicitando confirmações manuais).');
        }
        return { handled: true, autoApproveTools: nextState };
    }

    if (trimmed === '/compact') {
        const config = ConfigManager.getInstance().getConfig();
        const enabled = config.memory?.enabled === true || !!process.env.VITEST;
        if (!enabled) {
            ctx.onLog('warning', '🦈 A compactação de memória está desabilitada nas configurações.');
            return { handled: true };
        }
        ctx.onLog('info', '🦈 Compactando memória de forma manual com Tail Protection...');
        if (ctx.activeConversationId) {
            try {
                const rawHistory = await HistoryManager.getRawHistory(ctx.activeConversationId);
                const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                    tokenLimit: 1000,
                    thresholdRatio: 0.0,
                    tailSize: 15
                });
                if (wasCompressed) {
                    await HistoryManager.saveRawHistory(ctx.activeConversationId, compressedHistory);
                    ctx.onLog('success', '✔ Memória compactada com sucesso (Tail Protection)!');
                } else {
                    ctx.onLog('info', 'ℹ Histórico muito curto para compactação.');
                }
            } catch (error: any) {
                ctx.onLog('error', `Erro durante a compactação: ${error.message}`);
            }
        } else {
            ctx.onLog('warning', 'Nenhuma conversação ativa para compactar.');
        }
        return { handled: true };
    }

    if (trimmed === '/context') {
        if (ctx.activeConversationId) {
            const rawHistory = await HistoryManager.getRawHistory(ctx.activeConversationId);
            const totalTokensEst = Math.ceil(JSON.stringify(rawHistory).length / 4);
            ctx.onLog('info', `📊 Histórico ativo: ${rawHistory.length} mensagens`);
            ctx.onLog('info', `📊 Tamanho estimado: ${totalTokensEst} / 8000 tokens (${Math.round((totalTokensEst / 8000) * 100)}% do limite)`);
        } else {
            ctx.onLog('warning', 'Nenhuma conversação ativa para analisar.');
        }
        return { handled: true };
    }

    if (trimmed === '/skills') {
        const availableSkills = await ctx.skillManager.listAvailableSkills();
        if (availableSkills.length === 0) {
            ctx.onLog('warning', 'Nenhuma skill encontrada. Execute `shark super` para instalar as skills.');
            return { handled: true };
        }
        if (ctx.onPromptSelect) {
            const options = availableSkills.map(name => ({ value: name, label: name }));
            const selected = await ctx.onPromptSelect({
                message: 'Selecione a Skill do Superpowers para ativar:',
                options
            });
            if (selected) {
                await ctx.skillManager.activateSkill(selected);
                ctx.onLog('success', `✔ Skill '${selected}' ativada com sucesso!`);
            }
        } else {
            ctx.onLog('info', `Skills disponíveis:\n${availableSkills.map(s => `• ${s}`).join('\n')}`);
        }
        return { handled: true };
    }

    if (trimmed === '/chat') {
        const historyDir = path.resolve(ctx.projectRoot, '_sharkrc', 'history');
        if (fs.existsSync(historyDir)) {
            const files = fs.readdirSync(historyDir);
            const rawFiles = files.filter(f => f.endsWith('.raw.json') || f.endsWith('.json'));
            const conversationIds = Array.from(new Set(rawFiles.map(f => f.replace('.raw.json', '').replace('.json', ''))));

            if (conversationIds.length === 0) {
                ctx.onLog('warning', 'Nenhuma conversa encontrada em _sharkrc/history.');
                return { handled: true };
            }

            const state = await workflowManager.load();
            const conversationsMap = state?.conversations || {};
            const idToAgentMap: Record<string, string> = {};
            for (const [key, id] of Object.entries(conversationsMap)) {
                if (typeof id === 'string') {
                    idToAgentMap[id] = key;
                }
            }

            const items: any[] = [];
            for (const id of conversationIds) {
                const rawPath = path.resolve(historyDir, `${id}.raw.json`);
                const jsonPath = path.resolve(historyDir, `${id}.json`);
                const filePath = fs.existsSync(rawPath) ? rawPath : jsonPath;

                try {
                    const stats = fs.statSync(filePath);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const messages = JSON.parse(content);
                    if (Array.isArray(messages)) {
                        const firstUser = messages.find((m: any) => m.role === 'user')?.content || '';
                        const agentKey = idToAgentMap[id] || 'standalone';
                        items.push({
                            id,
                            agentKey,
                            mtime: stats.mtime,
                            firstUser
                        });
                    }
                } catch {}
            }

            items.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            const options = items.map(item => {
                const shortId = item.id.substring(0, 8);
                const dateStr = item.mtime.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + item.mtime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const snippet = item.firstUser.replace(/\n/g, ' ').substring(0, 60);
                const topic = snippet ? ` | Assunto: "${snippet}"` : '';
                return {
                    value: item.id,
                    label: `[${shortId}...] (${item.agentKey}) | ${dateStr}${topic}`
                };
            });

            const selectedId = await tui.select({
                message: 'Selecione a conversa para carregar:',
                options
            });

            if (!tui.isCancel(selectedId) && selectedId) {
                const newActiveId = selectedId as string;
                if (ctx.conversationKey) {
                    await conversationManager.saveConversationId(ctx.conversationKey, newActiveId);
                }
                ctx.onLog('success', `✔ Alternado para a conversa: ${newActiveId.substring(0, 8)}...`);

                const rawHistory = await HistoryManager.getRawHistory(newActiveId);
                const nonSystem = rawHistory.filter(m => m.role !== 'system');
                const lastMsgs = nonSystem.slice(-4);

                ctx.onLog('info', colors.dim('\n--- HISTÓRICO RECENTE ---'));
                for (const msg of lastMsgs) {
                    const sender = msg.role === 'user' ? colors.warning('👤 [Você]') : colors.primary('🤖 [Shark Dev]');
                    const text = msg.content.substring(0, 300) + (msg.content.length > 300 ? '...' : '');
                    console.log(`${sender}: ${text}`);
                }
                ctx.onLog('info', colors.dim('------------------------\n'));
                return { handled: true, activeConversationId: newActiveId };
            }
        } else {
            ctx.onLog('warning', 'Diretório de histórico não encontrado.');
        }
        return { handled: true };
    }

    return { handled: false };
}
