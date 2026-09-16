import { describe, it, expect } from 'vitest';
import { buildUnifiedSystemPrompt, COORDINATOR_RESPONSE_JSON_SCHEMA, TOOL_ARGS_PROPERTIES } from './prompts.js';

describe('prompts', () => {
    it('deve incluir old_str nas propriedades de TOOL_ARGS_PROPERTIES como anulável', () => {
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('old_str');
        expect((TOOL_ARGS_PROPERTIES as any).old_str.type).toEqual(['string', 'null']);
    });

    it('deve ter conformidade estrita com OpenAI Structured Outputs usando anyOf', () => {
        const schema = COORDINATOR_RESPONSE_JSON_SCHEMA as any;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(['thought', 'action', 'summary']);
        expect(Array.isArray(schema.properties.action.anyOf)).toBe(true);
        expect(schema.properties.action.anyOf.length).toBeGreaterThan(15);

        // Check each action branch in anyOf
        for (const branch of schema.properties.action.anyOf) {
            expect(branch.additionalProperties).toBe(false);
            expect(branch.required).toEqual(['type', 'args']);
            expect(branch.properties.args.additionalProperties).toBe(false);
            expect(branch.properties.args.required).toBeDefined();
        }
    });

    it('deve incluir old_str no COORDINATOR_RESPONSE_JSON_SCHEMA sob memory', () => {
        const schema = COORDINATOR_RESPONSE_JSON_SCHEMA as any;
        const memoryBranch = schema.properties.action.anyOf.find((b: any) => b.properties.type.enum.includes('memory'));
        expect(memoryBranch).toBeDefined();
        expect(memoryBranch.properties.args.properties).toHaveProperty('old_str');
    });

    it('deve renderizar <user_profile> e <project_memory> e as regras de governança de memória quando snapshot for fornecido', () => {
        const prompt = buildUnifiedSystemPrompt({
            snapshot: {
                user: 'User pref: typescript',
                memory: 'Repo conventions: vitest',
                soul: 'Custom soul',
                memoryUsage: { current: 10, max: 2200, percentage: 1 },
                userUsage: { current: 10, max: 1375, percentage: 1 },
                composedPromptBlock: ''
            }
        });
        expect(prompt).toContain('<user_profile>\nUser pref: typescript\n</user_profile>');
        expect(prompt).toContain('<project_memory>\nRepo conventions: vitest\n</project_memory>');
        expect(prompt).toContain('DECLARATIVA');
        expect(prompt).toContain('old_str');
        expect(prompt).toContain('session_search');
    });

    it('deve conter regras mandatórias de consulta e ativação de skills quando skillsIndex for fornecido', () => {
        const prompt = buildUnifiedSystemPrompt({ skillsIndex: '- **brainstorming**: Design spec' });
        expect(prompt).toContain('<skills_index>\n- **brainstorming**: Design spec\n</skills_index>');
        expect(prompt).toContain('skill_view');
        expect(prompt).toContain('skills_list');
        expect(prompt).toContain('skill_manage');
    });

    it('deve incluir novos argumentos de skills em TOOL_ARGS_PROPERTIES e COORDINATOR_RESPONSE_JSON_SCHEMA', () => {
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('file_path');
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('old_string');
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('new_string');
        expect(TOOL_ARGS_PROPERTIES).toHaveProperty('scope');

        const schema = COORDINATOR_RESPONSE_JSON_SCHEMA as any;
        const allTypes = schema.properties.action.anyOf.map((b: any) => b.properties.type.enum[0]);
        expect(allTypes).toContain('skills_list');
        expect(allTypes).toContain('skill_view');
        expect(allTypes).toContain('skill_manage');
    });
});
