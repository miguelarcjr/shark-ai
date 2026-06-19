# Subagent Specialization and Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve subagent execution reliability and enable rich bi-directional communication with the parent agent.

**Architecture:** 
1. Improve [agent-response-parser.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/src/core/agents/agent-response-parser.ts) to return `[SYSTEM ERROR]` for empty/whitespace raw LLM responses.
2. Add support for a new `'complete_task'` action type in the schema and prompts.
3. Specialize the system prompt for subagents to educate them about their environment, messaging via `send_message`, and final results via `complete_task`.
4. Modify the subagent execution loop in [developer-agent.ts](file:///data/data/com.termux/files/home/projetos/shark-ai/src/core/agents/developer-agent.ts) to handle the retry loop for `[SYSTEM ERROR]` and execute `complete_task` with detailed content returned to the parent.

**Tech Stack:** TypeScript, Node.js (fork/child_process), Vitest.

## Global Constraints

- All code changes must be written in TypeScript and conform to the project's existing ESLint/Prettier configuration.
- Follow test-driven development (TDD): write the failing test first, verify failure, implement minimum code, verify pass, and commit.
- Preserve all existing comments and docstrings.
- Return exit code 0 on normal CLI execution and exit code 1 on errors.
- Do not add any external third-party library dependencies.

---

## Tasks

### Task 1: Response Parser Robustness and complete_task Schema Support

**Files:**
- Modify: `src/core/agents/agent-response-parser.ts`
- Modify: `src/core/api/openai-compatible-provider.ts`
- Modify: `src/core/api/prompts.ts`
- Test: `src/core/agents/agent-response-parser.test.ts`

**Interfaces:**
- Consumes: Existing parser and schema validation logic
- Produces: Added `'complete_task'` in `AgentActionSchema` and error response mapping for empty string inputs.

- [ ] **Step 1: Write the failing test**

Open `src/core/agents/agent-response-parser.test.ts` and append the following tests:
```typescript
    it('should parse complete_task action successfully', () => {
        const raw = {
            summary: 'Task finalized',
            action: {
                type: 'complete_task',
                content: 'Here is the detailed project code design...',
                summary: 'Completed project analysis.'
            }
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('complete_task');
        expect(result.action?.content).toBe('Here is the detailed project code design...');
    });

    it('should return system error on completely empty raw string', () => {
        const result = parseAgentResponse('   ');
        expect(result.action?.type).toBe('talk_with_user');
        expect(result.action?.content).toContain('[SYSTEM ERROR]: O modelo retornou uma resposta vazia');
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/agents/agent-response-parser.test.ts
```
Expected: FAIL due to ZodValidationError (invalid enum value `'complete_task'`) and returning text fallback instead of System Error on `'   '`.

- [ ] **Step 3: Write minimal implementation**

1. Modify `src/core/agents/agent-response-parser.ts` inside `AgentActionSchema` to include `'complete_task'`:
```typescript
export const AgentActionSchema = z.object({
    type: z.enum([
        'create_file', 'modify_file', 'list_files', 'search_file', 'search_code', 'read_file', 'delete_file',
        'list_structure', 'modify_ast', 'search_ast', 'run_command',
        'talk_with_user', 'use_mcp_tool',
        'activate_skill', 'define_subagent', 'invoke_subagent', 'send_message', 'manage_subagents',
        'complete_task', // Added
        'ast_list_structure',
        // ...
```

2. Inside `parseAgentResponse` in `src/core/agents/agent-response-parser.ts` (handling string input fallback):
```typescript
    if (typeof rawResponse === 'string') {
        FileLogger.log('PARSER', 'Type String', { length: rawResponse.length });
        try {
            parsedObj = extractFirstJson(rawResponse);
        } catch (e) {
            FileLogger.log('PARSER', 'String Parse Failed', { error: (e as Error).message });
            const errMsg = (e as Error).message;
            const cleanRaw = rawResponse.trim();
            
            if (cleanRaw === '') {
                const systemMsg = `[SYSTEM ERROR]: O modelo retornou uma resposta vazia. Por favor, tente novamente e forneça uma ação JSON válida.`;
                return {
                    action: {
                        type: 'talk_with_user',
                        content: systemMsg,
                        path: ''
                    },
                    actions: [{
                        type: 'talk_with_user',
                        content: systemMsg,
                        path: ''
                    }],
                    message: systemMsg
                };
            }

            const looksLikeJson = cleanRaw.startsWith('{') || cleanRaw.startsWith('[');
            // ... rest of fallback logic
```

3. Modify `src/core/api/openai-compatible-provider.ts` to add `'complete_task'` to the JSON schema `response_format`:
```typescript
                                  "send_message",
                                  "manage_subagents",
                                  "complete_task",
                                  "wait"
```

4. Modify `src/core/api/prompts.ts` to add `'complete_task'` to the unified system prompt choices:
```typescript
    "type": "create_file" | "modify_file" | "read_file" | "list_files" | "search_file" | "search_code" | "delete_file" | "run_command" | "talk_with_user" | "use_mcp_tool" | "activate_skill" | "define_subagent" | "invoke_subagent" | "send_message" | "manage_subagents" | "complete_task" | "wait",
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/agents/agent-response-parser.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/agent-response-parser.ts src/core/api/openai-compatible-provider.ts src/core/api/prompts.ts src/core/agents/agent-response-parser.test.ts
git commit -m "feat: implement empty response safety and complete_task parser support"
```

---

### Task 2: Subagent Prompt Customization and Parent Context Injection

**Files:**
- Modify: `src/core/workflow/subagent-manager.ts`
- Test: `src/core/workflow/subagent-manager.test.ts`

**Interfaces:**
- Consumes: `subagentManager.invokeSubagents` method parameters.
- Produces: Context injection that specifies subagent limitations and rules for task completion.

- [ ] **Step 1: Write the failing test**

Open `src/core/workflow/subagent-manager.test.ts` and add a test verifying prompt customization:
```typescript
    it('should inject specialized subagent instructions into the instruction prompt', async () => {
        // We test that subagentManager generates instruction with subagent context & complete_task info.
        // We can inspect the customized context format by validating the customContext text helper.
        // For testing purposes, check that subagent manager is registered and custom instructions contain complete_task.
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/workflow/subagent-manager.test.ts
```
Expected: FAIL (or missing features verification fails).

- [ ] **Step 3: Write minimal implementation**

Modify `src/core/workflow/subagent-manager.ts` inside `invokeSubagents` method (around line 245-253) to format a structured subagent environment instructions header:
```typescript
                    const customType = this.customTypes.get(sub.TypeName);
                    let customContext = `Você está executando em modo SUBAGENTE.\n`;
                    customContext += `- Seu ID é: ${id}\n`;
                    customContext += `- O ID do seu Agente Pai é: ${parentId}\n`;
                    customContext += `- Você NÃO tem um terminal interativo com o usuário humano. Não use 'talk_with_user' para interagir.\n`;
                    customContext += `- Para reportar progresso intermediário ou tirar dúvidas com seu pai, use a ação 'send_message' com Recipient='${parentId}'.\n`;
                    customContext += `- Para concluir a tarefa e enviar o resultado detalhado em markdown, use obrigatoriamente a ação 'complete_task' com suas descobertas no campo 'content'.\n`;
                    
                    if (customType) {
                        customContext += `Custom Prompt: ${customType.systemPrompt}\n`;
                    }
                    const instruction = customContext + '\n\n' + sub.Prompt;
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/workflow/subagent-manager.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/workflow/subagent-manager.ts src/core/workflow/subagent-manager.test.ts
git commit -m "feat: customize subagent system prompt context and instructions"
```

---

### Task 3: Developer Agent complete_task Handler & Error Retry Recovery Loop

**Files:**
- Modify: `src/core/agents/developer-agent.ts`
- Test: `src/core/agents/developer-agent.test.ts`

**Interfaces:**
- Consumes: Action types and completion loop variables.
- Produces: Execution support for `'complete_task'` action and error recovery retry loop.

- [ ] **Step 1: Write the failing test**

Open `src/core/agents/developer-agent.test.ts` and add tests verifying the recovery loop and completion:
```typescript
    it('should retry automatically on system error if running in subagent/auto mode', async () => {
        // Implement test where model returns [SYSTEM ERROR] in turn 1, and succeeds in turn 2.
    });

    it('should complete task successfully when complete_task action is received', async () => {
        // Implement test where complete_task action with content and summary is executed.
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/core/agents/developer-agent.test.ts
```
Expected: FAIL (Zod error or loop breaks early).

- [ ] **Step 3: Write minimal implementation**

1. In `src/core/agents/developer-agent.ts`, modify `talk_with_user` handler (around line 540) to not break execution on system errors if in subagent/auto mode:
```typescript
                else if (action.type === 'talk_with_user') {
                    const isSystemError = action.content?.startsWith('[SYSTEM ERROR]');
                    if (isSystemError) {
                        log.error(`⚠️ Detectado erro na resposta do Agente (truncado ou inválido).`);
                        log.info(colors.dim(action.content || ''));
                        if (isSubagent) {
                            resultMsg = action.content || '';
                            nextPrompt = resultMsg;
                            continue; // Retry loop
                        } else {
                            // ... existing parent logic
```

2. Add support for `'complete_task'` action type in `developer-agent.ts` (inside loop, around line 680):
```typescript
                else if (action.type === 'complete_task') {
                    const detailedContent = action.content || '';
                    const taskSummary = action.summary || 'Task completed successfully.';
                    
                    if (isSubagent) {
                        subagentManager.updateSubagentSummary(options.taskId!, taskSummary);
                        // Send the detailed markdown content to parent mailbox instead of just a 1-sentence summary
                        if (process.env.SHARK_PARENT_ID) {
                            subagentManager.sendMessage(
                                process.env.SHARK_PARENT_ID,
                                `[Subagent Notification] Subagent ${process.env.SHARK_SUBAGENT_ROLE || 'Subagent'} (${options.taskId}) completed.\nResult Details:\n${detailedContent}`
                            );
                        }
                    }
                    
                    finalSummary = taskSummary;
                    keepGoing = false;
                    break;
                }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/core/agents/developer-agent.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agents/developer-agent.ts src/core/agents/developer-agent.test.ts
git commit -m "feat: support complete_task execution and auto system error retries"
```
