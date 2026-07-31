# Shark Config CLI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `shark config` CLI command into a clean, category-based interactive menu, remove obsolete configuration options (`validation`, legacy agent roles), update default values (`useServerConversation: false`, `compactionTokenLimit: 120000`), and preserve existing values via `initialValue`.

**Architecture:** Update `ConfigSchema` defaults and remove dead schema fields, update hardcoded token fallbacks across 4 core files to `120000`, add localized strings for PT-BR, EN-US, and ES-ES, and rewrite `src/commands/config.ts` into structured sub-menus using `@clack/prompts`.

**Tech Stack:** TypeScript, `@clack/prompts` (via `tui`), Zod, Vitest.

## Global Constraints

- **Compaction Token Limit Default:** `120000` (all fallbacks updated from 8000).
- **Server Conversation Default:** `false`.
- **Value Preservation:** Every text/select input must pre-populate `initialValue` with the current config value so pressing Enter keeps the current value.
- **Strict Typing:** No implicit `any` where typed interfaces are available.

---

### Task 1: Schema Defaults & Fallback Cleanup

**Files:**
- Modify: `src/core/config/schema.ts`
- Modify: `src/core/api/stackspot-provider.ts:118`
- Modify: `src/core/api/openai-compatible-provider.ts:137`
- Modify: `src/core/workflow/membox-manager.ts:350`
- Modify: `src/core/agents/developer-agent.ts:507`

**Interfaces:**
- Consumes: Zod schema definitions
- Produces: `ConfigSchema` with `compactionTokenLimit: 120000` and `useServerConversation: false`

- [ ] **Step 1: Update `ConfigSchema` in `src/core/config/schema.ts`**

Update `ConfigSchema` to set default `compactionTokenLimit` to `120000` and `useServerConversation` to `false`. Remove unused `project` and `environment` fields.

