export interface QueueMessage {
    type: 'user' | 'subagent_notification' | 'timeout';
    content: string;
    timestamp: number;
    metadata?: {
        subagentId?: string;
        role?: string;
        status?: 'completed' | 'failed' | 'cancelled';
    };
}

export class MessageQueue {
    private queue: QueueMessage[] = [];
    private pendingResolvers: ((value: QueueMessage) => void)[] = [];

    public push(message: QueueMessage): void {
        if (this.pendingResolvers.length > 0) {
            const resolve = this.pendingResolvers.shift()!;
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
            this.pendingResolvers.push(resolve);
        });
    }

    public isEmpty(): boolean {
        return this.queue.length === 0;
    }
}
