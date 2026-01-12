import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StackSpotClient, AuthError } from './stackspot-client.js';
import { tokenStorage } from '../auth/token-storage.js';

vi.mock('../auth/token-storage.js');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('StackSpotClient', () => {
    const realm = 'test-realm';
    let client: StackSpotClient;

    beforeEach(() => {
        vi.resetAllMocks();
        client = new StackSpotClient(realm);
        vi.mocked(tokenStorage.getToken).mockResolvedValue('valid-token');
    });

    it('should inject Authorization header when token exists', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ success: true }),
        });

        await client.get('https://api.example.com/data');

        expect(tokenStorage.getToken).toHaveBeenCalledWith(realm);
        expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining('https://api.example.com/data'),
            expect.objectContaining({
                headers: expect.any(Headers),
            })
        );

        // Check specific header value
        const callArgs = mockFetch.mock.calls[0];
        const headers = callArgs[1].headers as Headers;
        expect(headers.get('Authorization')).toBe('Bearer valid-token');
    });

    it('should throw AuthError if token is missing', async () => {
        vi.mocked(tokenStorage.getToken).mockResolvedValue(null);

        await expect(client.get('https://api.example.com')).rejects.toThrow(AuthError);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw AuthError on 401 response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Unauthorized',
        });

        await expect(client.get('https://api.example.com')).rejects.toThrow(/Session expired/);
    });

    it('should parse JSON response on success', async () => {
        const mockData = { id: 1, name: 'Test' };
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => mockData,
        });

        const result = await client.get('https://api.example.com');
        expect(result).toEqual(mockData);
    });

    it('should retry on network errors up to 3 times', async () => {
        vi.useFakeTimers();
        // Simulate network failures then success
        mockFetch
            .mockRejectedValueOnce(new TypeError('Network error'))
            .mockRejectedValueOnce(new TypeError('Network error'))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true }),
            });

        const promise = client.get('https://api.example.com');
        await vi.runAllTimersAsync();
        await vi.runAllTimersAsync();

        const result = await promise;

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(result).toEqual({ success: true });
        vi.useRealTimers();
    });

    it('should retry on 5xx server errors', async () => {
        vi.useFakeTimers();
        const error500 = new Error('Internal Server Error');
        (error500 as any).status = 500;

        mockFetch
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                text: async () => 'Server Error',
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true }),
            });

        const promise = client.get('https://api.example.com');
        await vi.runAllTimersAsync();

        const result = await promise;

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ success: true });
        vi.useRealTimers();
    });

    it('should not retry on AuthError', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Unauthorized',
        });

        await expect(client.get('https://api.example.com')).rejects.toThrow(AuthError);
        expect(mockFetch).toHaveBeenCalledTimes(1); // No retry
    });

    it('should fail after max retries', async () => {
        vi.useFakeTimers();
        mockFetch.mockRejectedValue(new TypeError('Network error'));

        // Create the expectation promise first (attaches error handler)
        const assertion = expect(client.get('https://api.example.com')).rejects.toThrow('Network error');

        // Fast-forward through retries while the assertion waits
        await vi.runAllTimersAsync();

        // Await the assertion result
        await assertion;

        // Initial attempt + 3 retries = 4 total calls
        expect(mockFetch).toHaveBeenCalledTimes(4);
        vi.useRealTimers();
    });
});
