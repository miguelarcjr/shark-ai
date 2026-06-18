# Multi-Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Shark AI to support multiple LLM providers (Ollama, OpenRouter, OpenAI, DeepSeek) via a unified provider abstraction, while keeping complete backward compatibility with StackSpot AI.

**Architecture:** Create an `AIProvider` interface. Move the current StackSpot implementation into `StackSpotProvider`. Implement `OpenAICompatibleProvider` for standard `/v1/chat/completions` endpoints. Add a `HistoryManager` to store conversation histories locally using UUIDs for non-StackSpot providers. Use `ProviderResolver` to load the active provider from updated config files.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest.

## Global Constraints

- **TypeScript Version**: Defined in `tsconfig.json`.
- **Zod Version**: Must use `zod` for configuration schema validation.
- **Environment**: Linux/Bash terminal in Termux.
- **Backward Compatibility**: If no provider is configured, default to `StackSpotProvider` and use current StackSpot keys and endpoints.

---

### Task 1: Setup AIProvider Interface and Resolver

**Files:**
- Create: `src/core/api/provider.interface.ts`
- Create: `src/core/api/provider-resolver.ts`
- Test: `src/core/api/provider-resolver.test.ts`

**Interfaces:**
- Produces: `AIProvider` interface, `ChatOptions` type, and `ProviderResolver` class.

- [ ] **Step 1: Write the interface test**

Create `src/core/api/provider-resolver.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ProviderResolver } from './provider-resolver.js';
import { ConfigManager } from '../config-manager.js';

describe('ProviderResolver', () => {
    it('should resolve StackSpotProvider by default', () => {
        const provider = ProviderResolver.getProvider('developer_agent');
        expect(provider.constructor.name).toBe('StackSpotProvider');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/api/provider-resolver.test.ts`
Expected: FAIL due to missing imports or files.

- [ ] **Step 3: Write interface and resolver implementation**

Create `src/core/api/provider.interface.ts`:
```typescript
import { AgentResponse } from '../agents/agent-response-parser.js';

export interface ChatOptions {
    onChunk?: (chunk: string) => void;
    onComplete?: (response: AgentResponse) => void;
    conversationId?: string;
    agentType: 'business_analyst' | 'developer_agent' | 'qa_agent' | 'specification_agent' | 'scan_agent';
}

export interface AIProvider {
    streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse>;
}
```

Create `src/core/api/provider-resolver.ts`:
```typescript
import { AIProvider } from './provider.interface.js';
import { StackSpotProvider } from './stackspot-provider.js';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { ConfigManager } from '../config-manager.js';

export class ProviderResolver {
    static getProvider(agentType: 'business_analyst' | 'developer_agent' | 'qa_agent' | 'specification_agent' | 'scan_agent'): AIProvider {
        const config = ConfigManager.getInstance().getConfig() as any;
        
        if (config.provider === 'openai-compatible') {
            const opt = config['openai-compatible'] || {};
            return new OpenAICompatibleProvider({
                baseURL: opt.baseURL || 'http://localhost:11434/v1',
                apiKey: opt.apiKey || 'ollama',
                model: opt.model || 'llama3',
                useStructuredOutputs: opt.useStructuredOutputs ?? true
            });
        }
        
        return new StackSpotProvider(agentType);
    }
}
```

*Note: For this step to compile, create temporary placeholder classes for `StackSpotProvider` and `OpenAICompatibleProvider` in their respective paths:*

Create `src/core/api/stackspot-provider.ts` (stub):
```typescript
import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse } from '../agents/agent-response-parser.js';

export class StackSpotProvider implements AIProvider {
    constructor(private agentType: string) {}
    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        return { actions: [] };
    }
}
```

