# Cronjob Subagent Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alinhar a execução de Cronjobs ao padrão robusto de Subagentes, utilizando streaming de logs de console para disco, IPC nativo e `--result-file` para extração de resposta limpa, injeção de `_CRON_HINT`, suporte a script pré-run e formatação com cabeçalho no WhatsApp.

**Architecture:** O `CronExecutor` isola o console do processo (`silent: true`) canalizando `stdout`/`stderr` via `.pipe()` diretamente para `.shark/cron/output/<jobId>-console.log`. A resposta final do agente é entregue limpa através do canal IPC nativo (`process.send({ type: 'cron_completion' })`) com fallback por `--result-file`, eliminando 100% de logs e códigos ANSI. O executor também injeta `_CRON_HINT` e o output de scripts pré-run no brief da tarefa, enquanto o `AgentEngine` formata a entrega no WhatsApp com o cabeçalho `[Cron: <nome>]` e suprime envios `[SILENT]`.

**Tech Stack:** Node.js (v20+ ChildProcess fork/pipe/IPC), TypeScript, Vitest, Commander.js.

## Global Constraints

- Preserve all existing interfaces and tests in `src/core/cron/` and `src/core/engine/`.
- Zero raw terminal stdout/stderr or ANSI escape sequences in delivery payloads.
- Strict `[SILENT]` suppression: if response is `[SILENT]`, no message is sent.
- Non-interactive execution in cron: no interactive user prompts or clarify tools.

---

### Task 1: Add `--result-file` Option to CLI Dev Command

**Files:**
- Modify: `src/commands/dev.ts:13-81`
- Test: `src/commands/dev.test.ts:90-120`

**Interfaces:**
- Consumes: `options.resultFile?: string` from CLI args.
- Produces: Writes atomic JSON `{ success: boolean, summary: string, error?: string | null }` to specified path.

- [x] **Step 1: Write the failing test for `--result-file`**

In `src/commands/dev.test.ts`, add:
```typescript
    it('should write execution result to --result-file when provided', async () => {
        const resultFile = path.resolve(process.cwd(), 'temp-result-test.json');
        try {
            await devCommand.parseAsync(['node', 'shark', 'dev', '-t', 'Test result output', '-y', '--result-file', resultFile]);
            expect(fs.existsSync(resultFile)).toBe(true);
            const content = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
            expect(content).toHaveProperty('success');
            expect(content).toHaveProperty('summary');
        } finally {
            if (fs.existsSync(resultFile)) {
                fs.unlinkSync(resultFile);
            }
        }
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/dev.test.ts`
Expected: FAIL (argument unknown or file not created)

- [x] **Step 3: Implement `--result-file` option in `src/commands/dev.ts`**

In `src/commands/dev.ts`, register the option:
```typescript
    .option('--result-file <path>', 'Path to write structured JSON execution result')
```

And in the action handler:
```typescript
        try {
            const result = await interactiveDeveloperAgent({
                taskInstruction,
                context: options.context,
                auto: options.yes || options.auto,
                taskId: options.taskId,
                skipMemory: options.skipMemory
            });

            if (options.resultFile) {
                try {
                    const resultPayload = {
                        success: result.success,
                        summary: result.summary,
                        error: result.error || null
                    };
                    const dir = path.dirname(path.resolve(process.cwd(), options.resultFile));
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(path.resolve(process.cwd(), options.resultFile), JSON.stringify(resultPayload, null, 2), 'utf-8');
                } catch (writeErr: any) {
                    console.error('Failed to write result file:', writeErr.message);
                }
            }

            if (!result.success) {
                console.error('Task execution failed:', result.summary);
                process.exit(1);
            }
            if (taskInstruction && !process.env.VITEST) {
                process.exit(0);
            }
        }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands/dev.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/commands/dev.ts src/commands/dev.test.ts; git commit -m "feat(cli): add --result-file option to dev command"
```

---

### Task 2: Implement IPC Completion and WhatsApp Delivery Formatting in `AgentEngine`

**Files:**
- Modify: `src/core/engine/agent-engine.ts:136-216, 430-445`
- Test: `src/core/engine/agent-engine.test.ts:180-320`

