import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticate } from './stackspot-auth.js';

describe('StackSpot Auth', () => {

    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
        global.fetch = mockFetch;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return token on successful authentication', async () => {
        const mockToken = {
            access_token: 'fake-token',
            expires_in: 3600,
            token_type: 'Bearer'
        };

        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => mockToken
        });

        const token = await authenticate('my-realm', 'id', 'secret');
        expect(token).toEqual(mockToken);

        // updates verify body params
        const calledUrl = mockFetch.mock.calls[0][0];
        const calledOptions = mockFetch.mock.calls[0][1];
        expect(calledUrl).toContain('my-realm');
        expect(calledOptions.method).toBe('POST');
        expect(calledOptions.body.toString()).toContain('grant_type=client_credentials');
    });

    it('should throw error on failed authentication', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            text: async () => 'Invalid credentials'
        });

        await expect(authenticate('realm', 'id', 'secret')).rejects.toThrow('Authentication failed: 401 Unauthorized');
    });

    it('should throw error on network failure', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'));
        await expect(authenticate('realm', 'id', 'secret')).rejects.toThrow('Failed to authenticate with StackSpot: Network error');
    });
});
