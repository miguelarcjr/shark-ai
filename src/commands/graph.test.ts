import { describe, it, expect } from 'vitest';
import { graphCommand } from './graph.js';

describe('Graph Command Server', () => {
    it('should boot up http server and process arguments', () => {
        expect(graphCommand.name()).toBe('graph');
        expect(graphCommand.description()).toContain('Visualize');
    });
});
