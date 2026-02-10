import { AxiosInstance } from 'axios';
import { createAuthenticatedClient } from './auth';

export class PyroscopeClient {
    private client: AxiosInstance;

    constructor(serverUrl: string, authToken?: string) {
        this.client = createAuthenticatedClient(serverUrl, {
            token: authToken,
        });
    }

    /**
     * Get list of applications from Pyroscope
     */
    async getApplications(): Promise<string[]> {
        try {
            const response = await this.client.get('/api/apps');

            // Handle different response formats
            if (Array.isArray(response.data)) {
                return response.data;
            } else if (response.data && Array.isArray(response.data.apps)) {
                return response.data.apps;
            } else if (response.data && typeof response.data === 'object') {
                // Sometimes apps are returned as object keys
                return Object.keys(response.data);
            }

            return [];
        } catch (error: any) {
            if (error.response) {
                throw new Error(
                    `Pyroscope API error: ${error.response.status} ${error.response.statusText}`
                );
            } else if (error.request) {
                throw new Error(
                    'Failed to connect to Pyroscope server. Please check the URL and network connection.'
                );
            } else {
                throw new Error(`Request error: ${error.message}`);
            }
        }
    }

    /**
     * Fetch a profile from Pyroscope
     * @param appName - Application name
     * @param durationSeconds - Time range in seconds (from now back)
     * @param profileType - Type of profile (cpu, alloc_space, etc.)
     */
    async fetchProfile(
        appName: string,
        durationSeconds: number = 3600,
        profileType: string = 'cpu'
    ): Promise<Buffer> {
        try {
            const now = Math.floor(Date.now() / 1000);
            const from = now - durationSeconds;

            // Construct query
            const query = `${appName}`;

            const response = await this.client.get('/render', {
                params: {
                    query,
                    from,
                    until: now,
                    format: 'pprof',
                },
                responseType: 'arraybuffer',
            });

            return Buffer.from(response.data);
        } catch (error: any) {
            if (error.response) {
                // Try to parse error message from response
                let errorMsg = `${error.response.status} ${error.response.statusText}`;
                try {
                    const text = Buffer.from(error.response.data).toString('utf-8');
                    if (text) {
                        errorMsg += `: ${text}`;
                    }
                } catch (e) {
                    // Ignore parsing errors
                }
                throw new Error(`Failed to fetch profile: ${errorMsg}`);
            } else if (error.request) {
                throw new Error('Failed to connect to Pyroscope server');
            } else {
                throw new Error(`Request error: ${error.message}`);
            }
        }
    }

    /**
     * Test connection to Pyroscope server
     */
    async testConnection(): Promise<boolean> {
        try {
            await this.client.get('/');
            return true;
        } catch (error) {
            return false;
        }
    }
}
