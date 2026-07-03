import { Command } from 'commander';
import { COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA } from '../core/api/prompts.js';
import { tui } from '../ui/tui.js';

export const exportSchemaCommand = new Command('export-schema')
    .description('Outputs the agent response JSON Schema')
    .argument('[role]', 'The agent role: coordinator or subagent')
    .action(async (role) => {
        let selectedRole = role;
        if (!selectedRole) {
            selectedRole = await tui.select({
                message: 'Select the agent role to export schema for:',
                options: [
                    { value: 'coordinator', label: 'Coordinator / Parent' },
                    { value: 'subagent', label: 'Subagent / Child' }
                ]
            });
        }

        if (selectedRole === 'subagent' || selectedRole === 'child') {
            console.log(JSON.stringify(SUBAGENT_RESPONSE_JSON_SCHEMA, null, 2));
        } else {
            console.log(JSON.stringify(COORDINATOR_RESPONSE_JSON_SCHEMA, null, 2));
        }
    });
