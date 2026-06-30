import { describe, it, expect } from 'vitest';
import { GRAPH_HTML_TEMPLATE } from './graph-html.js';

describe('GRAPH_HTML_TEMPLATE', () => {
    it('should be a string containing HTML', () => {
        expect(typeof GRAPH_HTML_TEMPLATE).toBe('string');
        expect(GRAPH_HTML_TEMPLATE).toContain('<!DOCTYPE html>');
        expect(GRAPH_HTML_TEMPLATE).toContain('<title>Shark Dev Memory Graph</title>');
        expect(GRAPH_HTML_TEMPLATE).toContain('vis-network');
    });
});
