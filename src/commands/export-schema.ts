import { Command } from 'commander';
import { AGENT_RESPONSE_JSON_SCHEMA } from '../core/api/prompts.js';

export const exportSchemaCommand = new Command('export-schema')
    .description('Outputs the agent response JSON Schema')
    .action(() => {
        console.log(JSON.stringify(AGENT_RESPONSE_JSON_SCHEMA, null, 2));
    });

