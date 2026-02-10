import { AxiosInstance } from 'axios';
import { createAuthenticatedClient } from './auth';
import { getLogger } from '../utils/logger';

export class PyroscopeClient {
    private client: AxiosInstance;
    private logger: ReturnType<typeof getLogger>;

    constructor(serverUrl: string, authToken?: string) {
        this.client = createAuthenticatedClient(serverUrl, {
            token: authToken,
        });
        this.logger = getLogger();
    }

    /**
     * Get list of applications from Pyroscope
     */
    async getApplications(): Promise<string[]> {
        const url = '/api/apps';
        this.logger.debug(`GET ${url}`);

        try {
            const response = await this.client.get(url);
            this.logger.debug(`Response: ${response.status} ${response.statusText}`);

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
            this.logger.error(`GET ${url} failed: ${error.message}`);

            if (error.response) {
                this.logger.error(`  Status: ${error.response.status}`);
                this.logger.error(`  Data: ${JSON.stringify(error.response.data)}`);
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

            const url = `/render?query=${query}&from=${from}&until=${now}&format=pprof`;
            this.logger.debug(`GET ${url}`);

            const response = await this.client.get('/render', {
                params: {
                    query,
                    from,
                    until: now,
                    format: 'pprof',
                },
                responseType: 'arraybuffer',
            });

            this.logger.debug(`Response: ${response.status}, ${response.data.length} bytes`);

            return Buffer.from(response.data);
        } catch (error: any) {
            this.logger.error(`GET /render failed: ${error.message}`);

            if (error.response) {
                this.logger.error(`  Status: ${error.response.status}`);

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
