import { ConfigManager } from '../config-manager.js';

/**
 * Gets the currently active (logged-in) realm from config.
 * 
 * @returns The active realm
 * @throws Error if no realm is active (user not logged in)
 */
export async function getActiveRealm(): Promise<string> {
    const configManager = ConfigManager.getInstance();
    const config = configManager.getConfig();
    const realm = config.activeRealm;

    if (!realm) {
        throw new Error(
            'No active authentication found.\n' +
            'Please run "shark login" first to authenticate.'
        );
    }

    return realm;
}
