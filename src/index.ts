import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
    .name('shark')
    .description('Shark CLI: AI-Native Collaborative Development Tool')
    .version('0.0.1');

program.addCommand(loginCommand);

program
    .command('config')
    .description('Manage global configuration')
    .action(configCommand.action);

program.parse();
