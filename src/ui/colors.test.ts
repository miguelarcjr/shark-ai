import { describe, it, expect } from 'vitest';
import { colors } from './colors';

describe('Shark UI Colors', () => {
    it('should export all required semantic colors', () => {
        expect(colors.primary).toBeDefined();
        expect(colors.secondary).toBeDefined();
        expect(colors.success).toBeDefined();
        expect(colors.error).toBeDefined();
        expect(colors.warning).toBeDefined();
        expect(colors.dim).toBeDefined();
        expect(colors.inverse).toBeDefined();
    });

    it('should return strings', () => {
        expect(typeof colors.primary('test')).toBe('string');
        expect(typeof colors.error('test')).toBe('string');
    });
});
