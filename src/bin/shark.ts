#!/usr/bin/env node
import { crashHandler } from '../core/error/crash-handler.js';

// Initialize Global Crash Handler
crashHandler.init();

import { Command } from 'commander';
import { loginCommand } from '../commands/login.js';
import { configCommand } from '../commands/config.js';
import { initCommand } from '../commands/init.js';
import { colors } from '../ui/colors.js';
import { interactiveBusinessAnalyst } from '../core/agents/business-analyst-agent.js';
import { interactiveSpecificationAgent } from '../core/agents/specification-agent.js';
import { scanCommand } from '../commands/scan.js';
import { devCommand } from '../commands/dev.js';
import { qaCommand } from '../commands/qa.js';

const program = new Command();

program
    .name('shark')
    .description('Shark CLI: AI-Native Collaborative Development Tool')
    .version('0.0.1');

program.addCommand(loginCommand);
program.addCommand(initCommand);
program.addCommand(scanCommand);
program.addCommand(devCommand);
program.addCommand(qaCommand);

// Command: ba
// Description: Starts the Business Analyst Agent interactive session
program
    .command('ba')
    .description('Start Business Analyst Agent interactive session')
    .option('--id <agent_id>', 'Override Agent ID')
    .action(async (options) => {
        try {
            await interactiveBusinessAnalyst();
        } catch (error: any) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });

// Command: spec
// Description: Starts the Specification Agent session
program
    .command('spec')
    .description('Start Specification Agent interactive session')
    .option('--id <agent_id>', 'Override Agent ID')
    .option('--briefing <path>', 'Path to briefing file')
    .action(async (options) => {
        try {
            await interactiveSpecificationAgent({
                agentId: options.id,
                briefingPath: options.briefing
            });
        } catch (error: any) {
            console.error('Error:', error.message);
            process.exit(1);
        }
    });

program
    .command('config')
    .description('Manage global configuration')
    .action(configCommand.action);

// Global Error Handler for the CLI
process.on('unhandledRejection', (err) => {
    console.error(colors.error('❌ Unhandled Error:'), err);
    process.exit(1);
});

program.parse(process.argv);