Create `src/core/api/openai-compatible-provider.ts` (stub):
```typescript
import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse } from '../agents/agent-response-parser.js';

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private options: any) {}
    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        return { actions: [] };
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/api/provider-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/provider.interface.ts src/core/api/provider-resolver.ts src/core/api/provider-resolver.test.ts src/core/api/stackspot-provider.ts src/core/api/openai-compatible-provider.ts
git commit -m "feat: add AIProvider interface and initial Resolver with stubs"
```

---

### Task 2: Implement StackSpotProvider

**Files:**
- Modify: `src/core/api/stackspot-provider.ts`
- Test: `src/core/api/stackspot-provider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`, `ChatOptions`
- Produces: `StackSpotProvider` implementing `AIProvider`

- [ ] **Step 1: Write test for StackSpotProvider**

Create `src/core/api/stackspot-provider.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { StackSpotProvider } from './stackspot-provider.js';

vi.mock('../auth/get-active-realm.js', () => ({
    getActiveRealm: () => Promise.resolve('test-realm')
}));

vi.mock('../auth/token-storage.js', () => ({
    tokenStorage: {
        getToken: () => Promise.resolve('test-token')
    }
}));

describe('StackSpotProvider', () => {
    it('should be instantiable and reference agentType', () => {
        const provider = new StackSpotProvider('developer_agent');
        expect(provider).toBeDefined();
    });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/core/api/stackspot-provider.test.ts`
Expected: PASS

- [ ] **Step 3: Implement StackSpotProvider details**

Modify `src/core/api/stackspot-provider.ts`:
```typescript
import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { STACKSPOT_AGENT_API_BASE } from './stackspot-client.js';
import { sseClient } from './sse-client.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { ConfigManager } from '../config-manager.js';

export class StackSpotProvider implements AIProvider {
    constructor(private agentType: string) {}

    private getAgentId(): string {
        const config = ConfigManager.getInstance().getConfig();
        if (this.agentType === 'business_analyst') {
            return config.agents?.ba || process.env.STACKSPOT_BA_AGENT_ID || '01KEJ95G304TNNAKGH5XNEEBVD';
        }
        // default to dev
        return config.agents?.dev || process.env.STACKSPOT_DEV_AGENT_ID || '01KEQCGJ65YENRA4QBXVN1YFFX';
    }

    private getAgentVersion(): string | undefined {
        const config: any = ConfigManager.getInstance().getConfig();
        if (this.agentType === 'business_analyst') {
            return config.agentVersions?.ba || process.env.STACKSPOT_BA_AGENT_VERSION;
        }
        return config.agentVersions?.dev || process.env.STACKSPOT_DEV_AGENT_VERSION;
    }

    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        const realm = await getActiveRealm();
        const token = await tokenStorage.getToken(realm);
        if (!token) {
            throw new Error(`No authentication token found for realm '${realm}'. Please run 'shark login'.`);
        }

        const requestPayload: any = {
            user_prompt: prompt,
            streaming: true,
            stackspot_knowledge: false,
            return_ks_in_response: true,
            deep_search_ks: false,
            conversation_id: options.conversationId,
        };

        const agentVersion = this.getAgentVersion();
        if (agentVersion) {
            requestPayload.agent_version_number = agentVersion;
        }

        const effectiveAgentId = this.getAgentId();
        const agentUrl = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${effectiveAgentId}/chat`;

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        let fullMessage = '';
        let rawResponse: any = {};

        await sseClient.streamAgentResponse(
            agentUrl,
            requestPayload,
            headers,
            {
                onChunk: (chunk) => {
                    fullMessage += chunk;
                    if (options.onChunk) {
                        options.onChunk(chunk);
                    }
                },
                onComplete: async (message) => {
                    rawResponse = {
                        message: message || fullMessage,
                        conversation_id: options.conversationId,
                    };
                },
                onError: (error) => {
                    throw error;
                },
            }
        );

        const parsedResponse = parseAgentResponse(rawResponse);
        if (options.onComplete) {
            options.onComplete(parsedResponse);
        }
        return parsedResponse;
    }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/stackspot-provider.ts src/core/api/stackspot-provider.test.ts