**Interfaces:**
- Consumes: `process.env.SHARK_CRON_EXECUTION`, `job: CronJob`, `result: ExecutorRunResult`.
- Produces: `process.send({ type: 'cron_completion', success, summary })`, message formatted with `[Cron: <name>]`.

- [x] **Step 1: Write the failing tests for Cron IPC and Delivery Formatting**

In `src/core/engine/agent-engine.test.ts`, add tests:
```typescript
    it('formats WhatsApp delivery with [Cron: name] header and clean text', async () => {
        let sentSummary = '';
        const mockAdapter: any = {
            channelId: 'whatsapp',
            emit: vi.fn(async (event: any) => {
                if (event.type === 'turn_completed') {
                    sentSummary = event.summary;
                }
            }),
            onInbound: vi.fn()
        };
        const engine = new AgentEngine({ projectRoot: process.cwd() });
        engine.attachAdapter(mockAdapter);

        await engine.deliverCronResult({
            id: 'job-1',
            name: 'Relatório Diário',
            schedule: 'every 1h',
            status: 'scheduled',
            deliver: 'whatsapp',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: true,
            output: 'Tudo operacional.',
            cleanOutput: 'Tudo operacional.',
            silent: false
        });

        expect(sentSummary).toContain('[Cron: Relatório Diário]\nTudo operacional.');
    });

    it('suppresses delivery if cleanOutput is strictly [SILENT]', async () => {
        const mockAdapter: any = {
            channelId: 'whatsapp',
            emit: vi.fn(),
            onInbound: vi.fn()
        };
        const engine = new AgentEngine({ projectRoot: process.cwd() });
        engine.attachAdapter(mockAdapter);

        await engine.deliverCronResult({
            id: 'job-2',
            schedule: 'every 1h',
            status: 'scheduled',
            deliver: 'whatsapp',
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 1
        }, {
            success: true,
            output: '[SILENT]',
            cleanOutput: '[SILENT]',
            silent: true
        });

        expect(mockAdapter.emit).not.toHaveBeenCalled();
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`
Expected: FAIL (header format missing or condition mismatch)

- [x] **Step 3: Update `AgentEngine` with IPC emit and delivery formatting**

In `src/core/engine/agent-engine.ts`, in `runInteractive` after task completion (around line 438):
```typescript
            if (process.env.SHARK_CRON_EXECUTION === 'true' && typeof process.send === 'function' && !process.env.VITEST) {
                try {
                    process.send({
                        type: 'cron_completion',
                        jobId: effectiveTaskId?.replace(/^cron-/, ''),
                        success: result.success,
                        summary: result.summary,
                        error: result.error || null
                    });
                } catch {}
            }
```

And in `deliverCronResult(job: CronJob, result: ExecutorRunResult)`:
```typescript
        const cleanText = (result.cleanOutput || result.output || '').trim();
        if (result.silent || cleanText === '[SILENT]' || /^\s*\[SILENT\]\s*$/i.test(cleanText)) {
            return;
        }

        let targetChannel: string;
        if (job.deliver === 'local') {
            return;
        } else if (job.deliver === 'origin') {
            targetChannel = job.origin_channel || 'cli';
        } else {
            targetChannel = job.deliver;
        }

        const recipientId = job.origin_recipient_id || 'local';

        let messageText: string;
        if (!result.success) {
            messageText = `⚠️ Cron '${job.name || job.id}' falhou: ${cleanText || 'Erro na execução'}`;
        } else {
            if (targetChannel === 'cli') {
                const reportFile = result.outputFilePath || job.last_output_file || '';
                messageText = `ℹ️ [Cron: ${job.name || job.id}] Concluído. Relatório em ${reportFile}`;
            } else {
                let content = cleanText;
                if (content.length > 3500) {
                    const reportFile = result.outputFilePath || job.last_output_file || '';
                    content = content.slice(0, 3500) + `\n\n📄 [Relatório completo salvo em ${reportFile}]`;
                }
                const jobTitle = job.name || job.id;
                messageText = `[Cron: ${jobTitle}]\n${content}`;
            }
        }
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/engine/agent-engine.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/engine/agent-engine.ts src/core/engine/agent-engine.test.ts; git commit -m "feat(engine): add cron IPC completion and WhatsApp delivery formatting"
```

---

