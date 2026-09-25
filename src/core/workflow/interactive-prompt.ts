import { tui } from '../../ui/tui.js';
import { skillManager } from './skill-manager.js';
import { MessageQueue, type QueueMessage } from './message-queue.js';

export function formatRoleForUI(role: string): string {
    const limit = 20;
    if (role.length <= limit) return role;
    return role.substring(0, limit - 3) + '...';
}

export async function promptUser(
    message: string,
    initialValue?: string,
    placeholder?: string,
    prefix: string = '',
    onCommandHandler?: (command: string) => Promise<boolean>
): Promise<string> {
    const textOpts: any = { message: `${prefix}${message}` };
    if (initialValue) textOpts.initialValue = initialValue;
    if (placeholder) textOpts.placeholder = placeholder;
    let userReply = await tui.text(textOpts);

    while (userReply && userReply.startsWith('/')) {
        let handled = false;
        if (onCommandHandler) {
            handled = await onCommandHandler(userReply);
        }
        if (!handled && userReply === '/skills') {
            const availableSkills = await skillManager.listAvailableSkills();
            const options = availableSkills.map(name => ({ value: name, label: name }));
            if (options.length === 0) {
                tui.log.warning('Nenhuma skill encontrada. Execute `shark super` para instalar as skills.');
            } else {
                const selectedSkill = await tui.select({
                    message: 'Selecione a Skill do Superpowers para ativar:',
                    options
                });
                if (!tui.isCancel(selectedSkill)) {
                    await skillManager.activateSkill(selectedSkill as string);
                    tui.log.success(`✔ Skill '${selectedSkill}' ativada com sucesso!`);
                }
            }
            handled = true;
        }

        userReply = await tui.text({
            message: `${prefix}${message}`,
            initialValue,
            placeholder: 'digite a instrução da tarefa...'
        });
    }

    return userReply as string;
}

export async function waitForInputOrNotification(
    queue: MessageQueue,
    promptMessage: string = 'Your answer:',
    subagentPrefix: string = '',
    timeoutMs?: number,
    isAuto: boolean = false,
    initialDraft?: string
): Promise<QueueMessage & { draft?: string }> {
    let cancelled = false;
    let resolvePromptPromise: ((value: QueueMessage) => void) | null = null;
    let timerId: any = null;
    let capturedDraft = initialDraft || '';

    const promises: Promise<QueueMessage>[] = [];

    let promptStarted = false;
    if (!isAuto) {
        promptStarted = true;
        const promptPromise = new Promise<QueueMessage>((resolve) => {
            resolvePromptPromise = resolve;
        });

        const runPrompt = async () => {
            try {
                const userReply = await promptUser(promptMessage, initialDraft, undefined, subagentPrefix);
                if (typeof userReply === 'string') {
                    capturedDraft = userReply;
                }
                if (!cancelled && resolvePromptPromise) {
                    resolvePromptPromise({
                        type: 'user',
                        content: userReply,
                        timestamp: Date.now()
                    });
                }
            } catch (e) {}
        };
        runPrompt();
        promises.push(promptPromise);
    }

    const queuePromise = queue.next();
    promises.push(queuePromise);

    if (timeoutMs !== undefined && timeoutMs !== null) {
        const timeoutPromise = new Promise<QueueMessage>((resolve) => {
            timerId = setTimeout(() => {
                if (resolvePromptPromise) {
                    cancelled = true;
                }
                resolve({
                    type: 'timeout',
                    content: 'Wait timeout expired.',
                    timestamp: Date.now()
                });
            }, timeoutMs);
        });
        promises.push(timeoutPromise);
    }

    const winner = await Promise.race(promises);

    if (timerId) {
        clearTimeout(timerId);
    }

    if (winner.type === 'subagent_notification' || winner.type === 'timeout') {
        cancelled = true;
        if (promptStarted) {
            try {
                process.stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false });
                process.stdin.emit('data', Buffer.from('\r\n'));
            } catch {}
            await new Promise(r => setTimeout(r, 50));
            if (process.stdout.isTTY) {
                process.stdout.write('\x1b[1A\x1b[2K\x1b[1A\x1b[2K');
            }
        }
    } else if (winner.type === 'user') {
        capturedDraft = '';
    }

    return Object.assign(winner, { draft: capturedDraft });
}
