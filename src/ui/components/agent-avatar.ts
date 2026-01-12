import { colors } from '../colors.js';

export type AgentType = 'analyst' | 'dev' | 'architect' | 'system';

interface AgentDefinition {
    emoji: string;
    label: string;
    color: (text: string) => string;
}

const AGENT_Defs: Record<AgentType, AgentDefinition> = {
    analyst: {
        emoji: '🦈',
        label: '[Analyst]',
        color: colors.primary,
    },
    dev: {
        emoji: '👷',
        label: '[Dev]',
        color: colors.warning,
    },
    architect: {
        emoji: '🏗️',
        label: '[Arch]',
        color: colors.secondary,
    },
    system: {
        emoji: '🏁',
        label: '[System]',
        color: colors.success,
    },
};

/**
 * Returns a formatted prefix string for a given agent type.
 * Example: 🦈 [Analyst] (in Cyan)
 */
export function getAgentPrefix(type: AgentType): string {
    const def = AGENT_Defs[type];
    if (!def) {
        // Fallback for safety, though Type system prevents this usually
        return colors.dim(`[${type}]`);
    }
    return def.color(`${def.emoji} ${def.label}`);
}