### Task 3: Refactor `CronExecutor` with Subagent Pipe Stream, IPC Listening, Pre-Scripts and `_CRON_HINT`

**Files:**
- Modify: `src/core/cron/cron-executor.ts`
- Test: `src/core/cron/cron-executor.test.ts`

**Interfaces:**
- Consumes: `job.script` (pre-run), `job.prompt`, `job.skills`, `child.stdout`, `child.stderr`, IPC message `cron_completion`, `--result-file`.
- Produces: `ExecutorRunResult` with clean output, console logs piped to `.shark/cron/output/<jobId>-console.log`, `silent: boolean`.

- [x] **Step 1: Write unit tests in `cron-executor.test.ts`**

Add tests for:
1. Pre-execution script output injected into task prompt when `!job.no_agent && job.script`.
2. Extraction of clean output from IPC message `cron_completion`.
3. Fallback extraction from `--result-file` if no IPC received.
4. Console logs streamed to file, preventing raw stdout from returning in `cleanOutput`.

```typescript
    it('injects pre-execution script output and _CRON_HINT into task prompt', async () => {
        const executor = new CronExecutor({ storage, projectRoot: tmpDir });
        const mockJob: CronJob = {
            id: 'job-prescript',
            schedule: 'every 1h',
            status: 'scheduled',
            prompt: 'Analise o status dos servidores.',
            script: 'node -e "console.log(\'SERVER_OK=true\')"',
            no_agent: false,
            created_at: Date.now(),
            next_run_at: Date.now() + 3600000,
            run_count: 0
        };

        const briefContent = executor.buildTaskBriefContent(mockJob, 'SERVER_OK=true');
        expect(briefContent).toContain('[IMPORTANT: You are running as a scheduled cron job.');
        expect(briefContent).toContain('SILENT: If there is genuinely nothing new to report');
        expect(briefContent).toContain('SERVER_OK=true');
        expect(briefContent).toContain('Analise o status dos servidores.');
    });

    it('extracts clean final response without terminal ANSI or warnings', () => {
        const rawOutput = '\x1B[2m[INFO] 💭 Thinking...\x1B[22m\n(node:1234) ExperimentalWarning\n🤖 Shark Dev: O resultado é 42\n[SUCCESS] Completed';
        const clean = extractCleanFinalResponse(rawOutput);
        expect(clean).toBe('O resultado é 42');
    });
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/cron/cron-executor.test.ts`
Expected: FAIL (methods not yet defined)

- [x] **Step 3: Implement `buildTaskBriefContent` and Subagent IPC / Pipe in `CronExecutor`**

In `src/core/cron/cron-executor.ts`:
1. Add `buildTaskBriefContent(job: CronJob, preScriptOutput?: string): string`:
```typescript
    public buildTaskBriefContent(job: CronJob, preScriptOutput?: string): string {
        let content = `# Scheduled Cron Task: ${job.name || job.id}\n\n`;
        content += `[IMPORTANT: You are running as a scheduled cron job.\n`;
        content += `DELIVERY: Your final response will be automatically delivered to the user — do NOT use send_message or try to deliver the output yourself. Just produce your report/output as your final response and the system handles the rest.\n`;
        content += `SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]" (nothing else) to suppress delivery. Never combine [SILENT] with content — either report your findings normally, or say [SILENT] and nothing more.\n`;
        content += `AUTONOMY: Do not ask questions or prompt the user for confirmation; complete the required task autonomously.]\n\n`;

        if (job.skills && job.skills.length > 0) {
            content += `> Injected Skills: ${job.skills.join(', ')}\n\n`;
        }

        if (preScriptOutput && preScriptOutput.trim()) {
            content += `## Dados Coletados pelo Script de Monitoramento / Pré-Execução:\n\`\`\`\n${preScriptOutput.trim()}\n\`\`\`\n\n`;
        }

        content += `## Instrução da Tarefa:\n${job.prompt || 'Execute scheduled maintenance.'}\n`;
        return content;
    }
```

2. In `execute(job: CronJob)`:
If `job.script && !job.no_agent`, run script first:
```typescript
        let preScriptOutput: string | undefined;
        if (job.script && !job.no_agent) {
            const scriptResult = await this.executeScriptCommand(job.script, effectiveRoot);
            preScriptOutput = scriptResult.output;
        }

        // Agent execution
        const agentResult = await this.executeAgentSubprocess(job, effectiveRoot, preScriptOutput);
