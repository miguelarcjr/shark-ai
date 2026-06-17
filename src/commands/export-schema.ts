import { Command } from 'commander';

const schema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentResponse",
  "type": "object",
  "properties": {
    "action": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "create_file",
            "modify_file",
            "read_file",
            "list_files",
            "search_file",
            "search_code",
            "delete_file",
            "run_command",
            "talk_with_user",
            "use_mcp_tool"
          ]
        },
        "path": { "type": ["string", "null"] },
        "content": { "type": ["string", "null"] },
        "start_anchor": { "type": ["string", "null"] },
        "end_anchor": { "type": ["string", "null"] },
        "command": { "type": ["string", "null"] },
        "query": { "type": ["string", "null"] },
        "tool_name": { "type": ["string", "null"] },
        "tool_args": { "type": ["string", "null"] }
      },
      "required": ["type"]
    },
    "summary": { "type": "string" }
  },
  "required": ["action"]
};

export const exportSchemaCommand = new Command('export-schema')
    .description('Outputs the agent response JSON Schema')
    .action(() => {
        console.log(JSON.stringify(schema, null, 2));
    });
