import * as path from 'node:path';
import { StateDB } from '../memory/state-db.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import type { CronJob } from './cron-types.js';

export interface MirrorDeliveryOptions {
    job: CronJob;
    deliveredText: string;
    deliverySuccess: boolean;
    projectRoot?: string;
    stateDb?: StateDB;
}

export class CronDeliveryMirror {
    /**
     * Espelha a notificação entregue de um cronjob diretamente na sessão de conversa
     * ativa do usuário com papel 'user' e prefixo estruturado [Cron delivery: <job>].
     * 
     * Respeita todas as guardas de elegibilidade (RN01, RF04, RNF02).
     */
    public static async mirrorToSession(options: MirrorDeliveryOptions): Promise<boolean> {
        const { job, deliveredText, deliverySuccess } = options;

        // 1. Guarda de Falha de Entrega (RNF02)
        if (!deliverySuccess) {
            return false;
        }

        // 2. Guarda de Silenciamento (RN01)
        if (!deliveredText || deliveredText.includes('[SILENT]') || deliveredText.includes('NO_REPLY')) {
            return false;
        }

        // 3. Guarda de Modo Local e Broadcast (RF04 / Casos de Exceção 2 e 5)
        if (job.deliver === 'local' || job.deliver === 'all') {
            return false;
        }

        // 4. Guarda de Elegibilidade e Anexação (RF04 / Caso de Exceção 3)
        // Se deliver !== 'origin', só espelha se attach_to_session for explicitamente true
        const isEligible = job.deliver === 'origin' || job.attach_to_session === true;
        if (!isEligible) {
            return false;
        }

        // 5. Determinação da Sessão Alvo de Origem
        const originChannel = job.origin_channel || 'cli';
        const originRecipientId = job.origin_recipient_id || 'local';
        const sessionId = originChannel === 'cli' ? 'default' : `${originChannel}:dm:${originRecipientId}`;

        // 6. Formatação Estruturada (RF01)
        const jobDisplayName = job.name || job.id;
        const formattedContent = `[Cron delivery: ${jobDisplayName}]\n${deliveredText}`;

        // 7. Persistência na Fonte Única (SQLite StateDB - RNF01)
        try {
            const dbPath = options.projectRoot ? path.join(options.projectRoot, '.shark', 'state.db') : undefined;
            const stateDb = options.stateDb || new StateDB(dbPath);
            stateDb.recordMessage(sessionId, 'user', formattedContent);
            if (!options.stateDb) {
                stateDb.close();
            }
        } catch (err) {
            console.warn('[CronDeliveryMirror] Erro ao gravar no StateDB:', err);
        }

        // 8. Atualização do Histórico Imediato da Conversa (HistoryManager)
        try {
            const originalCwd = process.cwd();
            const targetDir = options.projectRoot || originalCwd;
            if (targetDir !== originalCwd) {
                try { process.chdir(targetDir); } catch {}
            }
            try {
                const conversationKey = `session_${sessionId}`;
                const conversationId = await conversationManager.getConversationId(conversationKey);
                if (conversationId) {
                    await HistoryManager.appendMessage(conversationId, {
                        role: 'user',
                        content: formattedContent
                    });
                    const rawHistory = await HistoryManager.getRawHistory(conversationId);
                    rawHistory.push({ role: 'user', content: formattedContent });
                    await HistoryManager.saveRawHistory(conversationId, rawHistory);
                }
            } finally {
                if (process.cwd() !== originalCwd) {
                    try { process.chdir(originalCwd); } catch {}
                }
            }
        } catch (err) {
            console.warn('[CronDeliveryMirror] Erro ao sincronizar HistoryManager:', err);
        }

        return true;
    }
}
