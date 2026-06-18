import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

interface SubagentState {
    id: string;
    type: string;
    role: string;
    status: 'running' | 'completed' | 'failed';
    promise?: Promise<any>;
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
    private mailbox = new Map<string, string[]>(); // targetId -> messages
    private customTypes = new Map<string, CustomSubagentType>();

    registerSubagent(id: string, type: string, role: string) {
        this.subagents.set(id, { id, type, role, status: 'running' });
    }

    terminateSubagent(id: string, success: boolean = true) {
        const state = this.subagents.get(id);
        if (state) {
            state.status = success ? 'completed' : 'failed';
        }
    }

    isSubagentActive(id: string): boolean {
        return this.subagents.get(id)?.status === 'running';
    }

    hasSubagent(id: string): boolean {
        return this.subagents.has(id);
    }

    sendMessage(recipient: string, message: string) {
        if (!this.mailbox.has(recipient)) {
            this.mailbox.set(recipient, []);
        }
        this.mailbox.get(recipient)!.push(message);
    }

    retrieveMessages(id: string): string[] {
        const msgs = this.mailbox.get(id) || [];
        this.mailbox.set(id, []);
        return msgs;
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

    getActiveSubagents(): SubagentState[] {
        return Array.from(this.subagents.values()).filter(s => s.status === 'running');
    }

    killSubagent(id: string) {
        this.terminateSubagent(id, false);
    }

    killAllSubagents() {
        for (const [id, state] of this.subagents.entries()) {
            if (state.status === 'running') {
                this.terminateSubagent(id, false);
            }
        }
    }

    async invokeSubagents(
        subagents: Array<{ TypeName: string, Role: string, Prompt: string }>,
        parentId: string
    ): Promise<Array<{ id: string, TypeName: string, Role: string }>> {
        const invoked: Array<{ id: string, TypeName: string, Role: string }> = [];

        for (const sub of subagents) {
            const id = `subagent-${crypto.randomUUID()}`;
            this.registerSubagent(id, sub.TypeName, sub.Role);

            // Spawn the subagent execution in the background as a Promise
            const promise = (async () => {
                try {
                    // Dynamically import to avoid circular dependency at load time
                    const { interactiveDeveloperAgent } = await import('../agents/developer-agent.js');
                    
                    const customType = this.customTypes.get(sub.TypeName);
                    let customContext = `[Subagent Context] ID: ${id}, Parent ID: ${parentId}, Role: ${sub.Role}\n`;
                    if (customType) {
                        customContext += `Custom Prompt: ${customType.systemPrompt}\n`;
                    }

                    const result = await interactiveDeveloperAgent({
                        taskId: id,
                        taskInstruction: sub.Prompt,
                        context: customContext,
                        auto: true
                    });

                    this.terminateSubagent(id, result.success);
                } catch (error) {
                    console.error(`Subagent ${id} failed:`, error);
                    this.terminateSubagent(id, false);
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
