import { Command } from 'commander';
import { COORDINATOR_RESPONSE_JSON_SCHEMA, SUBAGENT_RESPONSE_JSON_SCHEMA } from '../core/api/prompts.js';
import { tui } from '../ui/tui.js';

export const exportSchemaCommand = new Command('export-schema')
    .description('Outputs the agent response JSON Schema')
    .argument('[role]', 'The agent role: coordinator or subagent')
    .option('-m, --minified', 'Output compact minified JSON on a single line')
    .action(async (role, options) => {
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

        const schema = (selectedRole === 'subagent' || selectedRole === 'child')
            ? SUBAGENT_RESPONSE_JSON_SCHEMA
            : COORDINATOR_RESPONSE_JSON_SCHEMA;

        if (options.minified) {
            console.log(JSON.stringify(schema));
        } else {
            console.log(JSON.stringify(schema, null, 2));
        }
    });
