import fs from 'fs';
import path from 'path';
import os from 'os';
import { colors } from '../../ui/colors.js';

const SHARK_DIR = '.shark-ai';
const CREDENTIALS_FILE = 'credentials.json';

interface Credentials {
    clientId?: string;
    clientKey?: string;
    accessToken: string;
    expiresAt?: number;
}

type CredentialsMap = Record<string, Credentials>;

/**
 * Manages secure storage of authentication tokens using a local file with restricted permissions.
 * Replaces the native keytar dependency for better compatibility.
 */
export const tokenStorage = {
    /**
     * Get the secure file path
     */
    getFilePath(): string {
        const homeDir = os.homedir();
        const sharkDir = path.join(homeDir, SHARK_DIR);

        // Ensure directory exists with 700 permissions
        if (!fs.existsSync(sharkDir)) {
            fs.mkdirSync(sharkDir, { mode: 0o700 });
        }

        return path.join(sharkDir, CREDENTIALS_FILE);
    },

    /**
     * Reads the credentials file safely
     */
    readCredentials(): CredentialsMap {
        const filePath = this.getFilePath();
        try {
            if (!fs.existsSync(filePath)) {
                return {};
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            return {};
        }
    },

    /**
     * Save credentials to file with 600 permissions
     */
    writeCredentials(creds: CredentialsMap): void {
        const filePath = this.getFilePath();
        try {
            fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
        } catch (error: any) {
            throw new Error(`Failed to save credentials to ${filePath}: ${error.message}`);
        }
    },

    /**
     * Saves the access token (and optional client credentials) for the given realm.
     */
    async saveToken(realm: string, token: string, clientId?: string, clientKey?: string, expiresIn?: number): Promise<void> {
        const creds = this.readCredentials();

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = expiresIn ? now + expiresIn : undefined;

        creds[realm] = {
            ...creds[realm], // Preserve existing data if any
            accessToken: token,
            ...(clientId && { clientId }),
            ...(clientKey && { clientKey }),
            ...(expiresAt && { expiresAt })
        };

        this.writeCredentials(creds);
    },

    /**
     * Retrieves the access token for the given realm.
     * Checks ENV var first (SHARK_ACCESS_TOKEN).
     */
    async getToken(realm: string): Promise<string | null> {
        // Priority: Environment Variable (CI/CD)
        if (process.env.SHARK_ACCESS_TOKEN) {
            return process.env.SHARK_ACCESS_TOKEN;
        }

        const creds = this.readCredentials();
        const realmCreds = creds[realm];

        if (!realmCreds) return null;

        // Check expiration logic could go here, but for now just return the token
        // The auth layer should handle refresh if token is expired/invalid
        return realmCreds.accessToken;
    },

    /**
     * Retrieves full credentials object (for refresh logic)
     */
    async getCredentials(realm: string): Promise<Credentials | null> {
        const creds = this.readCredentials();
        return creds[realm] || null;
    },

    /**
     * Deletes the access token/credentials for the given realm.
     */
    async deleteToken(realm: string): Promise<boolean> {
        const creds = this.readCredentials();
        if (creds[realm]) {
            delete creds[realm];
            this.writeCredentials(creds);
            return true;
        }
        return false;
    }
};
