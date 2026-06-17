import { describe, it, expect, vi } from 'vitest';
import { exportSchemaCommand } from './export-schema.js';

describe('Export Schema Command', () => {
    it('should output the correct JSON Schema to stdout', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        // Run command action
        exportSchemaCommand.parse(['node', 'shark', 'export-schema']);

        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        const parsed = JSON.parse(output);

        expect(parsed).toHaveProperty('$schema', 'http://json-schema.org/draft-07/schema#');
        expect(parsed).toHaveProperty('title', 'AgentResponse');
        expect(parsed).toHaveProperty('required', ['action']);
        expect(parsed.properties.action.properties.type.enum).toContain('create_file');

        logSpy.mockRestore();
    });
});
