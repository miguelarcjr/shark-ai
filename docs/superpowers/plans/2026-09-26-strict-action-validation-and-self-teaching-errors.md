# Strict Action Validation & Self-Teaching Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement strict action envelope validation, eliminate silent parser fallbacks, and generate self-teaching error messages with automatic tool describe for native and MCP tools.

**Architecture:** A dedicated `ActionValidator` defines schemas and requirements for all core and MCP tools, validating parsed responses in `AgentResponseParser`. If an envelope or parameter violation occurs, it returns an educational `[SYSTEM ERROR]` with the tool's schema, parameters, and a valid JSON example. `TurnLoopRunner` ensures that any `isError` or `[SYSTEM ERROR]` message automatically feeds back to the model as a prompt to retry, preventing premature task termination in batch/headless mode.

**Tech Stack:** TypeScript, Node.js, Zod, Vitest.

## Global Constraints

- Strict envelope contract: `{ "thought": string, "action": { "type": string, "args": Record<string, any> }, "summary": string }`.
- Never silently auto-heal flat syntax (e.g. `{"action": "read_file", ...}`); always educate the model via `[SYSTEM ERROR]`.
- All validation error messages must start with `[SYSTEM ERROR]`, set `isSynthetic: true` and `isError: true`.
- Zero test regressions on existing test suites (`npx vitest run`).

---

### Task 1: ActionValidator Core Module & Unit Tests

**Files:**
- Create: `src/core/agents/action-validator.ts`
- Test: `tests/core/agents/action-validator.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ActionValidationResult {
      isValid: boolean;
      errorMessage?: string;
      candidateTool?: string;
  }

  export class ActionValidator {
      static validate(parsedObj: any, bridgeToolsManager?: any): ActionValidationResult;
      static getToolSchemaDescription(toolName: string, bridgeToolsManager?: any): string;
      static formatSelfTeachingError(toolName: string, reason: string, bridgeToolsManager?: any): string;
  }
  ```

- [ ] **Step 1: Write the failing tests for ActionValidator**

Create `tests/core/agents/action-validator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { ActionValidator } from '../../../src/core/agents/action-validator.js';

describe('ActionValidator', () => {
    it('should validate a correct uniform envelope', () => {
        const payload = {
            thought: 'Reading file...',
            action: {
                type: 'read_file',
                args: { path: 'src/index.ts' }
            },
            summary: 'Read file.'
        };
        const result = ActionValidator.validate(payload);
        expect(result.isValid).toBe(true);
    });

    it('should reject flat action format where action is a string', () => {
        const flatPayload = {
            action: 'read_file',
            path: 'src/routes/index.tsx',
            start_line: 0,
            end_line: 250
        };
        const result = ActionValidator.validate(flatPayload);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('[SYSTEM ERROR]');
        expect(result.errorMessage).toContain('Formato de envelope de ação inválido');
        expect(result.errorMessage).toContain('"type": "read_file"');
        expect(result.errorMessage).toContain('"path"');
    });

    it('should reject missing required parameters for native tools', () => {
        const invalidArgs = {
            thought: 'Reading...',
            action: {
                type: 'read_file',
                args: {}
            },
            summary: 'Reading'
        };
        const result = ActionValidator.validate(invalidArgs);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('[SYSTEM ERROR]');
        expect(result.errorMessage).toContain("Parâmetro obrigatório 'path' ausente");
    });

    it('should reject modify_file missing anchors and provide recovery guidance', () => {
        const invalidModify = {
            thought: 'Modifying...',
            action: {
                type: 'modify_file',
                args: { path: 'src/index.ts', content: 'new content' }
            },
            summary: 'Modifying'
        };
        const result = ActionValidator.validate(invalidModify);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('start_anchor');
        expect(result.errorMessage).toContain('end_anchor');
    });

    it('should embed MCP tool describe schema when validating MCP tools', () => {
        const mockBridgeToolsManager = {
            isBridgeTool: (name: string) => name === 'mcp_sqlite_query',
            executeToolDescribe: () => ({
                success: true,
                output: {
                    tools: {
                        mcp_sqlite_query: {
                            description: 'Execute SQL statement in SQLite',
                            parameters: {
                                type: 'object',
                                properties: { query: { type: 'string' } },
                                required: ['query']
                            }
                        }
                    }
                }
            })
        };

        const flatMcp = {
            action: 'mcp_sqlite_query',
            sql: 'SELECT 1'
        };
        const result = ActionValidator.validate(flatMcp, mockBridgeToolsManager);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('tool_call');
        expect(result.errorMessage).toContain('Execute SQL statement in SQLite');
        expect(result.errorMessage).toContain('"query"');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agents/action-validator.test.ts`
