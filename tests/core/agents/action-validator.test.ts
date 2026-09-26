import { describe, it, expect } from 'vitest';
import { ActionValidator } from '../../../src/core/agents/action-validator.js';

describe('ActionValidator', () => {
    it('should validate a correct uniform envelope', () => {
        const payload = {
            thought: 'Reading file...',
            action: {
                type: 'read_file',
                args: { path: 'src/index.ts' }
            },
            summary: 'Read file.'
        };
        const result = ActionValidator.validate(payload);
        expect(result.isValid).toBe(true);
    });

    it('should reject flat action format where action is a string', () => {
        const flatPayload = {
            action: 'read_file',
            path: 'src/routes/index.tsx',
            start_line: 0,
            end_line: 250
        };
        const result = ActionValidator.validate(flatPayload);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('[SYSTEM ERROR]');
        expect(result.errorMessage).toContain('Formato de envelope de ação inválido');
        expect(result.errorMessage).toContain('"type": "read_file"');
        expect(result.errorMessage).toContain('"path"');
    });

    it('should reject missing required parameters for native tools', () => {
        const invalidArgs = {
            thought: 'Reading...',
            action: {
                type: 'read_file',
                args: {}
            },
            summary: 'Reading'
        };
        const result = ActionValidator.validate(invalidArgs);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('[SYSTEM ERROR]');
        expect(result.errorMessage).toContain("Parâmetro obrigatório 'path' ausente");
    });

    it('should reject modify_file missing anchors and provide recovery guidance', () => {
        const invalidModify = {
            thought: 'Modifying...',
            action: {
                type: 'modify_file',
                args: { path: 'src/index.ts', content: 'new content' }
            },
            summary: 'Modifying'
        };
        const result = ActionValidator.validate(invalidModify);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('start_anchor');
        expect(result.errorMessage).toContain('end_anchor');
    });

    it('should embed MCP tool describe schema when validating MCP tools', () => {
        const mockBridgeToolsManager = {
            isBridgeTool: (name: string) => name === 'mcp_sqlite_query',
            executeToolDescribe: () => ({
                success: true,
                output: {
                    tools: {
                        mcp_sqlite_query: {
                            description: 'Execute SQL statement in SQLite',
                            parameters: {
                                type: 'object',
                                properties: { query: { type: 'string' } },
                                required: ['query']
                            }
                        }
                    }
                }
            })
        };

        const flatMcp = {
            action: 'mcp_sqlite_query',
            sql: 'SELECT 1'
        };
        const result = ActionValidator.validate(flatMcp, mockBridgeToolsManager);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('tool_call');
        expect(result.errorMessage).toContain('Execute SQL statement in SQLite');
        expect(result.errorMessage).toContain('"query"');
    });

    it('should reject missing action block and provide full canonical envelope example', () => {
        const noActionPayload = {
            thought: 'Exploring repository...',
            tool: 'read_file',
            path: 'src/components/site/footer.tsx'
        };
        const result = ActionValidator.validate(noActionPayload);
        expect(result.isValid).toBe(false);
        expect(result.errorMessage).toContain('[SYSTEM ERROR]');
        expect(result.errorMessage).toContain('Nenhum bloco \'action\' válido foi fornecido');
        expect(result.errorMessage).toContain('📋 ENVELOPE OBRIGATÓRIO:');
        expect(result.errorMessage).toContain('"action": {');
        expect(result.errorMessage).toContain('"type": "nome_da_ferramenta"');
        expect(result.errorMessage).toContain('"args": { /* parâmetros */ }');
    });
});
