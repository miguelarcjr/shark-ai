import { tokenStorage } from '../auth/token-storage.js';

export class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthError';
    }
}

interface RequestOptions extends RequestInit {
    params?: Record<string, string>;
}

// API Base URLs
export const STACKSPOT_API_BASE = 'https://api.stackspot.com';
export const STACKSPOT_AGENT_API_BASE = 'https://genai-inference-app.stackspot.com';

export class StackSpotClient {
    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s
    private debugMode = false;

    constructor(private realm: string) { }

    public enableDebug(): void {
        this.debugMode = true;
    }

    private async getHeaders(): Promise<Headers> {
        const token = await tokenStorage.getToken(this.realm);

        if (!token) {
            throw new AuthError(`Authentication required for realm '${this.realm}'.\nPlease run 'shark login' to authenticate.`);
        }

        const headers = new Headers();
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('Content-Type', 'application/json');
        return headers;
    }

    private shouldRetry(error: any, attempt: number): boolean {
        if (attempt >= this.MAX_RETRIES) return false;

        // Retry on network errors
        if (error.name === 'TypeError' || error.message?.includes('fetch')) return true;

        // Retry on 5xx server errors
        if (error.status && error.status >= 500) return true;

        return false;
    }

    private async sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async request<T>(url: string, options: RequestOptions = {}): Promise<T> {
        let lastError: any;

        for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                if (this.debugMode && attempt > 0) {
                    console.log(`[StackSpotClient] Retry attempt ${attempt}/${this.MAX_RETRIES} for ${url}`);
                }

                const headers = await this.getHeaders();

                // Merge custom headers
                if (options.headers) {
                    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
                }

                // Add Query Params
                let finalUrl = url;
                if (options.params) {
                    const query = new URLSearchParams(options.params).toString();
                    finalUrl += `?${query}`;
                }

                if (this.debugMode) {
                    console.log(`[StackSpotClient] ${options.method || 'GET'} ${finalUrl}`);
                }

                const response = await fetch(finalUrl, {
                    ...options,
                    headers,
                });

                if (response.status === 401) {
                    throw new AuthError("Session expired or invalid credentials. Please run 'shark login' again.");
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    const error: any = new Error(`API Request failed: ${response.status} ${response.statusText} - ${errorText}`);
                    error.status = response.status;
                    throw error;
                }

                // Return null for 204 No Content
                if (response.status === 204) {
                    return null as T;
                }

                return (await response.json()) as T;

            } catch (error: any) {
                lastError = error;

                // Don't retry auth errors
                if (error instanceof AuthError) {
                    throw error;
                }

                if (this.shouldRetry(error, attempt)) {
                    const delay = this.RETRY_DELAYS[attempt] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
                    if (this.debugMode) {
                        console.log(`[StackSpotClient] Retrying in ${delay}ms...`);
                    }
                    await this.sleep(delay);
                    continue;
                }

                // No more retries
                throw error;
            }
        }

        throw lastError;
    }

    async get<T>(url: string, options?: RequestOptions): Promise<T> {
        return this.request<T>(url, { ...options, method: 'GET' });
    }

    async post<T>(url: string, body: any, options?: RequestOptions): Promise<T> {
        return this.request<T>(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async put<T>(url: string, body: any, options?: RequestOptions): Promise<T> {
        return this.request<T>(url, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    async delete<T>(url: string, options?: RequestOptions): Promise<T> {
        return this.request<T>(url, { ...options, method: 'DELETE' });
    }
}

export function createAuthenticatedClient(realm: string): StackSpotClient {
    return new StackSpotClient(realm);
}
