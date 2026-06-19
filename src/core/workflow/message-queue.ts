export interface QueueMessage {
    type: 'user' | 'subagent_notification';
    content: string;
    timestamp: number;
    metadata?: {
        subagentId?: string;
        role?: string;
        status?: 'completed' | 'failed';
    };
}

export class MessageQueue {
    private queue: QueueMessage[] = [];
    private pendingResolve: ((value: QueueMessage) => void) | null = null;

    public push(message: QueueMessage): void {
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            resolve(message);
        } else {
            this.queue.push(message);
        }
    }

    public async next(): Promise<QueueMessage> {
        if (this.queue.length > 0) {
            return this.queue.shift()!;
        }
        return new Promise<QueueMessage>((resolve) => {
            this.pendingResolve = resolve;
        });
    }

    public isEmpty(): boolean {
        return this.queue.length === 0;
    }
}
