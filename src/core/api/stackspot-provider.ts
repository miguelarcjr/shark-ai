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
        const configKeyMapping: Record<string, 'dev' | 'ba' | 'spec' | 'qa' | 'scan' | 'codeReview'> = {
            'developer_agent': 'dev',
            'business_analyst': 'ba',
            'specification_agent': 'spec',
            'qa_agent': 'qa',
            'scan_agent': 'scan',
            'code_review': 'codeReview'
        };
        const mappedKey = configKeyMapping[this.agentType];
        if (mappedKey && config.agents?.[mappedKey]) {
            return config.agents[mappedKey]!;
        }

        const envIdMapping: Record<string, string | undefined> = {
            'business_analyst': process.env.STACKSPOT_BA_AGENT_ID,
            'developer_agent': process.env.STACKSPOT_DEV_AGENT_ID,
            'qa_agent': process.env.STACKSPOT_QA_AGENT_ID,
            'specification_agent': process.env.STACKSPOT_SPEC_AGENT_ID,
            'scan_agent': process.env.STACKSPOT_SCAN_AGENT_ID,
            'code_review': process.env.STACKSPOT_CODE_REVIEW_AGENT_ID
        };

        const envResolved = envIdMapping[this.agentType];
        if (envResolved) {
            return envResolved;
        }

        if (this.agentId && this.agentId !== '01KEQCGJ65YENRA4QBXVN1YFFX') {
            return this.agentId;
        }

        const defaultIdMapping: Record<string, string> = {
            'business_analyst': '01KEJ95G304TNNAKGH5XNEEBVD',
            'developer_agent': '01KEQCGJ65YENRA4QBXVN1YFFX',
            'qa_agent': '01KEQFJZ3Q3JER11NH22HEZX9X',
            'specification_agent': '01KEPXTX37FTB4N672TZST4SGP',
            'scan_agent': '01KEQ9AHWB550J2244YBH3QATN',
            'code_review': ''
        };

        const resolved = defaultIdMapping[this.agentType];
        if (this.agentType === 'code_review') {
            if (!resolved) {
                throw new Error("Agent ID for 'code_review' is not configured.");
            }
            return resolved;
        }

        return resolved || '01KEQCGJ65YENRA4QBXVN1YFFX';
    }

    private getAgentVersion(): string | undefined {
        const config = ConfigManager.getInstance().getConfig();
        const versionMapping: Record<string, string | undefined> = {
            'business_analyst': config.agentVersions?.ba || process.env.STACKSPOT_BA_AGENT_VERSION,
            'developer_agent': config.agentVersions?.dev || process.env.STACKSPOT_DEV_AGENT_VERSION,
            'qa_agent': config.agentVersions?.qa || process.env.STACKSPOT_QA_AGENT_VERSION,
            'specification_agent': config.agentVersions?.spec || process.env.STACKSPOT_SPEC_AGENT_VERSION,
            'scan_agent': config.agentVersions?.scan || process.env.STACKSPOT_SCAN_AGENT_VERSION,
            'code_review': config.agentVersions?.codeReview || process.env.STACKSPOT_CODE_REVIEW_AGENT_VERSION
        };
        return versionMapping[this.agentType];
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

        const isFirstTurn = !options.conversationId;
        const finalPrompt = isFirstTurn
            ? `SYSTEM INSTRUCTIONS:\n${UNIFIED_SYSTEM_PROMPT}\n\nUSER REQUEST:\n${prompt}`
            : prompt;

        const requestPayload: any = {
            user_prompt: finalPrompt,
            streaming: true,
            stackspot_knowledge: false,
            return_ks_in_response: true,
            deep_search_ks: false,
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
