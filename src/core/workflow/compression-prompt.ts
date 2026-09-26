import { ChatMessage } from './history-manager.js';

export const HERMES_COMPRESSION_SYSTEM_PROMPT = `You are an expert context summarizer. Your task is to compress the conversation history into a clear, structured technical summary while preserving all critical context, requirements, decisions, and current progress.

Format your output EXACTLY as follows:

## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
[User preferences, coding style, constraints, important decisions]

## Progress
### Done
[Completed work — specific file paths, commands run, results]
### In Progress
[Work currently underway]
### Blocked
[Any blockers or issues encountered]

## Key Decisions
[Important technical decisions and why]

## Relevant Files
[Files read, modified, or created — with brief note on each]

## Next Steps
[What needs to happen next]

## Critical Context
[Specific values, error messages, configuration details]`;

export function buildCompressionUserPrompt(middleMessages: ChatMessage[], previousSummary?: string): string {
    let prompt = '';
    if (previousSummary) {
        prompt += `PREVIOUS SUMMARY:\n${previousSummary}\n\nUpdate the previous summary with the new middle turns. Move items from In Progress to Done as appropriate.\n\n`;
    }

    prompt += `CONVERSATION TURNS TO SUMMARIZE:\n`;
    for (const msg of middleMessages) {
        prompt += `\n[${msg.role.toUpperCase()}]:\n${msg.content}\n`;
    }

    return prompt;
}
