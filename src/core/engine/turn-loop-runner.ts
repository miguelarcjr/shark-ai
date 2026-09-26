import { MessageQueue, type QueueMessage } from '../workflow/message-queue.js';
import { subagentManager } from '../workflow/subagent-manager.js';
import { conversationManager } from '../workflow/conversation-manager.js';
import { HistoryManager } from '../workflow/history-manager.js';
import { ContextCompressor } from '../workflow/context-compressor.js';
import { ConfigManager } from '../config-manager.js';
import { waitForInputOrNotification, formatRoleForUI } from '../workflow/interactive-prompt.js';
import { tui } from '../../ui/tui.js';
import { colors } from '../../ui/colors.js';
import { drainIncomingNotifications, formatActiveSubagentsPanel } from './subagent-sync.js';
import type { PreparedEngineContext } from './engine-context-builder.js';
import type { AgentActionExecutor } from './agent-action-executor.js';

export interface DevelopmentResult {
    success: boolean;
    summary: string;
}

export interface TurnLoopOptions {
    sessionId: string;
    projectRoot: string;
    taskId?: string;
    isBatchMode: boolean;
    messageQueue: MessageQueue;
    abortController: AbortController;
    actionExecutor: AgentActionExecutor;
    context: PreparedEngineContext;
    emitOutbound?: (event: any) => void;
}

function isUserCancellation(content: any): boolean {
    return tui.isCancel(content) || !content || content === 'cancel';
}

export class TurnLoopRunner {
    static async run(options: TurnLoopOptions): Promise<DevelopmentResult> {
        const {
            sessionId,
            taskId,
            isBatchMode,
            messageQueue,
            abortController,
            actionExecutor,
            context
        } = options;

        const effectiveTaskId = taskId;
        const isSubagent = !!effectiveTaskId && (effectiveTaskId.startsWith('subagent-') || subagentManager.hasSubagent(effectiveTaskId));
        const myId = effectiveTaskId || 'parent';

        let subagentPrefix = '';
        if (effectiveTaskId) {
            const subState = subagentManager.getSubagentState(effectiveTaskId);
            if (subState) {
                subagentPrefix = `[Subagent: ${formatRoleForUI(subState.role)}] `;
            }
        }

        const log = {
            info: (msg: string) => tui.log.info(`${subagentPrefix}${msg}`),
            warning: (msg: string) => tui.log.warning(`${subagentPrefix}${msg}`),
            error: (msg: string) => tui.log.error(`${subagentPrefix}${msg}`),
            success: (msg: string) => tui.log.success(`${subagentPrefix}${msg}`),
        };

        const spinner = tui.spinner();
        let keepGoing = true;
        let finalSummary = '';
        let userDraftBuffer = '';
        let currentPrompt = context.basePrompt;
        let activeConversationId = context.activeConversationId;
        const forkReviewAgent = context.forkReviewAgent;

        let consecutiveValidationErrors = 0;

        while (keepGoing) {
            if (abortController.signal.aborted) {
                keepGoing = false;
                return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
            }

            // Drena caixa postal e monta painel de subagentes
            const incomingNotifications = await drainIncomingNotifications(myId, messageQueue);
            let currentTurnPrompt = currentPrompt;
            if (incomingNotifications.length > 0) {
                currentTurnPrompt += `\n\n✉️ NEW MAILBOX MESSAGES:\n${incomingNotifications.join('\n\n')}\n`;
            }

            const panel = formatActiveSubagentsPanel(myId);
            if (panel) {
                currentTurnPrompt += panel;
            }

            const activeCount = subagentManager.getActiveSubagents().length;
            const spinnerText = activeCount > 0
                ? `🦈 Shark Dev working... (Active subagents: ${activeCount})`
                : '🦈 Shark Dev working...';
            spinner.start(spinnerText);

            // Compressão com Tail Protection
            if (activeConversationId) {
                const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                const config = ConfigManager.getInstance().getConfig();
                const compactionTokenLimit = config.memory?.compactionTokenLimit ?? 120000;
                const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                    tokenLimit: compactionTokenLimit,
                    thresholdRatio: 0.8,
                    tailSize: 15,
                    provider: context.activeProvider
                });
                if (wasCompressed) {
                    await HistoryManager.saveRawHistory(activeConversationId, compressedHistory);
                    actionExecutor?.resetReadCounts();
                }
            }

            let response: any;
            try {
                response = await context.activeProvider.streamChat(currentTurnPrompt, {
                    conversationId: activeConversationId,
                    agentType: 'developer_agent',
                    searchQuery: currentPrompt,
                    systemPrompt: context.dynamicSystemPrompt,
                    hasMcpServers: (context.mcpTools || []).length > 0,
                    signal: abortController.signal,
                    onChunk: () => {}
                });
            } catch (e: any) {
                spinner.stop('Interrupted');
                if (e.name === 'AbortError' || abortController.signal.aborted) {
                    log.warning('Interrupção solicitada via Esc. Retornando ao prompt...');
                    if (activeConversationId) {
                        await HistoryManager.saveRawHistory(activeConversationId, [
                            ...(await HistoryManager.getRawHistory(activeConversationId)),
                            { role: 'user', content: '[Execução interrompida pelo usuário via Esc. A ação anterior foi cancelada antes de sua conclusão.]' }
                        ]);
                    }
                    if (isBatchMode) {
                        return { success: false, summary: 'Interrupted by user' };
                    }
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    currentPrompt = nextMsg.content;
                    continue;
                }
                throw e;
            }

