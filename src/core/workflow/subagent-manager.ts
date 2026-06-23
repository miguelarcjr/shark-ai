import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tui } from '../../ui/tui.js';
import { MessageQueue } from './message-queue.js';

interface SubagentState {
    id: string;
    type: string;
    role: string;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    summary?: string;
    promise?: Promise<any>;
    parentId?: string;
    childProcess?: any;
}

export interface CustomSubagentType {
    name: string;
    description: string;
    systemPrompt: string;
    enableWriteTools?: boolean;
    enableSubagentTools?: boolean;
    enableMcpTools?: boolean;
}

export class SubagentManager {
    private subagents = new Map<string, SubagentState>();
    private customTypes = new Map<string, CustomSubagentType>();
    private messageSeq = 0;

    registerSubagent(id: string, type: string, role: string, parentId?: string) {
        this.subagents.set(id, { id, type, role, status: 'running', parentId });
    }

    terminateSubagent(id: string, success: boolean = true, isCancelled: boolean = false) {
        const state = this.subagents.get(id);
        if (state) {
            if (state.status === 'cancelled') {
                return;
            }
            if (isCancelled) {
                state.status = 'cancelled';
            } else {
                state.status = success ? 'completed' : 'failed';
            }
        }
    }

    isSubagentActive(id: string): boolean {
        return this.subagents.get(id)?.status === 'running';
    }

    hasSubagent(id: string): boolean {
        return this.subagents.has(id);
    }

    getSubagentState(id: string): SubagentState | undefined {
        return this.subagents.get(id);
    }

    updateSubagentSummary(id: string, summary: string) {
        const state = this.subagents.get(id);
        if (state) {
            state.summary = summary;
        }
    }

