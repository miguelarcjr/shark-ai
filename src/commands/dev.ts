import { Command } from 'commander';
import { interactiveDeveloperAgent } from '../core/agents/developer-agent.js';
import { AGENT_RESPONSE_JSON_SCHEMA } from '../core/api/prompts.js';
import { exec } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const devCommand = new Command('dev')
    .description('Starts the Shark Developer Agent (Shark Dev Orchestration V2)')
    .option('-t, --task <type>', 'Initial task description (Quick Mode)')
    .option('-c, --context <path>', 'Path to custom context file')
    .option('-y, --yes', 'Automatically approve all actions without prompting')
    .option('--auto', 'Automatically approve all actions without prompting')
    .option('--export-schema', 'Export the agent response JSON schema')
    .option('--taskId <id>', 'ID of the current subagent task')
    .option('--graph', 'Enable real-time memory graph visualization', false)
    .action(async (options) => {
        if (options.exportSchema) {
            console.log(JSON.stringify(AGENT_RESPONSE_JSON_SCHEMA, null, 2));
            return;
        }

        if (options.graph) {
            try {
                const runDir = path.join(process.cwd(), '.shark', 'membox');
                const configPath = path.join(runDir, 'graph-server.json');
                if (fs.existsSync(configPath)) {
                    fs.unlinkSync(configPath);
                }
            } catch {}

            const cliPath = path.resolve(__dirname, '..', 'bin', 'shark.js');
            const child = exec(`node "${cliPath}" graph`);
            child.unref();
        }

        try {
            const result = await interactiveDeveloperAgent({
                taskInstruction: options.task,
                context: options.context,
                auto: options.yes || options.auto,
                taskId: options.taskId
            });
            if (!result.success) {
                console.error('Task execution failed:', result.summary);
                process.exit(1);
            }
        } catch (error: any) {
            console.error('Error during development agent execution:', error.message);
            process.exit(1);
        }
    });


