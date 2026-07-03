import { Command } from 'commander';
import { UNIFIED_SYSTEM_PROMPT, SUBAGENT_SYSTEM_PROMPT } from '../core/api/prompts.js';
import { tui } from '../ui/tui.js';

export const exportPromptCommand = new Command('export-prompt')
    .description('Outputs the agent system prompt')
    .argument('[role]', 'The agent role: coordinator or subagent')
    .action(async (role) => {
        let selectedRole = role;
        if (!selectedRole) {
            selectedRole = await tui.select({
                message: 'Select the agent role to export prompt for:',
                options: [
                    { value: 'coordinator', label: 'Coordinator / Parent' },
                    { value: 'subagent', label: 'Subagent / Child' }
                ]
            });
        }

        if (selectedRole === 'subagent' || selectedRole === 'child') {
            console.log(SUBAGENT_SYSTEM_PROMPT);
        } else {
            console.log(UNIFIED_SYSTEM_PROMPT);
        }
    });
