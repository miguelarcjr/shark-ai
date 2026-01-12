import { AuthToken } from './types.js';

/**
 * Authenticates with StackSpot IDM using Client Credentials flow.
 * 
 * @param realm The account realm (slug).
 * @param clientId The Client ID.
 * @param clientSecret The Client Secret.
 * @returns Promise resolving to the AuthToken.
 * @throws Error if authentication fails.
 */
export async function authenticate(realm: string, clientId: string, clientSecret: string): Promise<AuthToken> {
    const url = `https://idm.stackspot.com/${realm}/oidc/oauth/token`;

    const body = new URLSearchParams();
    body.append('grant_type', 'client_credentials');
    body.append('client_id', clientId);
    body.append('client_secret', clientSecret);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: body,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = (await response.json()) as AuthToken;
        return data;
    } catch (error: any) {
        // Wrap network errors or other failures
        if (error instanceof Error) {
            throw new Error(`Failed to authenticate with StackSpot: ${error.message}`);
        }
        throw error;
    }
}
