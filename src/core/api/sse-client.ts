import { FileLogger } from '../debug/file-logger.js';

export interface SSECallbacks {
    onChunk?: (partialMessage: string) => void;
    onComplete?: (fullMessage: string, metadata?: any) => void;
    onError?: (error: Error) => void;
}

export class SSEClient {
    /**
     * Streams agent response using Server-Sent Events.
     * 
     * @param url - The SSE endpoint URL
     * @param requestPayload - The request payload to POST
     * @param headers - Request headers (including Authorization)
     * @param callbacks - Event callbacks for chunks, completion, and errors
     */
    async streamAgentResponse(
        url: string,
        requestPayload: unknown,
        headers: HeadersInit,
        callbacks: SSECallbacks = {}
    ): Promise<void> {
        const { onChunk, onComplete, onError } = callbacks;

        FileLogger.log('SSE', `Starting Request to ${url}`, {
            headers,
            payload: requestPayload
        });

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestPayload),
            });

            FileLogger.log('SSE', `Response Status: ${response.status} ${response.statusText}`);

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            FileLogger.log('SSE', 'Response Headers', responseHeaders);

            if (!response.ok) {
                const errorText = await response.text();
                FileLogger.log('SSE', 'Response Error Body', errorText);
                throw new Error(`SSE request failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            if (!response.body) {
                throw new Error('Response body is null');
            }

            const contentType = response.headers.get('content-type') || '';
            const isJson = contentType.includes('application/json');

            if (isJson) {
                // Handle non-streaming JSON response properly
                const jsonBody = await response.json();
                FileLogger.log('SSE', 'Received Non-Streaming JSON Response', { length: JSON.stringify(jsonBody).length });

                // Try to extract message content depending on structure
                let content = '';
                if (typeof jsonBody === 'string') content = jsonBody;
                else if (jsonBody.message) content = jsonBody.message;
                else if (jsonBody.choices?.[0]?.message?.content) content = jsonBody.choices[0].message.content; // OpenAI style just in case
                else content = JSON.stringify(jsonBody); // Fallback to raw JSON

                // Trigger callbacks as if it streamed in one chunk
                if (onChunk) onChunk(content);
                if (onComplete) onComplete(content, jsonBody);
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullMessage = '';
            let metadata: any = {};

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                // Decode chunk
                buffer += decoder.decode(value, { stream: true });

                // Process complete lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim(); // Remove 'data:' prefix

                        if (data === '[DONE]') {
                            FileLogger.log('SSE', 'Stream Complete [DONE]', { fullMessage, metadata });
                            // End of stream
                            if (onComplete) {
                                onComplete(fullMessage, metadata);
                            }
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const chunk = parsed.message || parsed.content || data;
                            fullMessage += chunk;

                            // Capture latest metadata (e.g. conversation_id)
                            if (parsed.conversation_id) {
                                metadata.conversation_id = parsed.conversation_id;
                            }

                            if (onChunk) {
                                onChunk(chunk);
                            }
                        } catch (parseError) {
                            // Not JSON, treat as plain text
                            fullMessage += data;
                            if (onChunk) {
                                onChunk(data);
                            }
                        }
                    }
                }
            }

            FileLogger.log('SSE', 'Stream Ended Naturally', { fullMessage, metadata });

            // Stream ended without [DONE]
            if (onComplete) {
                onComplete(fullMessage, metadata);
            }

        } catch (error) {
            FileLogger.log('SSE', 'Stream Error', error);
            if (onError) {
                onError(error instanceof Error ? error : new Error(String(error)));
            } else {
                throw error;
            }
        }
    }
}

export const sseClient = new SSEClient();