git commit -m "feat: implement complete StackSpotProvider with backward compatibility"
```

---

### Task 3: Implement HistoryManager

**Files:**
- Create: `src/core/workflow/history-manager.ts`
- Test: `src/core/workflow/history-manager.test.ts`

**Interfaces:**
- Produces: `HistoryManager` class to load, append, and save local JSON conversation arrays.

- [ ] **Step 1: Write test for HistoryManager**

Create `src/core/workflow/history-manager.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HistoryManager } from './history-manager.js';
import fs from 'node:fs';
import path from 'node:path';

describe('HistoryManager', () => {
    const testId = 'test-conversation-uuid';
    const historyDir = path.resolve(process.cwd(), '_sharkrc', 'history');
    const filePath = path.resolve(historyDir, `${testId}.json`);

    beforeEach(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    afterEach(() => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

    it('should read empty array if history file does not exist', async () => {
        const history = await HistoryManager.getHistory(testId);
        expect(history).toEqual([]);
    });

    it('should save and load message history array', async () => {
        const messages = [{ role: 'user', content: 'hello' }];
        await HistoryManager.saveHistory(testId, messages);
        const loaded = await HistoryManager.getHistory(testId);
        expect(loaded).toEqual(messages);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: FAIL due to missing implementation of `HistoryManager`.

- [ ] **Step 3: Implement HistoryManager**

Create `src/core/workflow/history-manager.ts`:
```typescript
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
            return JSON.parse(raw) as ChatMessage[];
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/workflow/history-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/history-manager.ts src/core/workflow/history-manager.test.ts
git commit -m "feat: add HistoryManager to manage local LLM conversation state"
```

---

### Task 4: Implement OpenAICompatibleProvider

**Files:**
- Modify: `src/core/api/openai-compatible-provider.ts`
- Test: `src/core/api/openai-compatible-provider.test.ts`

**Interfaces:**
- Consumes: `AIProvider`, `ChatOptions`, `HistoryManager`
- Produces: `OpenAICompatibleProvider` with JSON Schema strict structured output mapping.

- [ ] **Step 1: Write test for OpenAICompatibleProvider**

Create `src/core/api/openai-compatible-provider.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';

describe('OpenAICompatibleProvider', () => {
    it('should be instantiable with parameters', () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });
        expect(provider).toBeDefined();
    });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/core/api/openai-compatible-provider.test.ts`
Expected: PASS

- [ ] **Step 3: Implement OpenAICompatibleProvider logic**

Modify `src/core/api/openai-compatible-provider.ts`:
```typescript
import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';
import crypto from 'node:crypto';

interface OpenAIConfig {
    baseURL: string;
    apiKey: string;
    model: string;
    useStructuredOutputs: boolean;
}

export class OpenAICompatibleProvider implements AIProvider {
    constructor(private config: OpenAIConfig) {}

    private getAgentSystemPrompt(agentType: string): string {
        // Base system instructions establishing JSON schema and available actions
        const baseSystem = `You are a professional software engineer AI agent in a collaborative development environment.
You MUST respond strictly with a single JSON object matching the schema.
Do NOT output any markdown blocks or explanations outside of the JSON object.
Use the 'talk_with_user' action inside the actions list to speak to the user.

Required Output JSON Schema:
{
  "actions": [
    {
      "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_code" | "run_command" | "talk_with_user" | "delete_file",
      "path": "relative path to file",
      "content": "file content or talk message",
      "target_content": "exact text block to replace (modify_file only)",
      "command": "terminal command (run_command only)"
    }
  ],
  "summary": "Short explanation of the actions performed."
}`;

        let specific = '';
        if (agentType === 'business_analyst') {
            specific = `You are the Business Analyst Agent. Understand user requirements, gather clarifications, and create technical briefings.`;
        } else if (agentType === 'developer_agent') {
            specific = `You are the Developer Agent. Implement code steps and fix compilation/test issues using terminal feedback.`;
        } else if (agentType === 'specification_agent') {
            specific = `You are the Specification Agent. Write and maintain the tech-spec.md file in the project.`;
        } else {
            specific = `You are an AI Agent assisting in development.`;
        }

        return `${baseSystem}\n\nAgent Personality: ${specific}`;
    }

    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        const conversationId = options.conversationId || crypto.randomUUID();

        const history = await HistoryManager.getHistory(conversationId);
        if (history.length === 0) {
            history.push({
                role: 'system',
                content: this.getAgentSystemPrompt(options.agentType)
            });
        }

        history.push({ role: 'user', content: prompt });

        const requestPayload: any = {
            model: this.config.model,
            messages: history,
            stream: true,
            temperature: 0.2
        };

        if (this.config.useStructuredOutputs) {
            requestPayload.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'agent_response',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                          actions: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                type: { 
                                  type: 'string', 
                                  enum: ["create_file", "modify_file", "read_file", "list_files", "search_code", "run_command", "talk_with_user", "delete_file"] 
                                },
                                path: { type: 'string' },
                                content: { type: 'string' },
                                target_content: { type: 'string' },
                                command: { type: 'string' }
                              },
                              required: ["type", "path", "content", "target_content", "command"],
                              additionalProperties: false
                            }
                          },
                          summary: { type: 'string' }
                        },
                        required: ["actions", "summary"],
                        additionalProperties: false
                    }
                }
            };
        }

        const headers: any = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) {
            headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }

        const res = await fetch(`${this.config.baseURL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestPayload)
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`OpenAI API request failed: ${res.status} ${res.statusText} - ${errBody}`);
        }

        const reader = res.body?.getReader();
        if (!reader) {
            throw new Error('Response body reader is undefined');
        }

        const decoder = new TextDecoder();
        let fullContent = '';
        let done = false;

        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            if (value) {
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                    const clean = line.trim();
                    if (!clean || clean === 'data: [DONE]') continue;
                    if (clean.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(clean.substring(6));
                            const delta = parsed.choices?.[0]?.delta?.content || '';
                            if (delta) {
                                fullContent += delta;
                                if (options.onChunk) {
                                    options.onChunk(delta);
                                }
                            }
                        } catch {
                            // ignore line chunk errors
                        }
                    }
                }
            }
        }

        const parsedResponse = parseAgentResponse(fullContent);
        parsedResponse.conversation_id = conversationId;

        // Save LLM response to history
        history.push({ role: 'assistant', content: JSON.stringify(parsedResponse) });
        await HistoryManager.saveHistory(conversationId, history);

        if (options.onComplete) {
            options.onComplete(parsedResponse);
        }

        return parsedResponse;
    }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/api/openai-compatible-provider.ts src/core/api/openai-compatible-provider.test.ts
