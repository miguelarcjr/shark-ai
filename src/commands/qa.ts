import { Command } from 'commander';
import { runQAAgent } from '../core/agents/qa-agent.js';

export const qaCommand = new Command('qa')
    .description('Start the Shark QA Agent to test web applications')
    .option('--url <url>', 'Initial URL to test')
    .option('--scenario <scenario>', 'Scenario description or test case to execute')
    .action(async (options) => {
        try {
            await runQAAgent({
                initialUrl: options.url,
                scenario: options.scenario
            });
        } catch (error: any) {
            console.error('Failed to run QA Agent:', error.message);
            process.exit(1);
        }
    });
