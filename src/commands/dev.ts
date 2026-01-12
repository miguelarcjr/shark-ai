
import { Command } from 'commander';
import { interactiveDeveloperAgent } from '../core/agents/developer-agent.js';

export const devCommand = new Command('dev')
    .description('Starts the Shark Developer Agent (Shark Dev)')
    .option('-t, --task <type>', 'Initial task description')
    .option('-c, --context <path>', 'Path to custom context file')
    .action(async (options) => {
        await interactiveDeveloperAgent(options);
    });
