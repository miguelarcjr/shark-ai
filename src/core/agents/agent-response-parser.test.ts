import { describe, it, expect } from 'vitest';
import { parseAgentResponse, AgentResponseSchema } from './agent-response-parser.js';
import { ZodError } from 'zod';

describe('AgentResponseParser', () => {
    it('should parse complete response with all fields', () => {
        const rawResponse = {
            summary: 'Here is your solution...',
            action: { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' },
            conversation_id: 'conv-abc123',
        };

        const result = parseAgentResponse(rawResponse);

        expect(result.summary).toBe('Here is your solution...');
        expect(result.action?.type).toBe('create_file');
        expect(result.conversation_id).toBe('conv-abc123');
    });

    it('should parse minimal response with only required fields', () => {
        const minimalResponse = {
            action: { type: 'talk_with_user', content: 'Hello' }
        };

        const result = parseAgentResponse(minimalResponse);

        expect(result.action?.type).toBe('talk_with_user');
        expect(result.conversation_id).toBeUndefined();
    });

    it('should throw ZodError on missing action type', () => {
        const invalidResponse = {
            action: { path: 'test.ts' } // missing 'type'
        };

        expect(() => AgentResponseSchema.parse(invalidResponse)).toThrow(ZodError);
    });

    it('should handle empty summary as valid', () => {
        const emptySummary = {
            summary: '',
            action: null
        };

        const result = parseAgentResponse(emptySummary);
        expect(result.summary).toBe('');
    });

    it('should validate schema with optional summary', () => {
        const responseWithAction = {
            action: { type: 'talk_with_user', content: 'Test' }
        };

        const result = AgentResponseSchema.parse(responseWithAction);
        expect(result.action?.type).toBe('talk_with_user');
    });

    it('should handle legacy actions array and map to single action', () => {
        const response = {
            summary: 'Response with actions array',
            actions: [
                { type: 'create_file', path: 'file.txt', content: 'data' }
            ]
        };

        const result = parseAgentResponse(response);
        expect(result.action?.type).toBe('create_file');
        expect(result.action?.path).toBe('file.txt');
    });

    it('should throw on invalid action type', () => {
        const invalidAction = {
            action: { type: 'invalid_type', content: 'Oops' }
        };

        expect(() => parseAgentResponse(invalidAction)).toThrow(ZodError);
    });

    it('should parse response with a single action', () => {
        const raw = {
            summary: 'Created test file',
            action: { type: 'create_file', path: 'test.ts', content: 'console.log("hello")' }
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('create_file');
        expect(result.action?.path).toBe('test.ts');
    });

    it('should fallback to talk_with_user action for raw text', () => {
        const result = parseAgentResponse('Hello user');
        expect(result.action?.type).toBe('talk_with_user');
        expect(result.action?.content).toBe('Hello user');
    });

    it('should normalize actions array when single action is present and actions is empty array', () => {
        const raw = {
            action: { type: 'talk_with_user', content: 'Design ideas' },
            actions: []
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('talk_with_user');
        expect(result.actions).toHaveLength(1);
        expect(result.actions[0]).toEqual(result.action);
    });

    it('should parse complete_task action successfully', () => {
        const raw = {
            summary: 'Task finalized',
            action: {
                type: 'complete_task',
                content: 'Here is the detailed project code design...',
                summary: 'Completed project analysis.'
            }
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('complete_task');
        expect(result.action?.content).toBe('Here is the detailed project code design...');
    });

    it('should return system error on completely empty raw string', () => {
        const result = parseAgentResponse('   ');
        expect(result.action?.type).toBe('talk_with_user');
        expect(result.action?.content).toContain('[SYSTEM ERROR]: O modelo retornou uma resposta vazia');
    });

    it('should parse and validate notify_user action', () => {
        const raw = {
            action: {
                type: 'notify_user',
                content: 'Everything is running smoothly.'
            },
            summary: 'Notifying user'
        };
        const result = parseAgentResponse(raw);
        expect(result.action?.type).toBe('notify_user');
        expect(result.action?.content).toBe('Everything is running smoothly.');
    });

    describe('Superpowers actions', () => {
        it('parses activate_skill action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'activate_skill',
                    skill_name: 'brainstorming'
                },
                summary: 'Activating skill'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('activate_skill');
            expect((parsed.action as any).skill_name).toBe('brainstorming');
        });

        it('parses define_subagent action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'define_subagent',
                    name: 'code_reviewer',
                    description: 'Reviews TypeScript code',
                    system_prompt: 'You are a reviewer...',
                    enable_write_tools: false,
                    enable_subagent_tools: false
                },
                summary: 'Defining subagent'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('define_subagent');
            expect((parsed.action as any).name).toBe('code_reviewer');
            expect((parsed.action as any).enable_write_tools).toBe(false);
        });

        it('parses invoke_subagent action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'invoke_subagent',
                    Subagents: [
                        {
                            TypeName: 'self',
                            Role: 'Code Implementer',
                            Prompt: 'Implement the task...'
                        }
                    ]
                },
                summary: 'Invoking subagent'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('invoke_subagent');
            expect((parsed.action as any).Subagents).toHaveLength(1);
            expect((parsed.action as any).Subagents[0].TypeName).toBe('self');
        });

        it('parses send_message action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'send_message',
                    Recipient: 'conversation-id-abc',
                    Message: 'I have completed the code review.'
                },
                summary: 'Sending message'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('send_message');
            expect((parsed.action as any).Recipient).toBe('conversation-id-abc');
            expect((parsed.action as any).Message).toBe('I have completed the code review.');
        });

        it('parses manage_subagents action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'manage_subagents',
                    Action: 'kill',
                    ConversationIds: ['conversation-id-abc']
                },
                summary: 'Managing subagents'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('manage_subagents');
            expect((parsed.action as any).Action).toBe('kill');
            expect((parsed.action as any).ConversationIds).toEqual(['conversation-id-abc']);
        });

        it('parses manage_subagents action with empty string Action as null', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'manage_subagents',
                    Action: '',
                    ConversationIds: ['conversation-id-abc']
                },
                summary: 'Managing subagents'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('manage_subagents');
            expect((parsed.action as any).Action).toBeNull();
        });

        it('parses manage_subagents action with trailing space Action as trimmed value', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'manage_subagents',
                    Action: 'list ',
                    ConversationIds: ['conversation-id-abc']
                },
                summary: 'Managing subagents'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('manage_subagents');
            expect((parsed.action as any).Action).toBe('list');
        });

        it('parses action with leading/trailing spaces in type as trimmed type', () => {
            const raw = JSON.stringify({
                action: {
                    type: ' talk_with_user ',
                    content: 'Hello'
                },
                summary: 'Greeting'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('talk_with_user');
        });

        it('coerces Action to null if type is not manage_subagents', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'invoke_subagent',
                    Action: 'invoke_subagent',
                    Recipient: 'subagent',
                    Message: 'do work'
                },
                summary: 'Invoking subagent'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('invoke_subagent');
            expect((parsed.action as any).Action).toBeNull();
        });

        it('repairs and parses truncated json successfully', () => {
            const raw = '{"summary": "Test", "action": {"type": "create_file", "path": "src/foo.ts", "content": "const a = 1;';
            const parsed = parseAgentResponse(raw);
            expect(parsed.summary).toBe('Test');
            expect(parsed.action?.type).toBe('create_file');
            expect(parsed.action?.path).toBe('src/foo.ts');
            expect(parsed.action?.content).toBe('const a = 1;');
        });

        it('repairs and parses truncated json with markdown prefix successfully', () => {
            const raw = 'Here is response:\n```json\n{"summary": "Test", "action": {"type": "create_file", "path": "src/foo.ts", "content": "const a = 1;';
            const parsed = parseAgentResponse(raw);
            expect(parsed.summary).toBe('Test');
            expect(parsed.action?.type).toBe('create_file');
            expect(parsed.action?.path).toBe('src/foo.ts');
            expect(parsed.action?.content).toBe('const a = 1;');
        });



        it('parses wait action correctly', () => {
            const raw = JSON.stringify({
                action: {
                    type: 'wait',
                    duration_seconds: 60
                },
                summary: 'Waiting for updates'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.action?.type).toBe('wait');
            expect((parsed.action as any).duration_seconds).toBe(60);
        });


        it('normalizes commands arrays containing strings', () => {
            const raw = JSON.stringify({
                action: { type: 'talk_with_user', content: 'test' },
                commands: ['npm run test'],
                summary: 'Running test'
            });
            const parsed = parseAgentResponse(raw);
            expect(parsed.commands).toHaveLength(1);
            expect(parsed.commands?.[0].command).toBe('npm run test');
            expect(parsed.commands?.[0].critical).toBe(false);
        });
    });
});