```ts
import { z } from 'zod';

export const ConfigSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    provider: z.enum(['stackspot', 'openai-compatible']).default('stackspot'),
    embeddings: z.object({
        provider: z.enum(['local', 'openai-compatible']).default('local'),
        model: z.string().default('all-MiniLM-L6-v2'),
    }).default({}),
    stackspot: z.object({
        agentId: z.string().default('01KEQCGJ65YENRA4QBXVN1YFFX'),
        subagentId: z.string().optional(),
        useServerConversation: z.boolean().default(false),
    }).optional().default({}),
    'openai-compatible': z.object({
        baseURL: z.string().default('http://localhost:11434/v1'),
        apiKey: z.string().default('ollama'),
        model: z.string().default('llama3'),
        useStructuredOutputs: z.boolean().default(true)
    }).optional().default({}),
    preferredStack: z.array(z.string()).default([]),
    memory: z.object({
        compactionTokenLimit: z.number().default(120000),
        enabled: z.boolean().default(false),
    }).default({}),
    apiBaseUrl: z.string().optional(),
    language: z.enum(['pt-br', 'en-us', 'es-es']).default('pt-br'),
    activeRealm: z.string().optional(),
    agents: z.object({
        dev: z.string().optional(),
        subagent: z.string().optional(),
    }).default({}),
    agentVersions: z.object({
        dev: z.string().optional(),
        subagent: z.string().optional(),
    }).default({})
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 2: Update fallbacks across providers and managers**

Replace `?? 8000` with `?? 120000` in:
- `src/core/api/stackspot-provider.ts`
- `src/core/api/openai-compatible-provider.ts`
- `src/core/workflow/membox-manager.ts`
- `src/core/agents/developer-agent.ts`

- [ ] **Step 3: Run schema and manager tests**

Run: `npx vitest run src/core/config-manager.test.ts`
Expected: PASS

- [ ] **Step 4: Commit Task 1 changes**

```bash
git add src/core/config/schema.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts src/core/workflow/membox-manager.ts src/core/agents/developer-agent.ts
git commit -m "refactor(config): update default compaction limit to 120k and useServerConversation to false"
```

---

### Task 2: i18n Localization Strings

**Files:**
- Modify: `src/core/i18n/locales/pt-br.json`
- Modify: `src/core/i18n/locales/en-us.json`
- Modify: `src/core/i18n/locales/es-es.json`

**Interfaces:**
- Consumes: i18n translation key paths under `commands.config`
- Produces: Localized strings for PT-BR, EN-US, ES-ES

- [ ] **Step 1: Add new config keys to `pt-br.json`**

Update `commands.config` section in `src/core/i18n/locales/pt-br.json`:

```json
"config": {
  "title": "Configurações do Shark AI",
  "selectAction": "O que você deseja configurar?",
  "actions": {
    "provider": "🤖 Provedor de LLM (StackSpot / OpenAI-compatible)",
    "memory": "🧠 Memória & Embeddings",
    "general": "⚙️ Preferências Gerais (Idioma, Log, API Base)",
    "agents": "🆔 Agentes StackSpot (IDs & Versões)",
    "back": "🚪 Sair"
  },
  "providerMenu": {
    "title": "Configurações de LLM",
    "selectProvider": "Selecione o provedor ativo:",
    "stackspot": "StackSpot AI",
    "openai": "OpenAI-compatible (Ollama / LMStudio)",
    "configureStackspot": "Configurar Credenciais StackSpot",
    "configureOpenai": "Configurar OpenAI-compatible",
    "baseUrl": "Base URL da API OpenAI-compatible:",
    "apiKey": "API Key:",
    "model": "Nome do Modelo:",
    "structuredOutputs": "Usar Structured Outputs:"
  },
  "memoryMenu": {
    "title": "Configurações de Memória & Embeddings",
    "tokenLimit": "Limite de tokens para compactação automática:",
    "semanticMemory": "Memória Semântica:",
    "embeddingsProvider": "Provedor de Embeddings:",
    "embeddingsModel": "Modelo de Embeddings:"
  },
  "generalMenu": {
    "title": "Preferências Gerais",
    "language": "Idioma do Sistema:",
    "logLevel": "Nível de Log:",
    "apiBaseUrl": "URL Base da API StackSpot:"
  },
  "agentMenu": {
    "title": "Agentes StackSpot",
    "devId": "ID do Agente Dev (Principal):",
    "devVersion": "Versão do Agente Dev:",
    "subagentId": "ID do Subagente Executor:",
    "subagentVersion": "Versão do Subagente Executor:",
    "serverConversation": "Conversa no Servidor (Server Conversation):"
  }
}
```

- [ ] **Step 2: Add corresponding keys to `en-us.json` and `es-es.json`**

Update `commands.config` in `en-us.json` and `es-es.json` with English and Spanish translations.

- [ ] **Step 3: Commit Task 2 changes**

```bash
git add src/core/i18n/locales/
git commit -m "feat(i18n): add localized strings for redesigned config menus"
```

---

### Task 3: Refactor `shark config` Command

**Files:**
- Modify: `src/commands/config.ts`

**Interfaces:**
- Consumes: `ConfigManager`, `saveGlobalRC`, `tui`
- Produces: `configCommand.action()` with category sub-menus and preserved values

- [ ] **Step 1: Rewrite `src/commands/config.ts`**

Replace `src/commands/config.ts` implementation with the redesigned category menu system:

```ts
import { tui } from '../ui/tui.js';
import { colors } from '../ui/colors.js';
import { ConfigManager } from '../core/config-manager.js';
import { saveGlobalRC } from '../core/config/sharkrc-loader.js';
import { t } from '../core/i18n/index.js';

