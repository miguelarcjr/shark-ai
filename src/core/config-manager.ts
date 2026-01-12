import os from 'os';
import path from 'path';
import fs from 'fs';
import { ConfigSchema, type Config } from './config/schema.js';
import { loadSharkRC } from './config/sharkrc-loader.js';

export class ConfigManager {
    private static instance: ConfigManager;
    private config: Config | null = null;

    private constructor() { }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    public getConfig(): Config {
        if (!this.config) {
            this.config = this.loadConfig();
        }
        return this.config;
    }

    public reloadConfig(): void {
        this.config = this.loadConfig();
    }

    private loadConfig(): Config {
        // 1. Defaults (via Zod)
        let mergedConfig: any = {};

        // 2 & 3. Global & Local Config (.sharkrc)
        // Handled by SharkRCLoader which encapsulates precedence (Local > Global)
        const rcConfig = loadSharkRC();
        mergedConfig = { ...mergedConfig, ...rcConfig };

        // 4. Env Vars (SHARK_*)
        const envConfig = this.loadEnvConfig();
        mergedConfig = { ...mergedConfig, ...envConfig };

        // 5. Validation & Defaults
        const parsed = ConfigSchema.safeParse(mergedConfig);
        if (!parsed.success) {
            console.warn('⚠️ Invalid configuration detected, falling back to defaults or partial config');
            console.warn(parsed.error.message);
            // In a stricter mode we might throw, but CLI should try to run
            // For now, let's return a default parse to ensure we have a valid object
            return ConfigSchema.parse({});
        }

        return parsed.data;
    }

    private readJsonFile(filePath: string): any {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(content);
            }
        } catch (error) {
            console.warn(`Failed to read config file at ${filePath}`, error);
        }
        return {};
    }


    public async set(key: string, value: any): Promise<void> {
        if (!this.config) {
            this.config = this.loadConfig();
        }
        (this.config as any)[key] = value;

        // Persist to .sharkrc in home directory
        const homeDir = os.homedir();
        const configPath = path.join(homeDir, '.sharkrc');

        try {
            let currentFileConfig = {};
            if (fs.existsSync(configPath)) {
                currentFileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            }
            const newConfig = { ...currentFileConfig, [key]: value };
            fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
        } catch (error) {
            console.error('Failed to save configuration:', error);
        }
    }

    private loadEnvConfig(): any {
        const config: any = {};

        if (process.env.SHARK_LOG_LEVEL) {
            config.logLevel = process.env.SHARK_LOG_LEVEL;
        }
        if (process.env.SHARK_API_BASE_URL) {
            config.apiBaseUrl = process.env.SHARK_API_BASE_URL;
        }
        if (process.env.SHARK_LANGUAGE) {
            config.language = process.env.SHARK_LANGUAGE;
        }

        // Stack is list, requires splitting
        if (process.env.SHARK_PREFERRED_STACK) {
            config.preferredStack = process.env.SHARK_PREFERRED_STACK.split(',').map(s => s.trim());
        }

        return config;
    }
}
