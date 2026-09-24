import type { AgentInboundEvent, AgentOutboundEvent } from '../engine/events.js';

export interface AgentChannelAdapter {
    readonly channelId: string;
    emit(event: AgentOutboundEvent): Promise<void> | void;
    onInbound(handler: (event: AgentInboundEvent) => Promise<void>): void;
    start?(): Promise<void>;
    stop?(): Promise<void>;
}
