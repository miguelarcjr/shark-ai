import { describe, it, expect, vi, afterEach } from 'vitest';
import { Connectivity, connectivity } from './connectivity.js';
import dns from 'dns/promises';

// Mock dns
vi.mock('dns/promises');

describe('Connectivity', () => {

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should return true when online', async () => {
        // Mock successful lookup
        vi.mocked(dns.lookup).mockResolvedValue({ address: '1.2.3.4', family: 4 });

        const isOnline = await connectivity.checkConnection();
        expect(isOnline).toBe(true);
    });

    it('should return false when offline (lookup fails)', async () => {
        // Mock lookup error
        vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));

        const isOnline = await connectivity.checkConnection();
        expect(isOnline).toBe(false);
    });

    it('should return false on timeout', async () => {
        // Mock hang
        vi.mocked(dns.lookup).mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 5000));
            return { address: '1.2.3.4', family: 4 };
        });

        const isOnline = await connectivity.checkConnection();
        expect(isOnline).toBe(false);
    }, 10000); // Increase test timeout

    it('requireOnline should pass if online', async () => {
        vi.mocked(dns.lookup).mockResolvedValue({ address: '1.2.3.4', family: 4 });
        await expect(connectivity.requireOnline()).resolves.not.toThrow();
    });

    it('requireOnline should throw if offline', async () => {
        vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
        await expect(connectivity.requireOnline()).rejects.toThrow('Offline Mode Detected');
    });
});
