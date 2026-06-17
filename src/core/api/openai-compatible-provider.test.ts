import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible-provider.js';
import { HistoryManager, ChatMessage } from '../workflow/history-manager.js';

function createMockStream(chunks: string[]) {
    let index = 0;
    const encoder = new TextEncoder();
    return {
        getReader() {
            return {
                async read() {
                    if (index < chunks.length) {
                        const chunk = chunks[index++];
                        return { done: false, value: encoder.encode(chunk) };
                    }
                    return { done: true, value: undefined };
                }
            };
        }
    };
}

describe('OpenAICompatibleProvider', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('should be instantiable with parameters', () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });
        expect(provider).toBeDefined();
    });

    it('should fetch response from the endpoint, process chunks and return parsed response', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });

        const mockHistoryGet = vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue([]);
        const mockHistorySave = vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const chunks = [
            'data: {"choices": [{"delta": {"content": "{\\"actions\\": "}}]}\n',
            'data: {"choices": [{"delta": {"content": "[{\\"type\\": \\"talk_with_user\\", \\"content\\": \\"Hello!\\", \\"path\\": \\"\\"}]"}}]}\n',
            'data: {"choices": [{"delta": {"content": ", \\"summary\\": \\"Greeting\\"}"}}]}\n',
            'data: [DONE]\n'
        ];

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createMockStream(chunks)
        });
        vi.stubGlobal('fetch', mockFetch);

        const onChunk = vi.fn();
        const onComplete = vi.fn();

        const response = await provider.streamChat('Hello', {
            conversationId: 'test-convo-123',
            agentType: 'developer_agent',
            onChunk,
            onComplete
        });

        expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', expect.any(Object));
        
        // check headers
        const fetchArgs = mockFetch.mock.calls[0];
        const fetchOptions = fetchArgs[1];
        expect(fetchOptions.headers).toEqual({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ollama'
        });

        // check payload
        const payload = JSON.parse(fetchOptions.body);
        expect(payload.model).toBe('llama3');
        expect(payload.stream).toBe(true);
        expect(payload.messages[1]).toEqual({ role: 'user', content: 'Hello' });

        // check result
        expect(response.actions).toEqual([{ type: 'talk_with_user', content: 'Hello!', path: '' }]);
        expect(response.summary).toBe('Greeting');

        expect(onChunk).toHaveBeenCalled();
        expect(onComplete).toHaveBeenCalledWith(response);
    });

    it('should use json_schema response_format when useStructuredOutputs is true', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: true
        });

        vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue([]);
        vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createMockStream([
                'data: {"choices": [{"delta": {"content": "{\\"actions\\": [], \\"summary\\": \\"ok\\"}"}}]}\n',
                'data: [DONE]\n'
            ])
        });
        vi.stubGlobal('fetch', mockFetch);

        await provider.streamChat('test', {
            agentType: 'developer_agent'
        });

        const fetchOptions = mockFetch.mock.calls[0][1];
        const payload = JSON.parse(fetchOptions.body);
        expect(payload.response_format).toEqual({
            type: 'json_schema',
            json_schema: {
                name: 'agent_response',
                strict: true,
                schema: expect.any(Object)
            }
        });
    });

    it('should load history and send full message history', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });

        const mockHistory: ChatMessage[] = [
            { role: 'system', content: 'You are the Developer Agent...' },
            { role: 'user', content: 'Initial setup' },
            { role: 'assistant', content: '{"actions":[],"summary":"Done"}' }
        ];

        const mockHistoryGet = vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue(mockHistory);
        const mockHistorySave = vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createMockStream([
                'data: {"choices": [{"delta": {"content": "{\\"actions\\": [], \\"summary\\": \\"ok\\"}"}}]}\n',
                'data: [DONE]\n'
            ])
        });
        vi.stubGlobal('fetch', mockFetch);

        await provider.streamChat('Next step', {
            conversationId: 'test-convo-123',
            agentType: 'developer_agent'
        });

        expect(mockHistoryGet).toHaveBeenCalledWith('test-convo-123');
        const fetchOptions = mockFetch.mock.calls[0][1];
        const payload = JSON.parse(fetchOptions.body);
        
        // The messages array in payload should contain history + new user message
        expect(payload.messages).toHaveLength(4);
        expect(payload.messages[0]).toEqual({ role: 'system', content: 'You are the Developer Agent...' });
        expect(payload.messages[1]).toEqual({ role: 'user', content: 'Initial setup' });
        expect(payload.messages[2]).toEqual({ role: 'assistant', content: '{"actions":[],"summary":"Done"}' });
        expect(payload.messages[3]).toEqual({ role: 'user', content: 'Next step' });

        // Save history should have been called with the updated array including the assistant's response
        const lastCall = mockHistorySave.mock.calls[0];
        expect(lastCall[0]).toBe('test-convo-123');
        expect(lastCall[1]).toHaveLength(5);
        expect(lastCall[1][3]).toEqual({ role: 'user', content: 'Next step' });
        expect(lastCall[1][4].role).toBe('assistant');
        const parsedSavedResponse = JSON.parse(lastCall[1][4].content);
        expect(parsedSavedResponse.summary).toBe('ok');
    });

    it('should throw an error when API request fails', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });

        vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue([]);
        vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => 'Invalid parameter'
        });
        vi.stubGlobal('fetch', mockFetch);

        await expect(
            provider.streamChat('test', { agentType: 'developer_agent' })
        ).rejects.toThrow('OpenAI API request failed: 400 Bad Request - Invalid parameter');
    });

    it('should not include Authorization header if apiKey is empty', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: '',
            model: 'llama3',
            useStructuredOutputs: false
        });

        vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue([]);
        vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createMockStream([
                'data: {"choices": [{"delta": {"content": "{\\"actions\\": [], \\"summary\\": \\"ok\\"}"}}]}\n',
                'data: [DONE]\n'
            ])
        });
        vi.stubGlobal('fetch', mockFetch);

        await provider.streamChat('test', { agentType: 'developer_agent' });

        const fetchOptions = mockFetch.mock.calls[0][1];
        expect(fetchOptions.headers.Authorization).toBeUndefined();
    });

    it('should generate custom system prompt based on agentType', async () => {
        const provider = new OpenAICompatibleProvider({
            baseURL: 'http://localhost:11434/v1',
            apiKey: 'ollama',
            model: 'llama3',
            useStructuredOutputs: false
        });

        vi.spyOn(HistoryManager, 'getHistory').mockResolvedValue([]);
        vi.spyOn(HistoryManager, 'saveHistory').mockResolvedValue(undefined);

        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            body: createMockStream([
                'data: {"choices": [{"delta": {"content": "{\\"actions\\": [], \\"summary\\": \\"ok\\"}"}}]}\n',
                'data: [DONE]\n'
            ])
        });
        vi.stubGlobal('fetch', mockFetch);

        await provider.streamChat('test', { agentType: 'business_analyst' });

        const fetchOptions = mockFetch.mock.calls[0][1];
        const payload = JSON.parse(fetchOptions.body);
        expect(payload.messages[0].content).toContain('Business Analyst Agent');
    });
});
