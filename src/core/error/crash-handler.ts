import fs from 'fs';
import path from 'path';
import os from 'os';
import { colors } from '../../ui/colors.js';

export class CrashHandler {
    private static instance: CrashHandler;
    private readonly logDir: string;

    private constructor() {
        this.logDir = path.join(os.homedir(), '.shark', 'logs');
    }

    public static getInstance(): CrashHandler {
        if (!CrashHandler.instance) {
            CrashHandler.instance = new CrashHandler();
        }
        return CrashHandler.instance;
    }

    public init(): void {
        process.on('uncaughtException', (error) => this.handleError(error, 'Uncaught Exception'));
        process.on('unhandledRejection', (reason) => this.handleError(reason, 'Unhandled Rejection'));
    }

    private handleError(error: any, type: string): void {
        // Prevent infinite loops if logging fails
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFile = path.join(this.logDir, `crash-${timestamp}.log`);

            const errorMessage = error instanceof Error ? error.message : String(error);
            const stackTrace = error instanceof Error ? error.stack : 'No stack trace available';

            const logContent = `
[${new Date().toISOString()}] ${type}
--------------------------------------------------
Message: ${errorMessage}
Stack:
${stackTrace}
--------------------------------------------------
System: ${os.platform()} ${os.release()} ${os.arch()}
Node: ${process.version}
`;

            // Ensure directory exists sync (we are crashing, async might not finish)
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }

            fs.writeFileSync(logFile, logContent, 'utf-8');

            console.error('\n');
            console.error(colors.error('💥  Whoops! Shark CLI crashed unexpectedly.'));
            console.error(colors.dim(`   Details have been saved to: ${logFile}`));
            console.error(colors.dim('   Please report this issue so we can fix it.'));
            console.error(colors.error(`   Error: ${errorMessage}`));
            console.error('\n');

        } catch (filesysError) {
            console.error('Fatal Error: Failed to write crash log.', filesysError);
            console.error('Original Error:', error);
        } finally {
            process.exit(1);
        }
    }
}

export const crashHandler = CrashHandler.getInstance();
