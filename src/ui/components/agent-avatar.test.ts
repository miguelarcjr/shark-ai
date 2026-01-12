import { describe, it, expect } from 'vitest';
import { getAgentPrefix } from './agent-avatar.js';
import stripAnsi from 'strip-ansi';

describe('AgentAvatar', () => {
    it('should return correct format for analyst', () => {
        const prefix = getAgentPrefix('analyst');
        const clean = stripAnsi(prefix);
        expect(clean).toBe('🦈 [Analyst]');
    });

    it('should return correct format for dev', () => {
        const prefix = getAgentPrefix('dev');
        const clean = stripAnsi(prefix);
        expect(clean).toBe('👷 [Dev]');
    });

    it('should return correct format for architect', () => {
        const prefix = getAgentPrefix('architect');
        const clean = stripAnsi(prefix);
        expect(clean).toBe('🏗️ [Arch]');
    });

    it('should return correct format for system', () => {
        const prefix = getAgentPrefix('system');
        const clean = stripAnsi(prefix);
        expect(clean).toBe('🏁 [System]');
    });
});
