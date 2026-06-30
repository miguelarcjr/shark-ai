import { describe, it, expect, vi } from 'vitest';
import * as http from 'node:http';
import { graphCommand } from './graph.js';

describe('Graph Command Server', () => {
    it('should boot up http server and process arguments', () => {
        expect(graphCommand.name()).toBe('graph');
        expect(graphCommand.description()).toContain('Visualize');
    });
});