    sendMessage(recipient: string, message: string) {
        const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', recipient);
        fs.mkdirSync(mailboxDir, { recursive: true });
        const seq = (this.messageSeq++).toString().padStart(6, '0');
        const filePath = path.join(mailboxDir, `${Date.now()}-${seq}-${crypto.randomUUID()}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ message }), 'utf-8');
    }

    retrieveMessages(id: string): string[] {
        const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', id);
        if (!fs.existsSync(mailboxDir)) {
            return [];
        }
        const files = fs.readdirSync(mailboxDir);
        // Sort files to process them in deterministic order (chronologically by filename prefix)
        files.sort();
        const messages: string[] = [];
        for (const file of files) {
            const filePath = path.join(mailboxDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(content);
                if (data && typeof data.message === 'string') {
                    messages.push(data.message);
                }
            } catch (e) {
                // Ignore read/parse errors
            }
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                // Ignore unlink errors
            }
        }
        return messages;
    }

    peekMessages(id: string): string[] {
        const mailboxDir = path.resolve(process.cwd(), '.shark', 'mailbox', id);
        if (!fs.existsSync(mailboxDir)) {
            return [];
        }
        const files = fs.readdirSync(mailboxDir);
        files.sort();
        const messages: string[] = [];
        for (const file of files) {
            const filePath = path.join(mailboxDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(content);
                if (data && typeof data.message === 'string') {
                    messages.push(data.message);
                }
            } catch (e) {
                // Ignore read/parse errors
            }
        }
        return messages;
    }

    defineSubagentType(
        name: string,
        description: string,
        systemPrompt: string,
        options: { enableWriteTools?: boolean; enableSubagentTools?: boolean; enableMcpTools?: boolean } = {}
    ) {
        this.customTypes.set(name, {
            name,
            description,
            systemPrompt,
            ...options
        });
    }

    getCustomSubagentType(name: string): CustomSubagentType | undefined {
        return this.customTypes.get(name);
    }

    getSubagentLogs(id: string, maxLines: number = 50): string {
        if (!/^[a-zA-Z0-9-]+$/.test(id)) {
            throw new Error('Invalid subagent ID format');
        }
        const projectRoot = process.cwd();
        const logFile = path.resolve(projectRoot, '_sharkrc', 'history', `subagent-${id}-console.log`);
        if (!fs.existsSync(logFile)) {
            return "No console logs found for this subagent.";
        }
        try {
            let content = fs.readFileSync(logFile, 'utf-8');
            if (content.endsWith('\n')) {
                content = content.slice(0, -1);
            }
            const lines = content.split('\n');
            const tail = lines.slice(-maxLines);
            return tail.join('\n');
        } catch (e: any) {
            return `Failed to read subagent logs: ${e.message}`;
        }
    }

    getActiveSubagents(): SubagentState[] {
        return Array.from(this.subagents.values()).filter(s => s.status === 'running');
    }

    getActiveSubagentsForParent(parentId: string): SubagentState[] {
        return Array.from(this.subagents.values()).filter(s => s.status === 'running' && s.parentId === parentId);
    }

    killSubagent(id: string) {
        const state = this.subagents.get(id);
        if (state) {
            if (state.childProcess) {
                try {
                    state.childProcess.kill('SIGTERM');
                } catch (e) {
                    // Ignore
                }
            }
            this.terminateSubagent(id, false, true); // true sets status to 'cancelled'
            
            // Send cancellation notification to parent mailbox
            if (state.parentId) {
                const cancelMsg = `[Subagent Notification] Subagent ${state.role} (${id}) has finished with status: CANCELLED. Summary: Terminated by parent agent.`;
                this.sendMessage(state.parentId, cancelMsg);
            }
        }
    }

    killAllSubagents() {
        for (const [id, state] of this.subagents.entries()) {
            if (state.status === 'running') {
                this.killSubagent(id);
            }
        }
    }

    async invokeSubagents(
        subagents: Array<{ TypeName: string, Role: string, Prompt: string }>,
        parentId: string,
        parentQueue?: MessageQueue
    ): Promise<Array<{ id: string, TypeName: string, Role: string }>> {
        const invoked: Array<{ id: string, TypeName: string, Role: string }> = [];

        for (const sub of subagents) {
            const id = `subagent-${crypto.randomUUID()}`;
            this.registerSubagent(id, sub.TypeName, sub.Role, parentId);

            // Spawn the subagent execution in the background as a child process
            const promise = (async () => {
                try {
                    const projectRoot = process.cwd();
                    const __filename = fileURLToPath(import.meta.url);
                    const __dirname = path.dirname(__filename);

                    // Find the package root of shark-ai containing package.json with name "shark-ai"
                    let packageRoot = __dirname;
                    while (true) {
                        const pkgPath = path.join(packageRoot, 'package.json');
                        if (fs.existsSync(pkgPath)) {
                            try {
                                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                                if (pkg && pkg.name === 'shark-ai') {
                                    break;
                                }
                            } catch (e) {
                                // Ignore
                            }
                        }
                        const parent = path.dirname(packageRoot);
                        if (parent === packageRoot) {
                            break;
                        }
                        packageRoot = parent;
                    }
                    const pathToSharkJs = path.resolve(packageRoot, 'dist', 'bin', 'shark.js');

                    const customType = this.customTypes.get(sub.TypeName);
                    let customContext = `Você está executando em modo SUBAGENTE.\n`;
                    customContext += `- Seu ID é: ${id}\n`;
                    customContext += `- O ID do seu Agente Pai é: ${parentId}\n`;
                    customContext += `- Você NÃO tem um terminal interativo com o usuário humano. Não use 'talk_with_user' para interagir.\n`;
                    customContext += `- Para reportar progresso intermediário ou tirar dúvidas com seu pai, use a ação 'send_message' com Recipient='${parentId}'.\n`;
                    customContext += `- Para concluir a tarefa e enviar o resultado detalhado em markdown, use obrigatoriamente a ação 'complete_task' com suas descobertas no campo 'content'.\n`;
                    
                    if (customType) {
                        customContext += `Custom Prompt: ${customType.systemPrompt}\n`;
                    }
                    const instruction = customContext + '\n\n' + sub.Prompt;

                    const args = ['dev', '-t', instruction, '--taskId', id, '--auto'];

                    // Fork the child process silently (pipes stdout/stderr)
                    const child = fork(pathToSharkJs, args, {
                        cwd: projectRoot,
                        silent: true,
                        env: {
                            ...process.env,
                            SHARK_PARENT_ID: parentId,
                            SHARK_SUBAGENT_ROLE: sub.Role
                        }
                    });

                    // Store child process reference to allow termination (kill/kill_all)
                    const state = this.subagents.get(id);
                    if (state) {
                        state.childProcess = child;
                    }

                    // Pipe console output to a history log file for process isolation
                    const historyDir = path.resolve(projectRoot, '_sharkrc', 'history');
                    fs.mkdirSync(historyDir, { recursive: true });
                    const consoleLogFile = path.join(historyDir, `subagent-${id}-console.log`);
                    const logStream = fs.createWriteStream(consoleLogFile, { flags: 'a' });

                    if (child.stdout) {
                        child.stdout.pipe(logStream);
                    }
                    if (child.stderr) {
                        child.stderr.pipe(logStream);
                    }

                    // Wait for the child process to exit
                    const exitCode = await new Promise<number | null>(resolve => {
                        child.on('exit', (code) => {
                            resolve(code);
                        });
                    });

                    logStream.end();

                    const isCancelled = this.subagents.get(id)?.status === 'cancelled';
                    const success = exitCode === 0;
                    this.terminateSubagent(id, success);
                    
                    if (isCancelled) {
                        this.updateSubagentSummary(id, 'Terminated by parent agent.');
                        tui.log.message(`\nSubagent ${sub.Role} (${id}) cancelled.`);
                    } else if (!success) {
                        this.updateSubagentSummary(id, 'Failed');
                        const fallbackMsg = `[Subagent Notification] Subagent ${sub.Role} (${id}) has finished with status: FAILED. Summary: Subagent process exited with code ${exitCode}`;
                        const mailboxDir = path.resolve(projectRoot, '.shark', 'mailbox', parentId);
                        const hasMessages = fs.existsSync(mailboxDir) && fs.readdirSync(mailboxDir).length > 0;
                        if (!hasMessages) {
                            this.sendMessage(parentId, fallbackMsg);
                        }
                        tui.log.error(`Subagent ${sub.Role} (${id}) failed.`);
                    } else {
                        this.updateSubagentSummary(id, 'Completed');
                        // Print the subagent notification message to the parent console immediately
                        const parentMsgs = this.peekMessages(parentId);
                        const subagentMsg = parentMsgs.find(m => m.includes(`(${id})`));
                        if (subagentMsg) {
                            tui.log.message(`\n${subagentMsg}`);
                        } else {
                            tui.log.success(`Subagent ${sub.Role} (${id}) completed successfully.`);
                        }
                    }

                    if (parentQueue) {
                        let summaryContent = "Tarefa concluída sem resumo.";
                        let statusVal: 'completed' | 'failed' | 'cancelled' = success ? 'completed' : 'failed';
                        if (isCancelled) {
                            summaryContent = 'Terminated by parent agent.';
                            statusVal = 'cancelled';
                        } else if (success) {
                            const parentMsgs = this.peekMessages(parentId);
                            const subagentMsg = parentMsgs.find(m => m.includes(`(${id})`));
                            if (subagentMsg) {
                                summaryContent = subagentMsg;
                            }
                        } else {
                            summaryContent = `Subagente falhou com código de saída ${exitCode}`;
                        }
                        parentQueue.push({
                            type: 'subagent_notification',
                            content: summaryContent,
                            timestamp: Date.now(),
                            metadata: {
                                subagentId: id,
                                role: sub.Role,
                                status: statusVal
                            }
                        });
                    }

                } catch (error) {
                    console.error(`Subagent ${id} failed to spawn:`, error);
                    this.terminateSubagent(id, false);
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    this.sendMessage(
                        parentId,
                        `[Subagent Notification] Subagent ${sub.Role} (${id}) has finished with status: FAILED. Summary: Subagent spawn failed: ${errorMsg}`
                    );
                    tui.log.error(`Subagent ${sub.Role} (${id}) failed to spawn.`);
                    if (parentQueue) {
                        parentQueue.push({
                            type: 'subagent_notification',
                            content: `Subagente falhou ao iniciar: ${errorMsg}`,
                            timestamp: Date.now(),
                            metadata: {
                                subagentId: id,
                                role: sub.Role,
                                status: 'failed'
                            }
                        });
                    }
                }
            })();

            const state = this.subagents.get(id);
            if (state) {
                state.promise = promise;
            }

            invoked.push({ id, TypeName: sub.TypeName, Role: sub.Role });
        }

        return invoked;
    }
}

export const subagentManager = new SubagentManager();
