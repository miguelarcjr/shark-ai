import dns from 'dns/promises';
import { colors } from '../../ui/colors.js';

export class Connectivity {
    private static instance: Connectivity;
    // Common reliable host to check connectivity
    private readonly CHECK_HOST = 'google.com';
    private readonly TIMEOUT_MS = 3000;

    private constructor() { }

    public static getInstance(): Connectivity {
        if (!Connectivity.instance) {
            Connectivity.instance = new Connectivity();
        }
        return Connectivity.instance;
    }

    /**
     * Checks if the user has internet connection.
     * Uses DNS lookup which is generally faster and lighter than a full fetch.
     */
    public async checkConnection(): Promise<boolean> {
        try {
            // Promise.race to enforce timeout
            await Promise.race([
                dns.lookup(this.CHECK_HOST),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('timeout')), this.TIMEOUT_MS)
                )
            ]);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Throws an error if the user is offline.
     * Use this as a guard at the start of online-only commands.
     */
    public async requireOnline(): Promise<void> {
        const isOnline = await this.checkConnection();
        if (!isOnline) {
            throw new Error(`⚠️  ${colors.bold('Offline Mode Detected')}\n   This command requires an active internet connection.\n   Please check your network and try again.`);
        }
    }
}

export const connectivity = Connectivity.getInstance();
