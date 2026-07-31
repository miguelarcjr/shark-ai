# Shark Config CLI Redesign Specification

**Date:** 2026-07-31  
**Status:** Approved  
**Target File(s):**
- `src/core/config/schema.ts`
- `src/commands/config.ts`
- `src/commands/config.test.ts`
- `src/core/api/stackspot-provider.ts`
- `src/core/api/openai-compatible-provider.ts`
- `src/core/workflow/membox-manager.ts`
- `src/core/agents/developer-agent.ts`
- `src/core/i18n/locales/pt-br.json`
- `src/core/i18n/locales/en-us.json`
- `src/core/i18n/locales/es-es.json`

---

## 1. Overview & Goals

The `shark config` command currently presents outdated and unused configuration options (such as `validation` code review rules and legacy agent roles like `ba`, `spec`, `qa`, `scan`, `codeReview`). Additionally, active settings like LLM Provider choice (`stackspot` vs `openai-compatible`), Ollama/LMStudio parameters, semantic memory toggles, and StackSpot Agent versions are either missing or fragmented.

This design completely refactors `shark config` into a clean, category-based interactive menu and updates schema defaults and fallbacks across the application.

### Key Decisions & Defaults:
- **Default `useServerConversation`**: `false`
- **Default `compactionTokenLimit`**: `120000` (updated across schema and all fallbacks from 8000)
- **Preserve Existing Values**: All text inputs use `initialValue` set to the current configuration, allowing users to press Enter to keep the existing value.

---

## 2. Architecture & Design Details

### 2.1 Schema Updates (`src/core/config/schema.ts`)
The Zod `ConfigSchema` will be updated to:
1. Retain active fields: `logLevel`, `provider`, `stackspot`, `openai-compatible`, `embeddings`, `memory`, `language`, `apiBaseUrl`, `activeRealm`, `agents`, `agentVersions`.
2. Update defaults:
   - `stackspot.useServerConversation`: `z.boolean().default(false)`
   - `memory.compactionTokenLimit`: `z.number().default(120000)`
3. Remove unreferenced/dead schema properties (`project`, `environment`).

### 2.2 Global Fallback Updates (120,000 Tokens)
All hardcoded fallback values for `compactionTokenLimit ?? 8000` across `stackspot-provider.ts`, `openai-compatible-provider.ts`, `membox-manager.ts`, and `developer-agent.ts` will be updated to `120000`.

### 2.3 CLI Menu Structure (`src/commands/config.ts`)

#### Status Summary Header
```text
Current Configuration:
• LLM Provider: <stackspot | openai-compatible>
• Active Agent / Model: <Agent ID or Model Name>
• Language: <pt-br | en-us | es-es>
• Log Level: <debug | info | warn | error>
• Compaction Token Limit: <limit>
• Semantic Memory: <Enabled | Disabled>
```

#### Category Navigation Menu
- 🤖 **Provedor de LLM (LLM Provider)**
  - Select active provider (`stackspot` / `openai-compatible`)
  - Configure StackSpot Settings (Agent ID, Subagent ID, Agent Versions, Server Conversation toggle)
  - Configure OpenAI-compatible / Ollama Settings (Base URL, API Key, Model Name, Structured Outputs toggle)
- 🧠 **Memória & Embeddings (Memory & Embeddings)**
  - Compaction Token Limit (`memory.compactionTokenLimit`)
  - Semantic Memory Enabled/Disabled (`memory.enabled`)
  - Embeddings Provider (`embeddings.provider`, `embeddings.model`)
- ⚙️ **Preferências Gerais (General Preferences)**
  - Language (`language`)
  - Log Level (`logLevel`)
  - API Base URL (`apiBaseUrl`)
- 🆔 **Agentes StackSpot (StackSpot Agent IDs & Versions)**
  - Main Dev Agent ID & Version
  - Subagent Executor ID & Version
  - Server Conversation toggle
- 🚪 **Sair (Exit)**

---

## 3. i18n & Test Updates

### 3.1 i18n Localization Files
Translations for pt-br, en-us, and es-es will be updated under `commands.config` to support all category titles, option labels, and prompt descriptions.

### 3.2 Automated Tests (`src/commands/config.test.ts`)
Vitest tests will be updated to verify:
- Navigation through main category menus and sub-menus.
- Correct updates to `~/.sharkrc` via `saveGlobalRC()`.
- Validations for numeric input (e.g. `compactionTokenLimit`).
- Cancelling input (`tui.isCancel`) preserves existing state.

---

## 4. Verification Plan

1. **Unit Tests**: Run `npx vitest src/commands/config.test.ts` to ensure all menu paths and config updates function properly.
2. **Type Safety & Build**: Run `npx tsc --noEmit` to verify zero TypeScript errors.
3. **Manual CLI Testing**: Test running `shark config` interactive prompts to verify navigation, saving settings, and pressing Enter to keep existing values.