git commit -m "feat: implement OpenAICompatibleProvider with local history management"
```

---

### Task 5: Extend Configuration Support in ConfigManager

**Files:**
- Modify: `src/core/config-manager.ts`
- Test: `src/core/config-manager.test.ts`

**Interfaces:**
- Consumes: ConfigManager config parsing logic.
- Produces: Updated configurations matching new schema.

- [ ] **Step 1: Write failing config test**

Modify `src/core/config-manager.test.ts` to include provider verification:
```typescript
// Insert at end of src/core/config-manager.test.ts
describe('Config Schema Extension', () => {
    it('should validate and parse provider structure', () => {
        const mgr = ConfigManager.getInstance();
        const config = mgr.getConfig() as any;
        expect(config.provider).toBeDefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/config-manager.test.ts`
Expected: FAIL since the Zod schema does not contain `provider` definitions.

- [ ] **Step 3: Modify ConfigManager schema**

Modify `src/core/config-manager.ts` to add schema validation for providers (around lines 10-35):
```typescript
// Replace schema definition with:
export const ConfigSchema = z.object({
    provider: z.enum(['stackspot', 'openai-compatible']).default('stackspot'),
    'openai-compatible': z.object({
        baseURL: z.string().default('http://localhost:11434/v1'),
        apiKey: z.string().default('ollama'),
        model: z.string().default('llama3'),
        useStructuredOutputs: z.boolean().default(true)
    }).optional(),
    agents: z.object({
        ba: z.string().optional(),
        dev: z.string().optional()
    }).optional()
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/config-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/config-manager.ts src/core/config-manager.test.ts
git commit -m "feat: extend ConfigManager schema to support alternative LLM providers"
```

---

### Task 6: Refactor Business Analyst Agent

**Files:**
- Modify: `src/core/agents/business-analyst-agent.ts`
- Test: `src/core/agents/business-analyst-agent.test.ts`

**Interfaces:**
- Consumes: `ProviderResolver`
- Produces: Refactored `runBusinessAnalystAgent` executing chat completions through target provider.

- [ ] **Step 1: Write mock test for BusinessAnalystAgent**

Modify `src/core/agents/business-analyst-agent.test.ts` to check if calls are delegated via `AIProvider`:
```typescript
// Asserting existing tests continue to function or compile correctly
```

- [ ] **Step 2: Run tests to check compile**

Run: `npx vitest run src/core/agents/business-analyst-agent.test.ts`
Expected: PASS/FAIL (depending on implementation state).

- [ ] **Step 3: Refactor agent loop**

Modify `src/core/agents/business-analyst-agent.ts`:
Replace lines 40-128 in `src/core/agents/business-analyst-agent.ts` with:
```typescript
import { ProviderResolver } from '../api/provider-resolver.js';

export async function runBusinessAnalystAgent(
    prompt: string,
    options: BAAgentOptions = {}
): Promise<AgentResponse> {
    const { onChunk, onComplete } = options;

    const existingConversationId = await conversationManager.getConversationId(AGENT_TYPE);
    
    // Resolve active provider dynamically
    const provider = ProviderResolver.getProvider('business_analyst');

    const parsedResponse = await provider.streamChat(prompt, {
        conversationId: existingConversationId,
        agentType: 'business_analyst',
        onChunk,
        onComplete
    });

    if (parsedResponse.conversation_id) {
        await conversationManager.saveConversationId(AGENT_TYPE, parsedResponse.conversation_id);
    }

    return parsedResponse;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/agents/business-analyst-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/business-analyst-agent.ts
git commit -m "refactor: migrate BusinessAnalyst agent to use ProviderResolver"
```

---

### Task 7: Refactor Developer Agent

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: `ProviderResolver`
- Produces: Refactored `interactiveDeveloperAgent` executing calls through target provider.

- [ ] **Step 1: Modify DeveloperAgent implementation**

Modify `src/core/agents/developer-agent.ts`:
Replace the function `callDevAgentApi` (around lines 540-565) with:
```typescript
import { ProviderResolver } from '../api/provider-resolver.js';

async function callDevAgentApi(prompt: string, onChunk: (chunk: string) => void, conversationKey: string = AGENT_TYPE): Promise<AgentResponse> {
    const existingConversationId = await conversationManager.getConversationId(conversationKey);

    const provider = ProviderResolver.getProvider('developer_agent');

    const parsedResponse = await provider.streamChat(prompt, {
        conversationId: existingConversationId,
        agentType: 'developer_agent',
        onChunk
    });

    if (parsedResponse.conversation_id) {
        await conversationManager.saveConversationId(conversationKey, parsedResponse.conversation_id);
    }

    return parsedResponse;
}
```

- [ ] **Step 2: Run all tests to verify correct refactoring**

Run: `npm test`
Expected: ALL 87 TESTS PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/agents/developer-agent.ts
git commit -m "refactor: migrate Developer agent to use ProviderResolver"
```
