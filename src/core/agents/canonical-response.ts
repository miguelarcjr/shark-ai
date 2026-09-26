export interface CanonicalAssistantResponse {
    thought: string;
    action: {
        type: string;
        args: Record<string, any>;
    };
    summary: string;
}

export function toCanonicalAssistantMessage(rawOrParsed: any): string {
    let obj = rawOrParsed;
    if (typeof obj === 'string') {
        const trimmed = obj.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            return obj;
        }
        try {
            obj = JSON.parse(trimmed);
        } catch {
            return obj;
        }
    }

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return typeof rawOrParsed === 'string' ? rawOrParsed : JSON.stringify(rawOrParsed);
    }

    const type = obj.action?.type || (Array.isArray(obj.actions) && obj.actions[0]?.type) || 'talk_with_user';
    
    const rawArgs = obj.action?.args && typeof obj.action.args === 'object'
        ? { ...obj.action.args }
        : (obj.action && typeof obj.action === 'object' ? { ...obj.action } : {});

    delete (rawArgs as any).type;
    delete (rawArgs as any).isSynthetic;

    // Hoist top-level path into rawArgs if not already present
    if (obj.action?.path !== undefined && rawArgs.path === undefined) {
        rawArgs.path = obj.action.path;
    }

    // Clean synthetic empty path from talk_with_user
    if (type === 'talk_with_user' && rawArgs.path === '') {
        delete (rawArgs as any).path;
    }

    if (obj.action?.content !== undefined && rawArgs.content === undefined) {
        rawArgs.content = obj.action.content;
    }

    const canonical: CanonicalAssistantResponse = {
        thought: obj.thought || '',
        action: {
            type,
            args: rawArgs
        },
        summary: obj.summary || obj.message || ''
    };

    return JSON.stringify(canonical);
}
