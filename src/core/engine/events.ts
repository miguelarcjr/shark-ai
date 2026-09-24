export type InboundUserMessage = {
    type: 'user_message';
    sessionId: string;
    text: string;
    media?: Array<{ path: string; mimeType: string }>;
    role: 'user';
    origin: { channelId: string; senderId: string; isGroup?: boolean };
};

export type InboundActionApprovalResponse = {
    type: 'action_approval_response';
    sessionId: string;
    approvalId: string;
    decision: 'approved' | 'rejected' | 'always';
    feedback?: string;
};

export type InboundClarifyResponse = {
    type: 'clarify_response';
    sessionId: string;
    questionId: string;
    answer: string | string[];
};

export type InboundAbortCommand = {
    type: 'abort_command';
    sessionId: string;
    reason?: string;
};

export type AgentInboundEvent = 
    | InboundUserMessage
    | InboundActionApprovalResponse
    | InboundClarifyResponse
    | InboundAbortCommand;

export type OutboundReasoningDelta = {
    type: 'reasoning_delta';
    sessionId: string;
    delta: string;
};

export type OutboundTextDelta = {
    type: 'text_delta';
    sessionId: string;
    delta: string;
};

export type OutboundToolProgress = {
    type: 'tool_progress';
    sessionId: string;
    toolName: string;
    status: 'starting' | 'running' | 'completed' | 'failed';
    details?: string;
    error?: string;
};

export type OutboundActionApprovalRequest = {
    type: 'action_approval_request';
    sessionId: string;
    approvalId: string;
    toolName: string;
    toolArgs: any;
    riskLevel: 'low' | 'medium' | 'high';
    ttlMs: number;
    fallbackText: string;
};

export type OutboundClarifyRequest = {
    type: 'clarify_request';
    sessionId: string;
    questionId: string;
    question: string;
    options?: string[];
};

export type OutboundMediaAttachment = {
    type: 'media_attachment';
    sessionId: string;
    filePath: string;
    mimeType: string;
    caption?: string;
};

export type OutboundPresenceStatus = {
    type: 'presence_status';
    sessionId: string;
    status: 'typing' | 'idle' | 'executing_tool';
    emojiReaction?: '👀' | '✅' | '❌';
};

export type OutboundTurnCompleted = {
    type: 'turn_completed';
    sessionId: string;
    summary: string;
};

export type OutboundTurnInterrupted = {
    type: 'turn_interrupted';
    sessionId: string;
    reason: string;
};

export type AgentOutboundEvent =
    | OutboundReasoningDelta
    | OutboundTextDelta
    | OutboundToolProgress
    | OutboundActionApprovalRequest
    | OutboundClarifyRequest
    | OutboundMediaAttachment
    | OutboundPresenceStatus
    | OutboundTurnCompleted
    | OutboundTurnInterrupted;