export const configCommand = {
    action: async () => {
        tui.intro(t('commands.config.title'));

        const manager = ConfigManager.getInstance();

        while (true) {
            const currentConfig = manager.getConfig();

            // Display status header
            tui.log.info(colors.dim('Current Configuration:'));
            tui.log.message(`• Provider: ${colors.primary(currentConfig.provider || 'stackspot')}`);
            tui.log.message(`• Language: ${colors.primary(currentConfig.language)}`);
            tui.log.message(`• Log Level: ${colors.primary(currentConfig.logLevel)}`);
            tui.log.message(`• Compaction Limit: ${colors.primary(String(currentConfig.memory?.compactionTokenLimit ?? 120000))}`);
            tui.log.message(`• Semantic Memory: ${colors.primary(currentConfig.memory?.enabled ? 'Enabled' : 'Disabled')}`);

            const action = await tui.select({
                message: t('commands.config.selectAction'),
                options: [
                    { value: 'provider', label: t('commands.config.actions.provider') },
                    { value: 'memory', label: t('commands.config.actions.memory') },
                    { value: 'general', label: t('commands.config.actions.general') },
                    { value: 'agents', label: t('commands.config.actions.agents') },
                    { value: 'exit', label: t('commands.config.actions.back') }
                ]
            });

            if (tui.isCancel(action) || action === 'exit') {
                tui.outro('Configuration completed.');
                return;
            }

            try {
                if (action === 'provider') {
                    const subAction = await tui.select({
                        message: 'Select LLM Provider Option:',
                        options: [
                            { value: 'switch', label: 'Switch Active Provider (stackspot / openai-compatible)' },
                            { value: 'stackspot', label: 'Configure StackSpot Settings' },
                            { value: 'openai', label: 'Configure OpenAI-Compatible / Ollama Settings' },
                            { value: 'back', label: 'Back' }
                        ]
                    });

                    if (tui.isCancel(subAction) || subAction === 'back') continue;

                    if (subAction === 'switch') {
                        const newProvider = await tui.select({
                            message: 'Active Provider:',
                            options: [
                                { value: 'stackspot', label: 'StackSpot AI' },
                                { value: 'openai-compatible', label: 'OpenAI-Compatible (Ollama / LMStudio)' }
                            ],
                            initialValue: currentConfig.provider
                        });
                        if (!tui.isCancel(newProvider)) {
                            saveGlobalRC({ provider: newProvider as any });
                            tui.log.success(`Updated active provider to: ${newProvider}`);
                        }
                    } else if (subAction === 'openai') {
                        const openAiConfig = currentConfig['openai-compatible'] || {};
                        const baseURL = await tui.text({
                            message: 'Base URL:',
                            initialValue: openAiConfig.baseURL || 'http://localhost:11434/v1'
                        });
                        if (tui.isCancel(baseURL)) continue;

                        const model = await tui.text({
                            message: 'Model Name:',
                            initialValue: openAiConfig.model || 'llama3'
                        });
                        if (tui.isCancel(model)) continue;

                        const apiKey = await tui.text({
                            message: 'API Key:',
                            initialValue: openAiConfig.apiKey || 'ollama'
                        });
                        if (tui.isCancel(apiKey)) continue;

                        saveGlobalRC({
                            'openai-compatible': {
                                ...openAiConfig,
                                baseURL: baseURL as string,
                                model: model as string,
                                apiKey: apiKey as string
                            }
                        } as any);
                        tui.log.success('Updated OpenAI-compatible settings');
                    }
                } else if (action === 'memory') {
                    const subAction = await tui.select({
                        message: 'Memory & Embeddings Settings:',
                        options: [
                            { value: 'tokenLimit', label: 'Set Compaction Token Limit' },
                            { value: 'semanticToggle', label: 'Enable/Disable Semantic Memory' },
                            { value: 'back', label: 'Back' }
                        ]
                    });

                    if (tui.isCancel(subAction) || subAction === 'back') continue;

                    if (subAction === 'tokenLimit') {
                        const limitStr = await tui.text({
                            message: 'Maximum token limit for automatic compaction:',
                            initialValue: String(currentConfig.memory?.compactionTokenLimit ?? 120000),
                            placeholder: 'e.g., 120000'
                        });

                        if (!tui.isCancel(limitStr)) {
                            const limitNum = parseInt(limitStr.trim(), 10);
                            if (isNaN(limitNum) || limitNum <= 0) {
                                tui.log.error('Invalid token limit. Must be a positive number.');
                            } else {
                                saveGlobalRC({ memory: { ...currentConfig.memory, compactionTokenLimit: limitNum } as any });
                                tui.log.success(`Updated compaction token limit to: ${limitNum}`);
                            }
                        }
                    } else if (subAction === 'semanticToggle') {
                        const enabled = await tui.select({
                            message: 'Semantic Memory:',
                            options: [
                                { value: 'true', label: 'Enabled' },
                                { value: 'false', label: 'Disabled' }
                            ],
                            initialValue: currentConfig.memory?.enabled ? 'true' : 'false'
                        });
                        if (!tui.isCancel(enabled)) {
                            saveGlobalRC({ memory: { ...currentConfig.memory, enabled: enabled === 'true' } as any });
                            tui.log.success(`Semantic Memory: ${enabled === 'true' ? 'ENABLED' : 'DISABLED'}`);
                        }
                    }
                } else if (action === 'general') {
                    const subAction = await tui.select({
                        message: 'General Preferences:',
                        options: [
                            { value: 'language', label: 'Language' },
                            { value: 'logLevel', label: 'Log Level' },
                            { value: 'apiBaseUrl', label: 'API Base URL' },
                            { value: 'back', label: 'Back' }
                        ]
                    });

                    if (tui.isCancel(subAction) || subAction === 'back') continue;

                    if (subAction === 'language') {
                        const lang = await tui.select({
                            message: 'Select language:',
                            options: [
                                { value: 'pt-br', label: 'Português (Brasil)' },
                                { value: 'en-us', label: 'English (US)' },
                                { value: 'es-es', label: 'Español' }
                            ],
                            initialValue: currentConfig.language
                        });
                        if (!tui.isCancel(lang)) {
                            saveGlobalRC({ language: lang as any });
                            tui.log.success(`Language updated to: ${lang}`);
                        }
                    } else if (subAction === 'logLevel') {
                        const level = await tui.select({
                            message: 'Select log level:',
                            options: [
                                { value: 'debug', label: 'Debug (Verbose)' },
                                { value: 'info', label: 'Info (Standard)' },
                                { value: 'warn', label: 'Warn (Important only)' },
                                { value: 'error', label: 'Error (Critical only)' }
                            ],
                            initialValue: currentConfig.logLevel
                        });
                        if (!tui.isCancel(level)) {
                            saveGlobalRC({ logLevel: level as any });
                            tui.log.success(`Updated log level to: ${level}`);
                        }
                    } else if (subAction === 'apiBaseUrl') {
                        const baseUrl = await tui.text({
                            message: 'Custom StackSpot API Base URL:',
                            initialValue: currentConfig.apiBaseUrl || ''
                        });
                        if (!tui.isCancel(baseUrl)) {
                            saveGlobalRC({ apiBaseUrl: baseUrl as string });
                            tui.log.success(`Updated API Base URL`);
                        }
                    }
                } else if (action === 'agents') {
                    const devId = await tui.text({
                        message: 'Dev Agent ID:',
                        initialValue: currentConfig.agents?.dev || currentConfig.stackspot?.agentId || '01KEQCGJ65YENRA4QBXVN1YFFX'
                    });
                    if (tui.isCancel(devId)) continue;

                    const devVer = await tui.text({
                        message: 'Dev Agent Version:',
                        initialValue: currentConfig.agentVersions?.dev || '1'
                    });
                    if (tui.isCancel(devVer)) continue;

                    const subId = await tui.text({
                        message: 'Subagent Executor ID:',
                        initialValue: currentConfig.agents?.subagent || currentConfig.stackspot?.subagentId || ''
                    });
                    if (tui.isCancel(subId)) continue;

                    const subVer = await tui.text({
                        message: 'Subagent Executor Version:',
                        initialValue: currentConfig.agentVersions?.subagent || '1'
                    });
                    if (tui.isCancel(subVer)) continue;

                    const serverConv = await tui.select({
                        message: 'Use Server Conversation:',
                        options: [
                            { value: 'false', label: 'Disabled (Default / Recommended)' },
                            { value: 'true', label: 'Enabled' }
                        ],
                        initialValue: currentConfig.stackspot?.useServerConversation ? 'true' : 'false'
                    });
                    if (tui.isCancel(serverConv)) continue;

                    saveGlobalRC({
                        agents: { dev: devId as string, subagent: subId as string },
                        agentVersions: { dev: devVer as string, subagent: subVer as string },
                        stackspot: {
                            ...currentConfig.stackspot,
                            agentId: devId as string,
                            subagentId: subId as string,
                            useServerConversation: serverConv === 'true'
                        }
                    } as any);
                    tui.log.success('Updated StackSpot Agent settings');
                }

                manager.reloadConfig();
            } catch (error: any) {
                tui.log.error(`Failed to save configuration: ${error.message}`);
                return;
            }
        }
    }
};
```

- [ ] **Step 2: Commit Task 3 changes**

```bash
git add src/commands/config.ts
git commit -m "feat(cli): rewrite shark config command with categorized sub-menus"
```

---

### Task 4: Update Unit Tests & Verification

**Files:**
- Modify: `src/commands/config.test.ts`

**Interfaces:**
- Consumes: `configCommand`
- Produces: Passing unit tests for redesigned `shark config` command

- [ ] **Step 1: Update `src/commands/config.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configCommand } from './config.js';
import { tui } from '../ui/tui.js';
import { ConfigManager } from '../core/config-manager.js';
import { saveGlobalRC } from '../core/config/sharkrc-loader.js';

