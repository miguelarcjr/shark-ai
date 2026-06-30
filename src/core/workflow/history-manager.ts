import fs from 'node:fs';
import path from 'node:path';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class HistoryManager {
    private static getHistoryDir(): string {
        const dir = path.resolve(process.cwd(), '_sharkrc', 'history');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    private static getFilePath(conversationId: string): string {
        return path.resolve(this.getHistoryDir(), `${conversationId}.json`);
    }

    static async getHistory(conversationId: string): Promise<ChatMessage[]> {
        const filePath = this.getFilePath(conversationId);
        if (!fs.existsSync(filePath)) {
            return [];
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as ChatMessage[]) : [];
        } catch {
            return [];
        }
    }

    static async saveHistory(conversationId: string, messages: ChatMessage[]): Promise<void> {
        const filePath = this.getFilePath(conversationId);
        fs.writeFileSync(filePath, JSON.stringify(messages, null, 2), 'utf-8');
    }

    static async appendMessage(conversationId: string, message: ChatMessage): Promise<void> {
        const history = await this.getHistory(conversationId);
        history.push(message);
        await this.saveHistory(conversationId, history);
    }

    static getRawHistoryPath(conversationId: string): string {
        return this.getFilePath(conversationId);
    }

    static async getRawHistory(conversationId: string): Promise<ChatMessage[]> {
        return this.getHistory(conversationId);
    }

    static async saveRawHistory(conversationId: string, history: ChatMessage[]): Promise<void> {
        await this.saveHistory(conversationId, history);
    }
}
