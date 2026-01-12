
import { Command } from 'commander';
import { interactiveScanAgent } from '../core/agents/scan-agent.js';

export const scanCommand = new Command('scan')
    .description('Analyze the project and generate context documentation')
    .option('-o, --output <path>', 'Output file path (default: _bmad/project-context/project-context.md)')
    .option('--depth <level>', 'Scan depth (quick, deep, exhaustive)', 'quick')
    .action(async (options) => {
        try {
            await interactiveScanAgent(options);
        } catch (error: any) {
            console.error('Error during scan:', error.message);
            process.exit(1);
        }
    });
