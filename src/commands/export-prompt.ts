import { Command } from 'commander';
import { UNIFIED_SYSTEM_PROMPT } from '../core/api/prompts.js';

export const exportPromptCommand = new Command('export-prompt')
    .description('Outputs the unified agent system prompt')
    .action(() => {
        console.log(UNIFIED_SYSTEM_PROMPT);
    });