Expected: FAIL (module `action-validator.js` not found).

- [ ] **Step 3: Implement ActionValidator**

Create `src/core/agents/action-validator.ts`:
```typescript
export interface ActionValidationResult {
    isValid: boolean;
    errorMessage?: string;
    candidateTool?: string;
}

export interface NativeToolDefinition {
    description: string;
    required: string[];
    optional?: string[];
    exampleArgs: Record<string, any>;
    recoveryHint?: string;
}

export const NATIVE_TOOLS_REGISTRY: Record<string, NativeToolDefinition> = {
    read_file: {
        description: 'Lê o conteúdo de um arquivo em disco com marcadores de linha e âncoras.',
        required: ['path'],
        exampleArgs: { path: 'src/routes/index.tsx' }
    },
    modify_file: {
        description: 'Substitui um trecho do arquivo identificado por âncoras exatas de início e fim.',
        required: ['path', 'start_anchor', 'end_anchor', 'content'],
        exampleArgs: {
            path: 'src/components/Header.tsx',
            start_anchor: 'anchor_start_word',
            end_anchor: 'anchor_end_word',
            content: 'export function Header() { return <div>Updated</div>; }'
        },
        recoveryHint: 'Se você ainda não inspecionou o arquivo, execute read_file primeiro para obter as palavras-âncora.'
    },
    create_file: {
        description: 'Cria ou sobrescreve completamente um arquivo no caminho especificado.',
        required: ['path', 'content'],
        exampleArgs: { path: 'src/utils/helpers.ts', content: 'export const sum = (a: number, b: number) => a + b;' }
    },
    delete_file: {
        description: 'Remove um arquivo do sistema de arquivos.',
        required: ['path'],
        exampleArgs: { path: 'temp/cache.json' }
    },
    list_files: {
        description: 'Lista arquivos e diretórios recursivamente a partir do caminho informado.',
        required: [],
        optional: ['path'],
        exampleArgs: { path: '.' }
    },
    search_code: {
        description: 'Busca por texto exato ou regex no código-fonte.',
        required: ['query'],
        optional: ['path', 'is_regex'],
        exampleArgs: { query: 'function authenticate', path: 'src/' }
    },
    search_file: {
        description: 'Busca arquivos pelo nome no repositório.',
        required: ['query'],
        optional: ['path'],
        exampleArgs: { query: 'package.json' }
    },
    run_command: {
        description: 'Executa um comando no terminal do sistema operacional.',
        required: ['command'],
        exampleArgs: { command: 'npm test' }
    },
    process: {
        description: 'Gerencia subprocessos assíncronos e interativos.',
        required: ['action'],
        optional: ['process_id', 'data', 'lines', 'offset'],
        exampleArgs: { action: 'list' }
    },
    send_file: {
        description: 'Envia um arquivo ou mídia para o usuário.',
        required: ['path'],
        optional: ['caption'],
        exampleArgs: { path: 'reports/summary.pdf', caption: 'Relatório final' }
    },
    tool_search: {
        description: 'Pesquisa ferramentas MCP no catálogo ativo usando busca léxica BM25.',
        required: ['queries'],
        optional: ['limit'],
        exampleArgs: { queries: ['database query'] }
    },
    tool_describe: {
        description: 'Obtém o schema JSON e descrição detalhada de ferramentas MCP sob demanda.',
        required: ['names'],
        exampleArgs: { names: ['mcp_sqlite_query'] }
    },
    tool_call: {
        description: 'Executa uma ferramenta MCP com seus respectivos argumentos.',
        required: ['name'],
        optional: ['arguments'],
        exampleArgs: { name: 'mcp_sqlite_query', arguments: { query: 'SELECT 1;' } }
    },
    skills_list: {
        description: 'Lista todas as habilidades instaladas no repositório.',
        required: [],
        optional: ['query'],
        exampleArgs: {}
    },
    skill_view: {
        description: 'Visualiza as instruções de uma habilidade específica.',
        required: ['name'],
        optional: ['file_path'],
        exampleArgs: { name: 'brainstorming' }
    },
    talk_with_user: {
        description: 'Envia uma mensagem direta de conversa ou pergunta para o usuário humano.',
        required: ['content'],
        exampleArgs: { content: 'Olá! Como posso ajudar você hoje?' }
    },
    complete_task: {
        description: 'Conclui a tarefa atual com o resumo e detalhes do trabalho realizado.',
        required: [],
        optional: ['summary', 'content'],
        exampleArgs: { summary: 'Tarefa finalizada com sucesso.', content: 'Todos os testes foram executados e passaram.' }
    }
};

export class ActionValidator {
    static validate(parsedObj: any, bridgeToolsManager?: any): ActionValidationResult {
        if (!parsedObj || typeof parsedObj !== 'object') {
            return {
                isValid: false,
                errorMessage: ActionValidator.formatEnvelopeError('A resposta não é um objeto JSON válido.', undefined, bridgeToolsManager)
            };
        }

        // Detect flat action representation e.g. { "action": "read_file", ... }
        if (typeof parsedObj.action === 'string') {
            const toolName = parsedObj.action.trim();
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatEnvelopeError(
                    `Você enviou uma chamada plana com "action": "${toolName}". Todas as ações DEVEM seguir o envelope padrão com bloco 'action' contendo 'type' e 'args'.`,
                    toolName,
                    bridgeToolsManager
                )
            };
        }

        // Detect root-level action e.g. { "type": "read_file", "path": "..." } without action envelope
        if (!parsedObj.action && typeof parsedObj.type === 'string') {
            const toolName = parsedObj.type.trim();
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatEnvelopeError(
                    `Você enviou a propriedade "type": "${toolName}" na raiz. Todas as ações DEVEM estar aninhadas no objeto "action": { "type": "...", "args": { ... } }.`,
                    toolName,
                    bridgeToolsManager
                )
            };
        }

        const action = parsedObj.action;
        if (!action || typeof action !== 'object' || typeof action.type !== 'string' || !action.type.trim()) {
            return {
                isValid: false,
                errorMessage: ActionValidator.formatEnvelopeError(
                    `Nenhum bloco 'action' válido fornecido na resposta. Você deve especificar obrigatoriamente { "thought": "...", "action": { "type": "...", "args": { ... } }, "summary": "..." }.`,
                    undefined,
                    bridgeToolsManager
                )
            };
        }

        const toolName = action.type.trim();
        const args = (action.args && typeof action.args === 'object') ? action.args : (action.arguments && typeof action.arguments === 'object' ? action.arguments : {});

        // Check if native tool
        const nativeDef = NATIVE_TOOLS_REGISTRY[toolName];
        if (nativeDef) {
            for (const reqField of nativeDef.required) {
                const val = args[reqField] ?? action[reqField];
                if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
                    return {
                        isValid: false,
                        candidateTool: toolName,
                        errorMessage: ActionValidator.formatParameterError(toolName, `Parâmetro obrigatório '${reqField}' ausente ou vazio em 'args'.`, nativeDef)
                    };
                }
            }
            return { isValid: true, candidateTool: toolName };
        }

        // Check if MCP tool called via tool_call
        if (toolName === 'tool_call') {
            const mcpName = args.name || action.name;
            if (!mcpName) {
                return {
                    isValid: false,
                    candidateTool: 'tool_call',
                    errorMessage: ActionValidator.formatParameterError('tool_call', "Parâmetro 'name' é obrigatório em 'tool_call'.", NATIVE_TOOLS_REGISTRY['tool_call'])
                };
            }
            return { isValid: true, candidateTool: 'tool_call' };
        }

        // Check if MCP tool called directly
        if (bridgeToolsManager && bridgeToolsManager.isBridgeTool(toolName)) {
            // Advise wrapping in tool_call or describe MCP tool schema
            const mcpDesc = ActionValidator.getMcpToolDescribe(toolName, bridgeToolsManager);
            return {
                isValid: false,
                candidateTool: toolName,
                errorMessage: ActionValidator.formatMcpDirectCallError(toolName, mcpDesc)
            };
        }

        // Tool unknown
        return {
            isValid: false,
            candidateTool: toolName,
            errorMessage: ActionValidator.formatUnknownToolError(toolName)
        };
    }

    private static getMcpToolDescribe(toolName: string, bridgeToolsManager: any): any {
        try {
            if (bridgeToolsManager?.executeToolDescribe) {
                const res = bridgeToolsManager.executeToolDescribe({ names: [toolName] });
                if (res?.success && res?.output?.tools?.[toolName]) {
                    return res.output.tools[toolName];
                }
            }
        } catch {}
        return null;
    }

    static formatEnvelopeError(reason: string, toolName?: string, bridgeToolsManager?: any): string {
        let toolSection = '';
        if (toolName) {
            if (NATIVE_TOOLS_REGISTRY[toolName]) {
                const def = NATIVE_TOOLS_REGISTRY[toolName];
                toolSection = `\n\n💡 SCHEMA DA FERRAMENTA '${toolName}':\nDescrição: ${def.description}\nParâmetros obrigatórios em 'args': ${JSON.stringify(def.required)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
                    thought: `Executando ${toolName}...`,
                    action: {
                        type: toolName,
                        args: def.exampleArgs
                    },
                    summary: `Chamando ${toolName}.`
                }, null, 2)}`;
            } else if (bridgeToolsManager && bridgeToolsManager.isBridgeTool(toolName)) {
                const mcpDesc = ActionValidator.getMcpToolDescribe(toolName, bridgeToolsManager);
                toolSection = `\n\n💡 SCHEMA DA FERRAMENTA MCP '${toolName}' (tool_describe automático):\n${JSON.stringify(mcpDesc || { name: toolName }, null, 2)}\n\n💡 EXEMPLO DE USO CORRETO VIA 'tool_call':\n${JSON.stringify({
                    thought: `Executando ferramenta MCP ${toolName}...`,
                    action: {
                        type: 'tool_call',
                        args: {
                            name: toolName,
                            arguments: {}
                        }
                    },
                    summary: `Chamando MCP ${toolName}.`
                }, null, 2)}`;
            }
        }

        return `[SYSTEM ERROR]: Formato de envelope de ação inválido.\nMotivo: ${reason}\n\n📋 ENVELOPE OBRIGATÓRIO:\n{\n  "thought": "Explicação detalhada do raciocínio...",\n  "action": {\n    "type": "nome_da_ferramenta",\n    "args": { /* parâmetros */ }\n  },\n  "summary": "Resumo de 1 frase."\n}${toolSection}`;
    }

    static formatParameterError(toolName: string, reason: string, def: NativeToolDefinition): string {
        const hint = def.recoveryHint ? `\n💡 DICA DE RECUPERAÇÃO:\n${def.recoveryHint}` : '';
        return `[SYSTEM ERROR]: Parâmetros inválidos para a ferramenta '${toolName}'.\nMotivo: ${reason}\n\nCampos obrigatórios em 'args': ${JSON.stringify(def.required)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
            thought: `Executando ${toolName}...`,
            action: {
                type: toolName,
                args: def.exampleArgs
            },
            summary: `Chamando ${toolName}.`
        }, null, 2)}${hint}`;
    }

    static formatMcpDirectCallError(toolName: string, mcpDesc: any): string {
        return `[SYSTEM ERROR]: A ferramenta '${toolName}' é uma extensão MCP e deve ser executada através do envelope 'tool_call'.\n\n💡 SCHEMA DA FERRAMENTA (tool_describe automático):\n${JSON.stringify(mcpDesc || { name: toolName }, null, 2)}\n\n💡 EXEMPLO DE USO CORRETO:\n${JSON.stringify({
            thought: `Executando ferramenta MCP ${toolName}...`,
            action: {
                type: 'tool_call',
                args: {
                    name: toolName,
                    arguments: {}
                }
            },
            summary: `Chamando ferramenta MCP ${toolName}.`
        }, null, 2)}`;
    }

    static formatUnknownToolError(toolName: string): string {
        const validTools = Object.keys(NATIVE_TOOLS_REGISTRY).join(', ');
        return `[SYSTEM ERROR]: Ação desconhecida '${toolName}'.\n\nFerramentas nativas disponíveis: [${validTools}].\n💡 DICA: Para ferramentas MCP adicionais, execute 'tool_search' com termos em linguagem natural para localizar o nome exato.`;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/agents/action-validator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/core/agents/action-validator.ts tests/core/agents/action-validator.test.ts
git commit -m "feat(agents): implement ActionValidator with self-teaching errors and automatic tool describe"
```

