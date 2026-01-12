export interface AuthToken {
    access_token: string;
    expires_in: number;
    token_type: string;
    // Optional fields that might come back but we assume minimal need
    refresh_token?: string;
    scope?: string;
}
