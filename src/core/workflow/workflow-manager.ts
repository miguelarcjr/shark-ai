import fs from 'fs/promises';
import path from 'path';
import { WorkflowSchema, type WorkflowState } from './shark-workflow.schema.js';
import { colors } from '../../ui/colors.js';

export class WorkflowManager {
    private static instance: WorkflowManager;
    private readonly filename = 'shark-workflow.json';
    private readonly tmpFilename = '.shark-workflow.tmp';

    private constructor() { }

    public static getInstance(): WorkflowManager {
        if (!WorkflowManager.instance) {
            WorkflowManager.instance = new WorkflowManager();
        }
        return WorkflowManager.instance;
    }

    private getFilePath(): string {
        return path.join(process.cwd(), this.filename);
    }

    private getTmpFilePath(): string {
        return path.join(process.cwd(), this.tmpFilename);
    }

    public async save(state: WorkflowState): Promise<void> {
        // 1. Validate State
        const parsed = WorkflowSchema.safeParse(state);
        if (!parsed.success) {
            throw new Error(`Invalid workflow state: ${parsed.error.message}`);
        }

        const filePath = this.getFilePath();
        const tmpPath = this.getTmpFilePath();
        const data = JSON.stringify(parsed.data, null, 2);

        try {
            // 2. Write to TMP
            await fs.writeFile(tmpPath, data, 'utf-8');

            // 3. Rename TMP to Final (Atomic with retry for Windows locks)
            let renamed = false;
            for (let attempt = 0; attempt < 5; attempt++) {
                try {
                    await fs.rename(tmpPath, filePath);
                    renamed = true;
                    break;
                } catch (err: any) {
                    if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempt < 4) {
                        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
                        continue;
                    }
                    if (attempt === 4) {
                        // Fallback copy if rename fails due to persistent Windows file handle locks
                        await fs.copyFile(tmpPath, filePath);
                        await fs.unlink(tmpPath).catch(() => {});
                        renamed = true;
                        break;
                    }
                    throw err;
                }
            }
        } catch (error: any) {
            throw new Error(`Failed to save workflow state atomically: ${error.message}`);
        }
    }

    public async load(): Promise<WorkflowState | null> {
        const filePath = this.getFilePath();

        try {
            // Check if file exists
            try {
                await fs.access(filePath);
            } catch {
                return null; // File doesn't exist, generic start
            }

            const content = await fs.readFile(filePath, 'utf-8');
            const json = JSON.parse(content);

            const parsed = WorkflowSchema.safeParse(json);
            if (parsed.success) {
                return parsed.data;
            } else {
                console.warn(colors.warning(`⚠️  Corrupted workflow file detected: ${parsed.error.message}`));
                return null;
            }

        } catch (error: any) {
            console.warn(colors.warning(`⚠️  Failed to load workflow state: ${error.message}`));
            return null;
        }
    }

    // Helper to get current state or default if none exists
    public async getOrInitState(): Promise<WorkflowState | null> {
        return await this.load();
    }
}

export const workflowManager = WorkflowManager.getInstance();