vi.mock('../ui/tui.js');
vi.mock('../core/config-manager.js');
vi.mock('../core/config/sharkrc-loader.js');

describe('Config Command', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(tui.isCancel).mockReturnValue(false);
        vi.mocked(ConfigManager.getInstance).mockReturnValue({
            getConfig: () => ({
                provider: 'stackspot',
                language: 'pt-br',
                logLevel: 'info',
                memory: { compactionTokenLimit: 120000, enabled: false },
                stackspot: { agentId: '01KEQCGJ65YENRA4QBXVN1YFFX', useServerConversation: false }
            }),
            reloadConfig: vi.fn(),
        } as any);
    });

    it('should exit when user selects exit option', async () => {
        vi.mocked(tui.select).mockResolvedValueOnce('exit' as any);

        await configCommand.action();

        expect(tui.outro).toHaveBeenCalledWith('Configuration completed.');
        expect(saveGlobalRC).not.toHaveBeenCalled();
    });

    it('should update language under general category', async () => {
        vi.mocked(tui.select)
            .mockResolvedValueOnce('general' as any)
            .mockResolvedValueOnce('language' as any)
            .mockResolvedValueOnce('en-us' as any)
            .mockResolvedValueOnce('exit' as any);

        await configCommand.action();

        expect(saveGlobalRC).toHaveBeenCalledWith({ language: 'en-us' });
    });

    it('should update compaction token limit under memory category', async () => {
        vi.mocked(tui.select)
            .mockResolvedValueOnce('memory' as any)
            .mockResolvedValueOnce('tokenLimit' as any)
            .mockResolvedValueOnce('exit' as any);
        vi.mocked(tui.text).mockResolvedValueOnce('150000');

        await configCommand.action();

        expect(saveGlobalRC).toHaveBeenCalledWith({ memory: expect.objectContaining({ compactionTokenLimit: 150000 }) });
    });
});
```

- [ ] **Step 2: Run all tests to verify**

Run: `npx vitest run src/commands/config.test.ts`
Expected: PASS

- [ ] **Step 3: Run full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with zero errors

- [ ] **Step 4: Commit Task 4 changes**

```bash
git add src/commands/config.test.ts
git commit -m "test(cli): update unit tests for redesigned config command"
```
