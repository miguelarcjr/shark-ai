import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CronStorage } from './cron-storage.js';
import { CronExecutor, isExecutionSilent } from './cron-executor.js';
import type { CronJob } from './cron-types.js';

describe('CronExecutor', { timeout: 15000 }, () => {
    const testDir = path.resolve(process.cwd(), '.shark', 'test-cron-executor');
    let storage: CronStorage;
    let executor: CronExecutor;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        storage = new CronStorage(testDir);
        executor = new CronExecutor({ storage, projectRoot: testDir });
    });

    afterEach(() => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch {}
    });

    it('should execute direct scripts in no_agent mode without LLM', async () => {
        const job: CronJob = {
            id: 'job-script',
            schedule: '10m',
            status: 'running',
            no_agent: true,
            script: 'node -e "console.log(\'hello from script\')"',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 600000,
            run_count: 1
        };

        const result = await executor.execute(job);
        expect(result.success).toBe(true);
        expect(result.output).toContain('hello from script');
        expect(result.silent).toBe(false);

        // Verify report file was saved
        const outputFiles = fs.readdirSync(storage.getOutputDir());
        expect(outputFiles.length).toBeGreaterThan(0);
    });

    it('should detect [SILENT] token and set silent flag', async () => {
        const job: CronJob = {
            id: 'job-silent',
            schedule: '10m',
            status: 'running',
            no_agent: true,
            script: 'node -e "console.log(\'[SILENT]\')"',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 600000,
            run_count: 1
        };

        const result = await executor.execute(job);
        expect(result.silent).toBe(true);
    });

    it('should skip agent execution when monitor_script output hash has not changed', async () => {
        const monitorScript = 'node -e "console.log(\'healthy\')"';
        const job: CronJob = {
            id: 'job-monitor',
            schedule: '5m',
            status: 'running',
            monitor_script: monitorScript,
            prompt: 'inspect system',
            deliver: 'local',
            created_at: Date.now(),
            next_run_at: Date.now() + 300000,
            run_count: 1
        };

        // First execution sets the hash
        const firstRun = await executor.execute(job);
        expect(firstRun.diffDetected).toBe(true);
        expect(job.last_monitor_hash).toBeDefined();

        // Second execution with identical output skips agent
        const secondRun = await executor.execute(job);
        expect(secondRun.diffDetected).toBe(false);
        expect(secondRun.silent).toBe(true);
    }, 30000);

    describe('isExecutionSilent', () => {
        it('should return true for standalone [SILENT] token', () => {
            expect(isExecutionSilent('[SILENT]')).toBe(true);
            expect(isExecutionSilent('  [SILENT]  \n')).toBe(true);
        });

        it('should return true when bot response after Shark Dev is [SILENT]', () => {
            const output = `[START] working...\n[INFO] 🤖 Shark Dev:\n[SILENT]\n[SUCCESS] ✔ Task Completed: [SILENT]`;
            expect(isExecutionSilent(output)).toBe(true);
        });

        it('should NOT return true when [SILENT] is only mentioned in thoughts or instructions', () => {
            const output = `[START] working...\n[INFO] 💭 Se houver mudanças, devo enviar alerta em vez de suprimir com [SILENT].\n[INFO] 🤖 Shark Dev:\n🚨 ALERTA DO GIT WATCHDOG 🚨\nForam detectadas 26 mudanças.\n[SUCCESS] ✔ Task Completed: Alerta do Git Watchdog`;
            expect(isExecutionSilent(output)).toBe(false);
        });
    });

    describe('buildTaskBriefContent and pre-execution script injection', () => {
        it('should build task brief with _CRON_HINT and preScriptOutput', () => {
            const job: CronJob = {
                id: 'job-prescript',
                name: 'Monitoramento de Servidor',
                schedule: 'every 1h',
                status: 'scheduled',
                prompt: 'Analise o status dos servidores.',
                skills: ['domain-research'],
                script: 'node -e "console.log(\'SERVER_OK=true\')"',
                no_agent: false,
                deliver: 'local',
                created_at: Date.now(),
                next_run_at: Date.now() + 3600000,
                run_count: 0
            };

            const content = executor.buildTaskBriefContent(job, 'SERVER_OK=true');
            expect(content).toContain('# Scheduled Cron Task: Monitoramento de Servidor');
            expect(content).toContain('[IMPORTANT: You are running as a scheduled cron job.');
            expect(content).toContain('SILENT: If there is genuinely nothing new to report, respond with exactly "[SILENT]"');
            expect(content).toContain('AUTONOMY: Do not ask questions or prompt the user for confirmation');
            expect(content).toContain('> Injected Skills: domain-research');
            expect(content).toContain('## Dados Coletados pelo Script de Monitoramento / Pré-Execução:');
            expect(content).toContain('SERVER_OK=true');
            expect(content).toContain('Analise o status dos servidores.');
        });
    });
});
