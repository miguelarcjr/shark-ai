import { crashHandler } from '../core/error/crash-handler.js';

// Initialize Global Crash Handler
crashHandler.init();

import { Command } from 'commander';
import { loginCommand } from '../commands/login.js';
import { configCommand } from '../commands/config.js';
import { initCommand } from '../commands/init.js';
import { colors } from '../ui/colors.js';
import { devCommand } from '../commands/dev.js';
import { legacyCommand } from '../commands/legacy.js';
import { exportSchemaCommand } from '../commands/export-schema.js';
import { exportPromptCommand } from '../commands/export-prompt.js';
import { superCommand } from '../commands/super.js';

const program = new Command();

program
    .name('shark')
    .description('Shark CLI: AI-Native Collaborative Development Tool')
    .version('0.0.1');

program.addCommand(loginCommand);
program.addCommand(initCommand);
program.addCommand(devCommand);
program.addCommand(legacyCommand);
program.addCommand(exportSchemaCommand);
program.addCommand(exportPromptCommand);
program.addCommand(superCommand);

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
