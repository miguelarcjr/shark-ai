import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from './config-manager.js';
import { ConfigSchema } from './config/schema.js';
import fs from 'fs';
import os from 'os';

vi.mock('fs');
vi.mock('os');

describe('ConfigManager', () => {

    beforeEach(() => {
        vi.resetAllMocks();
        (ConfigManager as any).instance = null;
        process.env = {};

        // Default mocks
        vi.mocked(os.homedir).mockReturnValue('/home/test');
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readFileSync).mockReturnValue('{}');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should load default config when no files or envs exist', () => {
        const config = ConfigManager.getInstance().getConfig();
        expect(config.logLevel).toBe('info');
        expect(config.language).toBe('pt-br');
    });

    it('should prioritized ENV vars over defaults', () => {
        process.env.SHARK_LOG_LEVEL = 'debug';

        const config = ConfigManager.getInstance().getConfig();
        expect(config.logLevel).toBe('debug');
    });

    describe('LLM Provider Configuration', () => {
        it('should parse stackspot configuration with agentId', () => {
            const config = ConfigSchema.parse({
                provider: 'stackspot',
                stackspot: {
                    agentId: '01KEQCGJ65YENRA4QBXVN1YFFX'
                }
            });
            expect(config.stackspot?.agentId).toBe('01KEQCGJ65YENRA4QBXVN1YFFX');
        });

        it('should include the default provider (stackspot) and leave openai-compatible undefined', () => {
            const config = ConfigManager.getInstance().getConfig();
            expect(config.provider).toBe('stackspot');
            expect(config['openai-compatible']).toBeUndefined();
        });

        it('should parse provider settings from .sharkrc correctly', () => {
            const customConfig = {
                provider: 'openai-compatible',
                'openai-compatible': {
                    baseURL: 'https://custom-api.com/v1',
                    apiKey: 'custom-key',
                    model: 'custom-model',
                    useStructuredOutputs: false
                }
            };

            vi.mocked(fs.existsSync).mockImplementation((filePath) => {
                return filePath.toString().endsWith('.sharkrc');
            });
            vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
                if (filePath.toString().endsWith('.sharkrc')) {
                    return JSON.stringify(customConfig);
                }
                return '{}';
            });

            const config = ConfigManager.getInstance().getConfig();
            expect(config.provider).toBe('openai-compatible');
            expect(config['openai-compatible']).toEqual({
                baseURL: 'https://custom-api.com/v1',
                apiKey: 'custom-key',
                model: 'custom-model',
                useStructuredOutputs: false
            });
        });

        it('should fill in defaults for openai-compatible when partial settings are provided', () => {
            const customConfig = {
                provider: 'openai-compatible',
                'openai-compatible': {
                    model: 'custom-model'
                }
            };

            vi.mocked(fs.existsSync).mockImplementation((filePath) => {
                return filePath.toString().endsWith('.sharkrc');
            });
            vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
                if (filePath.toString().endsWith('.sharkrc')) {
                    return JSON.stringify(customConfig);
                }
                return '{}';
            });

            const config = ConfigManager.getInstance().getConfig();
            expect(config.provider).toBe('openai-compatible');
            expect(config['openai-compatible']).toEqual({
                baseURL: 'http://localhost:11434/v1',
                apiKey: 'ollama',
                model: 'custom-model',
                useStructuredOutputs: true
            });
        });
    });
});