---

### Task 2: Integrate ActionValidator into AgentResponseParser

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Test: `tests/core/agents/agent-response-parser-self-teaching.test.ts`
- Test: `tests/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Consumes: `ActionValidator.validate` from Task 1.
- Produces: `parseAgentResponse(rawResponse, bridgeToolsManager)` returning validated `AgentResponse` with `isError: true` and educational `[SYSTEM ERROR]` on failure.

- [ ] **Step 1: Write test for parser integration with ActionValidator**

Add test in `tests/core/agents/agent-response-parser-self-teaching.test.ts`:
```typescript
it('deve rejeitar formato plano {"action": "read_file", ...} com [SYSTEM ERROR] e isError: true', () => {
    const raw = JSON.stringify({
        action: 'read_file',
        path: 'src/routes/index.tsx',
        start_line: 0,
        end_line: 250
    });

    const parsed = parseAgentResponse(raw);
    expect(parsed.isError).toBe(true);
    expect(parsed.action?.type).toBe('talk_with_user');
    expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
    expect(parsed.action?.content).toContain('Formato de envelope de ação inválido');
    expect(parsed.action?.content).toContain('"type": "read_file"');
});

it('deve manter o loop ativo sem retornar texto cru no fallback silencioso', () => {
    const raw = JSON.stringify({
        action: 'unknown_tool_xyz',
        foo: 'bar'
    });

    const parsed = parseAgentResponse(raw);
    expect(parsed.isError).toBe(true);
    expect(parsed.action?.type).toBe('talk_with_user');
    expect(parsed.action?.content).toContain('[SYSTEM ERROR]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/agents/agent-response-parser-self-teaching.test.ts`
Expected: FAIL (still falls back to non-error `talk_with_user` or misses `[SYSTEM ERROR]`).

- [ ] **Step 3: Update `src/core/agents/agent-response-parser.ts`**

In `src/core/agents/agent-response-parser.ts`:
1. Import `ActionValidator`.
2. Accept optional `bridgeToolsManager` in `parseAgentResponse(rawResponse: unknown, bridgeToolsManager?: any)`.
3. After parsing JSON into `parsedObj`:
   - Run `ActionValidator.validate(parsedObj, bridgeToolsManager)`.
   - If invalid:
     ```typescript
     const errorMsg = validationResult.errorMessage!;
     return {
         thought: parsedObj.thought || '',
         action: {
             type: 'talk_with_user',
             content: errorMsg,
             path: '',
             isSynthetic: true
         },
         actions: [{
             type: 'talk_with_user',
             content: errorMsg,
             path: '',
             isSynthetic: true
         }],
         summary: 'Action validation failed (Self-Teaching Error)',
         isError: true,
         errorMessage: errorMsg
     };
     ```
4. Remove the silent fallback block in lines 387–397 that previously returned raw content without `[SYSTEM ERROR]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/agents/agent-response-parser-self-teaching.test.ts`
Expected: PASS.

- [ ] **Step 5: Run existing parser tests to ensure zero regressions**

Run: `npx vitest run tests/core/agents/agent-response-parser.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```bash
git add src/core/agents/agent-response-parser.ts tests/core/agents/agent-response-parser-self-teaching.test.ts
git commit -m "feat(parser): integrate ActionValidator and eliminate silent fallback in parseAgentResponse"
```

---

### Task 3: TurnLoopRunner Resilience for Self-Teaching Errors

**Files:**
- Modify: `src/core/engine/turn-loop-runner.ts:371-420`
- Test: `tests/core/engine/turn-loop-runner.test.ts` (or add targeted test)

**Interfaces:**
- Consumes: `response.isError` and `talkContent.startsWith('[SYSTEM ERROR]')`.
- Guarantees: TurnLoopRunner feeds the error message back into `currentPrompt` and executes `continue;` regardless of batch/headless mode.

- [ ] **Step 1: Write test for TurnLoopRunner error retry**

Verify or create test in `tests/core/engine/turn-loop-runner-error-recovery.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { TurnLoopRunner } from '../../../src/core/engine/turn-loop-runner.js';

describe('TurnLoopRunner Self-Teaching Error Recovery', () => {
    it('should retry when response has isError: true without terminating batch mode', async () => {
        // Verify that isError: true causes loop continuation rather than break
    });
});
```

- [ ] **Step 2: Update `turn-loop-runner.ts`**

In `src/core/engine/turn-loop-runner.ts`, around line 371:
```typescript
            // talk_with_user action
            if (action.type === 'talk_with_user') {
                const talkContent = action.content || action.args?.content || action.message || action.args?.message || '';
                const isSystemError = (typeof talkContent === 'string' && talkContent.startsWith('[SYSTEM ERROR]')) ||
                                      response?.isError === true;
                if (isSystemError) {
                    currentPrompt = talkContent || response?.errorMessage || '[SYSTEM ERROR]: Invalid action structure.';
                    continue;
                }
                ...
```
Also pass `this.bridgeToolsManager` to `parseAgentResponse` wherever relevant or keep it accessible.

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run tests/core/agents/developer-agent.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

Run:
```bash
git add src/core/engine/turn-loop-runner.ts
git commit -m "fix(engine): ensure TurnLoopRunner retries on response.isError in talk_with_user"
```

---

### Task 4: End-to-End Regression Verification

**Files:**
- Run full test suite across the project.

- [ ] **Step 1: Run all core test suites**

Run: `npx vitest run`
Expected: All suites PASS.

- [ ] **Step 2: Commit any cleanups**

Run:
```bash
git status
```
Verify working tree is clean.