            const stopMessage = response?.summary || (response?.action ? `Ação: ${response.action.type}` : 'Resposta recebida');
            spinner.stop(stopMessage);

            if (response?.thought) {
                log.info(colors.dim(`💭 ${response.thought}`));
            }

            if (abortController.signal.aborted) {
                keepGoing = false;
                return { success: false, summary: (abortController.signal as any).reason || 'Interrupted by user' };
            }

            if (response?.conversation_id) {
                activeConversationId = response.conversation_id;
                await conversationManager.saveConversationId(context.conversationKey, response.conversation_id);
            }

            if (response?.summary && effectiveTaskId) {
                subagentManager.updateSubagentSummary(effectiveTaskId, response.summary);
            }

            // TASK_COMPLETED
            if (response?.message && response.message.includes('TASK_COMPLETED:') && !isSubagent) {
                const mainContent = response.message.split('TASK_COMPLETED:')[0].trim();
                if (mainContent) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(mainContent);
                }

                finalSummary = response.message.split('TASK_COMPLETED:')[1].trim();
                log.success(`✔ Task Completed: ${finalSummary}`);

                if (effectiveTaskId) {
                    subagentManager.updateSubagentSummary(effectiveTaskId, finalSummary);
                    subagentManager.terminateSubagent(effectiveTaskId, true);
                    if (process.env.SHARK_PARENT_ID) {
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${effectiveTaskId}) completed.\nResult Details:\n${mainContent || finalSummary}`
                        );
                    }
                    keepGoing = false;
                    break;
                }

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    let nextMsg: QueueMessage;
                    if (!messageQueue.isEmpty()) {
                        nextMsg = await messageQueue.next();
                    } else {
                        nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        userDraftBuffer = (nextMsg as any).draft || '';
                    }
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    keepGoing = false;
                    break;
                }
            }

            // TASK_FAILED
            if (response?.message && response.message.includes('TASK_FAILED:')) {
                const failReason = response.message.split('TASK_FAILED:')[1].trim();
                log.error(`❌ Agent reported task failure: ${failReason}`);
                if (effectiveTaskId) {
                    subagentManager.terminateSubagent(effectiveTaskId, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) has finished with status: FAILED. Summary: ${failReason}`
                        );
                    }
                    return { success: false, summary: failReason };
                }
                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                        return { success: false, summary: failReason };
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    return { success: false, summary: failReason };
                }
            }

            const action = response?.action;
            if (!action) {
                if (isSubagent) {
                    const summary = 'No action returned by the subagent.';
                    log.warning(summary);
                    subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                    subagentManager.terminateSubagent(effectiveTaskId!, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: No action returned in response.`
                        );
                    }
                    return { success: false, summary };
                }

                if (response?.message) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(response.message);
                    if (activeConversationId) {
                        const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                        void forkReviewAgent.maybeTriggerReview(rawHistory);
                    }
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode);
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                } else {
                    log.warning('No action or message returned by the agent.');
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Agent returned empty response. Type a message to continue or press Ctrl+C to cancel:', subagentPrefix, undefined, isBatchMode);
                    if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                        return { success: true, summary: 'Task completed without summary.' };
                    }
                    currentPrompt = nextMsg.content;
                }
                continue;
            }

            forkReviewAgent.onToolIteration();
            if (effectiveTaskId) {
                subagentManager.updateSubagentAction(effectiveTaskId, action.type, action);
            }

            // complete_task action
            if (action.type === 'complete_task') {
                consecutiveValidationErrors = 0;
                const taskSummary = action.args?.summary || action.summary || response.summary || 'Task completed successfully.';
                const detailedContent = action.args?.content || action.content || '';

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (isSubagent) {
                    subagentManager.updateSubagentSummary(effectiveTaskId!, taskSummary);
                    subagentManager.terminateSubagent(effectiveTaskId!, true);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) completed.\nResult Details:\n${detailedContent}`
                        );
                    }
                    finalSummary = taskSummary;
                    keepGoing = false;
                    break;
                } else {
                    if (detailedContent) {
                        log.info(colors.primary('🤖 Shark Dev:'));
                        console.log(detailedContent);
                    }
                    log.success(`✔ Task Completed: ${taskSummary}`);
                    if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                        const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                        userDraftBuffer = (nextMsg as any).draft || '';
                        if (nextMsg.type === 'user' && isUserCancellation(nextMsg.content)) {
                            finalSummary = taskSummary;
                            keepGoing = false;
                            break;
                        }
                        currentPrompt = nextMsg.content;
                        continue;
                    } else {
                        finalSummary = taskSummary;
                        keepGoing = false;
                        break;
                    }
                }
            }

            // wait action
            if (action.type === 'wait') {
                const durationSeconds = action.args?.duration_seconds ?? action.duration_seconds ?? 0;
                const durationMs = durationSeconds > 0 ? durationSeconds * 1000 : undefined;
                log.info(`⏳ Waiting for updates (Timeout: ${durationSeconds || 'infinite'}s)...`);

                let nextMsg: QueueMessage;
                if (!messageQueue.isEmpty()) {
                    nextMsg = await messageQueue.next();
                } else {
                    nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, durationMs, isBatchMode, userDraftBuffer);
                    userDraftBuffer = (nextMsg as any).draft || '';
                }

                if (nextMsg.type === 'user') {
                    forkReviewAgent.onUserTurn();
                    if (isUserCancellation(nextMsg.content)) {
                        keepGoing = false;
                        break;
                    }
                    currentPrompt = nextMsg.content;
                } else if (nextMsg.type === 'subagent_notification') {
                    currentPrompt = `[Subagent Notification Received]:\n${nextMsg.content}`;
                } else if (nextMsg.type === 'timeout') {
                    currentPrompt = `[System]: Wait duration of ${durationSeconds} seconds expired. No notifications received.`;
                }
                continue;
            }

            // talk_with_user action
            if (action.type === 'talk_with_user') {
                const talkContent = action.content || action.args?.content || action.message || action.args?.message || '';
                const isSystemError = (typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]')) ||
                    response?.isError === true;
                if (isSystemError) {
                    consecutiveValidationErrors++;
                    if (consecutiveValidationErrors >= 3 && activeConversationId) {
                        log.warning('⚠️ 3 falhas consecutivas de validação de ação detectadas. Executando compactação e limpeza de contexto...');
                        try {
                            const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                            const config = ConfigManager.getInstance().getConfig();
                            const compactionTokenLimit = config.memory?.compactionTokenLimit ?? 120000;
                            const { history: compressedHistory, wasCompressed } = await ContextCompressor.compress(rawHistory, {
                                tokenLimit: compactionTokenLimit,
                                thresholdRatio: 0.8,
                                tailSize: 10,
                                force: true,
                                provider: context.activeProvider
                            });
                            if (wasCompressed) {
                                await HistoryManager.saveRawHistory(activeConversationId, compressedHistory);
                                actionExecutor?.resetReadCounts();
                                log.success('🧹 Contexto compactado com sucesso para desobstruir o raciocínio do modelo.');
                            }
                        } catch (err: any) {
                            log.warning(`Falha ao tentar compactar contexto após erros consecutivos: ${err?.message || err}`);
                        }
                        // Reset counter after trigger attempt
                        consecutiveValidationErrors = 0;
                    }
                    currentPrompt = talkContent || response?.errorMessage || '[SYSTEM ERROR]: Invalid action structure.';
                    continue;
                }

                consecutiveValidationErrors = 0;

                if (isSubagent) {
                    const summary = `Subagent returned invalid response format or tried to talk with user. Content: ${talkContent}`;
                    subagentManager.updateSubagentSummary(effectiveTaskId!, summary);
                    subagentManager.terminateSubagent(effectiveTaskId!, false);
                    if (process.env.SHARK_PARENT_ID) {
                        const role = process.env.SHARK_SUBAGENT_ROLE || 'Subagent';
                        subagentManager.sendMessage(
                            process.env.SHARK_PARENT_ID,
                            `[Subagent Notification] Subagent ${role} (${effectiveTaskId}) failed. Reason: Returned raw text or unsupported action instead of valid JSON.`
                        );
                    }
                    return { success: false, summary };
                }

                if (talkContent) {
                    log.info(colors.primary('🤖 Shark Dev:'));
                    console.log(talkContent);
                }

                if (activeConversationId) {
                    const rawHistory = await HistoryManager.getRawHistory(activeConversationId);
                    void forkReviewAgent.maybeTriggerReview(rawHistory);
                }

                if (!isBatchMode || subagentManager.getActiveSubagentsForParent(myId).length > 0) {
                    const nextMsg = await waitForInputOrNotification(messageQueue, 'Your answer:', subagentPrefix, undefined, isBatchMode, userDraftBuffer);
                    userDraftBuffer = (nextMsg as any).draft || '';
                    if (nextMsg.type === 'user') {
                        forkReviewAgent.onUserTurn();
                        if (isUserCancellation(nextMsg.content)) {
                            finalSummary = talkContent;
                            keepGoing = false;
                            break;
                        }
                    }
                    currentPrompt = nextMsg.content;
                    continue;
                } else {
                    finalSummary = talkContent;
                    keepGoing = false;
                    break;
                }
            }

            consecutiveValidationErrors = 0;

            // Executa ferramenta via actionExecutor
            const actionResult = await actionExecutor.executeAction(action);
            currentPrompt = actionResult.output;
        }

        return {
            success: true,
            summary: finalSummary || 'Task completed without summary.'
        };
    }
}
