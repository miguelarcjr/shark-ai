import fs from 'node:fs';
import path from 'node:path';

export class FileLogger {
    private static logPath = path.resolve(process.cwd(), 'shark-debug.log');
    private static enabled = true; // Enabled by default for this debugging session

    static init() {
        try {
            fs.writeFileSync(this.logPath, `--- Shark CLI Debug Log Started at ${new Date().toISOString()} ---\n`);
        } catch (e) {
            console.error('Failed to initialize debug log:', e);
        }
    }

    static log(category: string, message: string, data?: any) {
        if (!this.enabled) return;

        try {
            const timestamp = new Date().toISOString();
            let logEntry = `[${timestamp}] [${category.toUpperCase()}] ${message}\n`;
            if (data !== undefined) {
                if (typeof data === 'object') {
                    logEntry += JSON.stringify(data, null, 2) + '\n';
                } else {
                    logEntry += String(data) + '\n';
                }
            }
            logEntry += '-'.repeat(40) + '\n';

            fs.appendFileSync(this.logPath, logEntry);
        } catch (e) {
            // calculated risk: silence logging errors to not break app
        }
    }
}
