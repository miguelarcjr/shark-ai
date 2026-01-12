import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';
import { colors } from '../../ui/colors.js';

// Reusing schema definition implicitly or we could export it from config-manager
// For now, let's define a partial schema for RC files
export const SharkRCFileSchema = z.object({
    project: z.string().optional(),
    environment: z.string().optional(),
    logLevel: z.string().optional(),
    language: z.string().optional(),
    preferredStack: z.array(z.string()).optional(),
    // Add other keys as needed from the main config
}).passthrough(); // Allow extra keys for forward compatibility

export type SharkRC = z.infer<typeof SharkRCFileSchema>;

function loadFile(filePath: string): SharkRC {
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);
        const result = SharkRCFileSchema.safeParse(json);

        if (result.success) {
            return result.data;
        } else {
            console.warn(colors.warning(`⚠️  Invalid config in ${filePath}: ${result.error.message}`));
            return {};
        }
    } catch (error: any) {
        console.warn(colors.warning(`⚠️  Failed to read ${filePath}: ${error.message}`));
        return {};
    }
}

export function loadSharkRC(): SharkRC {
    const homeDir = os.homedir();
    const currentDir = process.cwd();

    const globalPath = path.join(homeDir, '.sharkrc');
    const localPath = path.join(currentDir, '.sharkrc');

    const globalConfig = loadFile(globalPath);
    const localConfig = loadFile(localPath);

    // Local overrides Global
    return {
        ...globalConfig,
        ...localConfig
    };
}

export function saveGlobalRC(configUpdates: Partial<SharkRC>): void {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.sharkrc');

    const currentConfig = loadFile(globalPath);
    const newConfig = { ...currentConfig, ...configUpdates };

    try {
        fs.writeFileSync(globalPath, JSON.stringify(newConfig, null, 2), 'utf-8');
    } catch (error: any) {
        throw new Error(`Failed to save global config to ${globalPath}: ${error.message}`);
    }
}
