import { AIProvider, ChatOptions } from './provider.interface.js';
import { AgentResponse, parseAgentResponse } from '../agents/agent-response-parser.js';
import { STACKSPOT_AGENT_API_BASE, ensureValidToken } from './stackspot-client.js';
import { sseClient } from './sse-client.js';
import { tokenStorage } from '../auth/token-storage.js';
import { getActiveRealm } from '../auth/get-active-realm.js';
import { ConfigManager } from '../config-manager.js';
import { UNIFIED_SYSTEM_PROMPT } from './prompts.js';
import { FileLogger } from '../debug/file-logger.js';

export class StackSpotProvider implements AIProvider {
    public agentId?: string;

    constructor(private agentType: string) {
        const config = ConfigManager.getInstance().getConfig();
        this.agentId = config.stackspot?.agentId;
    }

    private getAgentId(): string {
        const config = ConfigManager.getInstance().getConfig();
        if (config.agents?.dev) {
            return config.agents.dev;
        }

        const envResolved = process.env.STACKSPOT_DEV_AGENT_ID;
        if (envResolved) {
            return envResolved;
        }

        if (this.agentId && this.agentId !== '01KEQCGJ65YENRA4QBXVN1YFFX') {
            return this.agentId;
        }

        return '01KEQCGJ65YENRA4QBXVN1YFFX';
    }

    private getAgentVersion(): string | undefined {
        const config = ConfigManager.getInstance().getConfig();
        return config.agentVersions?.dev || process.env.STACKSPOT_DEV_AGENT_VERSION;
    }

    async streamChat(prompt: string, options: ChatOptions): Promise<AgentResponse> {
        const realm = await getActiveRealm();
        let token: string | null = null;
        try {
            token = await ensureValidToken(realm);
        } catch (error) {
            token = await tokenStorage.getToken(realm);
        }

        if (!token) {
            throw new Error(`No authentication token found for realm '${realm}'. Please run 'shark login'.`);
        }

        let systemPrompt = UNIFIED_SYSTEM_PROMPT;
        let retrievedContext = '';
        const isHelperCall = options.conversationId?.startsWith('membox-');
        if (!isHelperCall) {
            const { MemboxManager } = await import('../workflow/membox-manager.js');
            const memboxManager = new MemboxManager();
            const query = options?.searchQuery || prompt;
            retrievedContext = await memboxManager.retrieveContext(query, []);
            if (retrievedContext) {
                systemPrompt = systemPrompt + '\n' + retrievedContext;
            }
        }

        const isFirstTurn = !options.conversationId;
        let finalPrompt = prompt;
        if (!isFirstTurn && retrievedContext) {
            finalPrompt = `[MEMÓRIA E CONTEXTO RECUPERADOS]\n${retrievedContext}\n\n[MENSAGEM DO USUÁRIO]\n${prompt}`;
        } else if (isFirstTurn) {
            finalPrompt = `SYSTEM INSTRUCTIONS:\n${systemPrompt}\n\nUSER REQUEST:\n${prompt}`;
        }

        const requestPayload: any = {
            user_prompt: finalPrompt,
            streaming: true,
            stackspot_knowledge: false,
            return_ks_in_response: true,
            deep_search_ks: false,
            use_conversation: true,
            conversation_id: options.conversationId,
        };

        const agentVersion = this.getAgentVersion();
        if (agentVersion) {
            requestPayload.agent_version_number = agentVersion;
        }

        const effectiveAgentId = this.getAgentId();
        const agentUrl = `${STACKSPOT_AGENT_API_BASE}/v1/agent/${effectiveAgentId}/chat`;

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        };

        const sanitizedHeaders = { ...headers };
        if (sanitizedHeaders['Authorization']) {
            sanitizedHeaders['Authorization'] = 'Bearer ***';
        }
        FileLogger.log('PROVIDER_REQUEST', 'Request payload sent to StackSpot API', {
            agentId: effectiveAgentId,
            url: agentUrl,
            headers: sanitizedHeaders,
            payload: requestPayload
        });

        let fullMessage = '';
        let rawResponse: any = {};

        await sseClient.streamAgentResponse(
            agentUrl,
            requestPayload,
            headers,
            {
                onChunk: (chunk) => {
                    fullMessage += chunk;
                    if (options.onChunk) {
                        options.onChunk(chunk);
                    }
                },
                onComplete: async (message, metadata) => {
                    rawResponse = {
                        message: message || fullMessage,
                        conversation_id: metadata?.conversation_id || options.conversationId,
                    };
                },
                onError: (error) => {
                    throw error;
                },
            }
        );

        FileLogger.log('PROVIDER_RESPONSE', 'Raw response from StackSpot API', { rawResponse });
        const parsedResponse = parseAgentResponse(rawResponse);
        if (options.onComplete) {
            options.onComplete(parsedResponse);
        }
        return parsedResponse;
    }
}
