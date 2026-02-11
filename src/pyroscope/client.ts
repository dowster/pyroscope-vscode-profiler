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
     * Get list of service names from Pyroscope (Grafana Pyroscope uses gRPC-gateway)
     */
    async getApplications(): Promise<string[]> {
        // Strip /pyroscope suffix if present - gRPC endpoints are at root
        const baseUrl = this.client.defaults.baseURL || '';
        const grpcBaseUrl = baseUrl.replace(/\/pyroscope\/?$/, '');

        const url = '/querier.v1.QuerierService/LabelValues';
        this.logger.debug(`POST ${grpcBaseUrl}${url}`);

        try {
            const response = await this.client.post(
                url,
                {
                    name: 'service_name',
                },
                {
                    baseURL: grpcBaseUrl,
                }
            );
            this.logger.debug(`Response: ${response.status} ${response.statusText}`);

            // Response format: {"names": ["service1", "service2", ...]}
            if (response.data && Array.isArray(response.data.names)) {
                this.logger.info(`Found ${response.data.names.length} services`);
                return response.data.names;
            }

            this.logger.warn('Unexpected response format from LabelValues');
            return [];
        } catch (error: any) {
            this.logger.error(`POST ${url} failed: ${error.message}`);

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
     * @param appName - Service name to query
     * @param durationSeconds - Time range in seconds (from now back)
     * @param profileType - Type of profile (process_cpu, memory, etc.)
     */
    async fetchProfile(
        appName: string,
        durationSeconds: number = 3600,
        profileType: string = 'process_cpu'
    ): Promise<Buffer> {
        try {
            const now = Math.floor(Date.now() / 1000);
            const from = now - durationSeconds;

            // Construct Grafana Pyroscope query format:
            // <profile_type_id>{label="value"}
            // Example: process_cpu:cpu:nanoseconds:cpu:nanoseconds{service_name="my-service"}
            const profileTypeId = this.getProfileTypeId(profileType);
            const query = `${profileTypeId}{service_name="${appName}"}`;

            const url = `/pyroscope/render?query=${encodeURIComponent(query)}&from=${from}&until=${now}&format=pprof`;
            this.logger.debug(`GET ${url}`);

            const response = await this.client.get('/pyroscope/render', {
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
            this.logger.error(`GET /pyroscope/render failed: ${error.message}`);

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
     * Map profile type shorthand to full profile type ID
     */
    private getProfileTypeId(profileType: string): string {
        // Map common profile types to their full IDs
        const typeMap: Record<string, string> = {
            cpu: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
            process_cpu: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
            memory: 'memory:alloc_space:bytes:space:bytes',
            alloc_space: 'memory:alloc_space:bytes:space:bytes',
            alloc_objects: 'memory:alloc_objects:count:space:bytes',
            inuse_space: 'memory:inuse_space:bytes:space:bytes',
            inuse_objects: 'memory:inuse_objects:count:space:bytes',
            goroutine: 'goroutine:goroutine:count:goroutine:count',
            block: 'block:contentions:count:contentions:count',
            mutex: 'mutex:contentions:count:contentions:count',
        };

        return typeMap[profileType] || typeMap['cpu'];
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