```

3. In `executeAgentSubprocess(job: CronJob, cwd: string, preScriptOutput?: string)`:
Set up `.pipe()` for logs and IPC listener:
```typescript
        const tasksDir = this.storage.getTasksDir();
        const briefFile = path.join(tasksDir, `task-${job.id}-${Date.now()}.md`);
        const resultFile = path.join(tasksDir, `result-${job.id}-${Date.now()}.json`);

        const briefContent = this.buildTaskBriefContent(job, preScriptOutput);
        fs.writeFileSync(briefFile, briefContent, 'utf-8');

        const cliPath = this.resolveSharkCli();
        const args = ['dev', '--task-file', briefFile, '--taskId', `cron-${job.id}`, '--auto', '--skip-memory', '--result-file', resultFile];

        const logDir = this.storage.getOutputDir();
        const consoleLogFile = path.join(logDir, `${job.id}-${Date.now()}-console.log`);
        const logStream = fs.createWriteStream(consoleLogFile, { flags: 'a' });

        return new Promise((resolve) => {
            let ipcSummary: string | undefined;
            let ipcSuccess: boolean | undefined;

            const child = fork(cliPath, args, {
                cwd,
                silent: true,
                env: {
                    ...process.env,
                    SHARK_CRON_EXECUTION: 'true'
                }
            });

            if (child.stdout) child.stdout.pipe(logStream);
            if (child.stderr) child.stderr.pipe(logStream);

            child.on('message', (msg: any) => {
                if (msg && msg.type === 'cron_completion') {
                    ipcSummary = msg.summary;
                    ipcSuccess = msg.success;
                }
            });

            const timer = setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
                logStream.end();
                try { fs.unlinkSync(briefFile); } catch {}
                try { fs.unlinkSync(resultFile); } catch {}
                resolve({
                    success: false,
                    output: `Execution timed out after ${this.timeoutMs}ms.`,
                    cleanOutput: `Execution timed out after ${this.timeoutMs}ms.`,
                    silent: false,
                    outputFilePath: consoleLogFile
                });
            }, this.timeoutMs);

            child.on('exit', (code) => {
                clearTimeout(timer);
                logStream.end();
                try { fs.unlinkSync(briefFile); } catch {}

                let finalSummary = ipcSummary;
                let finalSuccess = ipcSuccess !== undefined ? ipcSuccess : (code === 0);

                if (!finalSummary && fs.existsSync(resultFile)) {
                    try {
                        const fileData = JSON.parse(fs.readFileSync(resultFile, 'utf-8'));
                        finalSummary = fileData.summary;
                        if (fileData.success !== undefined) finalSuccess = fileData.success;
                    } catch {}
                }
                try { fs.unlinkSync(resultFile); } catch {}

                const resolvedOutput = finalSummary || (code === 0 ? 'Cron task completed successfully.' : `Cron task finished with exit code ${code}`);

                resolve({
                    success: finalSuccess,
                    output: resolvedOutput,
                    cleanOutput: resolvedOutput,
                    silent: isExecutionSilent(resolvedOutput),
                    outputFilePath: consoleLogFile
                });
            });
        });
```

- [x] **Step 4: Run all cron tests**

Run: `npx vitest run src/core/cron/`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/core/cron/cron-executor.ts src/core/cron/cron-executor.test.ts; git commit -m "feat(cron): refactor executor with subagent pipe streams, IPC message, and pre-run script injection"
```

---

### Task 4: End-to-End Non-Regression and Validation

**Files:**
- Test: `src/core/cron/cron-executor.test.ts`, `src/core/cron/cron-delivery-mirror.test.ts`, `src/core/engine/agent-engine.test.ts`, `src/commands/dev.test.ts`

- [x] **Step 1: Run complete vitest test suite**

Run: `npm test`
Expected: ALL PASS

- [x] **Step 2: Commit any remaining docs/polish**

```bash
git add docs/superpowers/plans/2026-10-12-cronjob-subagent-parity.md; git commit -m "docs(cron): add complete implementation plan for cronjob subagent parity"
```
