import { describe, it, expect } from 'vitest';
import { 
    COORDINATOR_RESPONSE_JSON_SCHEMA, 
    SUBAGENT_RESPONSE_JSON_SCHEMA,
    UNIFIED_SYSTEM_PROMPT,
    SUBAGENT_SYSTEM_PROMPT
} from '../../../src/core/api/prompts.js';

describe('Prompts and Schemas', () => {
    it('should export all required schemas and prompts', () => {
        expect(COORDINATOR_RESPONSE_JSON_SCHEMA).toBeDefined();
        expect(SUBAGENT_RESPONSE_JSON_SCHEMA).toBeDefined();
        expect(UNIFIED_SYSTEM_PROMPT).toBeDefined();
        expect(SUBAGENT_SYSTEM_PROMPT).toBeDefined();
    });

    it('should have only task-level actions in subagent schema', () => {
        const subagentActions = SUBAGENT_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum;
        
        // Allowed
        expect(subagentActions).toContain('read_file');
        expect(subagentActions).toContain('modify_file');
        expect(subagentActions).toContain('complete_task');

        // Not allowed (orchestration tools)
        expect(subagentActions).not.toContain('invoke_subagent');
        expect(subagentActions).not.toContain('manage_subagents');
        expect(subagentActions).not.toContain('activate_skill');
        expect(subagentActions).not.toContain('wait');
        expect(subagentActions).not.toContain('talk_with_user');
    });

    it('should keep all orchestration tools in coordinator schema', () => {
        const coordinatorActions = COORDINATOR_RESPONSE_JSON_SCHEMA.properties.action.properties.type.enum;
        expect(coordinatorActions).toContain('invoke_subagent');
        expect(coordinatorActions).toContain('read_file');
        expect(coordinatorActions).toContain('talk_with_user');
    });
});
