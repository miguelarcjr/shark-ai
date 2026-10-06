import { subagentManager } from '../workflow/subagent-manager.js';
import type { MessageQueue } from '../workflow/message-queue.js';

export function formatNotification(msg: any): string {
    const text = typeof msg === 'object' && msg.message ? msg.message : String(msg);
    if (text.startsWith('<subagent_notification')) return text;
    let status = 'completed';
    if (text.includes('FAILED') || text.includes('failed')) status = 'failed';
    if (text.includes('CANCELLED') || text.includes('cancelled')) status = 'cancelled';
    return `<subagent_notification status="${status}">\n${text}\n</subagent_notification>`;
}

export async function drainIncomingNotifications(recipientId: string, messageQueue: MessageQueue): Promise<string[]> {
    const diskMessages = subagentManager.retrieveMessages(recipientId);
    const queuedMessages: string[] = [];
    while (!messageQueue.isEmpty()) {
        const qMsg = await messageQueue.next();
        if (qMsg && qMsg.content) {
            if (qMsg.type === 'process_notification') {
                const status = qMsg.metadata?.status || (qMsg.metadata?.exitCode === 0 ? 'completed' : 'failed');
                queuedMessages.push(`<process_notification status="${status}">\n${qMsg.content}\n</process_notification>`);
            } else {
                queuedMessages.push(formatNotification(qMsg.content));
            }
        }
    }
    return [
        ...diskMessages.map(formatNotification),
        ...queuedMessages
    ];
}

export function formatActiveSubagentsPanel(parentId: string): string {
    const activeSubs = subagentManager.getActiveSubagentsForParent(parentId);
    if (activeSubs.length === 0) return '';
    let panel = `\n--- ACTIVE SUBAGENTS ---\n`;
    panel += `You have spawned the following subagents that are currently working in parallel:\n`;
    for (const sub of activeSubs) {
        panel += `- ID: ${sub.id} | Role: ${sub.role} | Status: ${sub.status}${sub.summary ? ` | Last Status: ${sub.summary}` : ''}\n`;
    }
    panel += `Use the 'wait' action if you have no other work and are waiting for these subagents to complete.\n`;
    panel += `--------------------------------\n`;
    return panel;
}

export function terminateChildSubagents(parentId: string, log?: { info: (msg: string) => void }) {
    const activeSubs = subagentManager.getActiveSubagentsForParent(parentId);
    if (activeSubs.length > 0) {
        log?.info(`🧹 Terminating ${activeSubs.length} active child subagent(s)...`);
        for (const sub of activeSubs) {
            subagentManager.killSubagent(sub.id);
        }
    }
}

export function setupProcessCleanup(parentId: string, log?: { info: (msg: string) => void }): { dispose: () => void } {
    const handleCleanupSignal = (exitCode: number) => {
        terminateChildSubagents(parentId, log);
        process.exit(exitCode);
    };
    const sigIntHandler = () => handleCleanupSignal(130);
    const sigTermHandler = () => handleCleanupSignal(143);

    process.on('SIGINT', sigIntHandler);
    process.on('SIGTERM', sigTermHandler);

    return {
        dispose: () => {
            process.off('SIGINT', sigIntHandler);
            process.off('SIGTERM', sigTermHandler);
        }
    };
}
