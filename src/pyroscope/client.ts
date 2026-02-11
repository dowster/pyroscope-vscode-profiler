import { AxiosInstance } from 'axios';
import { createAuthenticatedClient } from './auth';
import { getLogger, shouldLogDebug } from '../utils/logger';
import * as protobuf from 'protobufjs';
import * as path from 'path';

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
        if (shouldLogDebug()) {
            this.logger.debug(`POST ${grpcBaseUrl}${url}`);
        }

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
            if (shouldLogDebug()) {
                this.logger.debug(`Response: ${response.status} ${response.statusText}`);
            }

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
     * Fetch a profile from Pyroscope using the gRPC-gateway endpoint
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

            // Get the profile type ID
            const profileTypeId = this.getProfileTypeId(profileType);

            // Strip /pyroscope suffix if present - gRPC endpoints are at root
            const baseUrl = this.client.defaults.baseURL || '';
            const grpcBaseUrl = baseUrl.replace(/\/pyroscope\/?$/, '');

            const url = '/querier.v1.QuerierService/SelectMergeProfile';
            if (shouldLogDebug()) {
                this.logger.debug(`POST ${grpcBaseUrl}${url}`);
                this.logger.debug(
                    `Request: service_name="${appName}", profile=${profileTypeId}, range=${from}-${now}`
                );
            }

            // Load the protobuf definition for SelectMergeProfileRequest
            const protoRoot = path.join(__dirname, '../../proto');

            // Create a custom Root with resolvePath to handle imports correctly
            const root = new protobuf.Root();
            root.resolvePath = (_origin: string, target: string) => {
                // If target is already an absolute path, return as-is
                if (path.isAbsolute(target)) {
                    return target;
                }
                // Otherwise, resolve imports relative to the proto root directory
                return path.join(protoRoot, target);
            };

            // Use relative path from proto root for the initial load
            await root.load('querier/v1/querier.proto', { keepCase: true });
            const selectMergeProfileRequest = root.lookupType(
                'querier.v1.SelectMergeProfileRequest'
            );

            // Create and encode the request message as protobuf binary
            // Note: Field names must match proto exactly when using keepCase: true
            const requestMessage = selectMergeProfileRequest.create({
                profile_typeID: profileTypeId,
                label_selector: `{service_name="${appName}"}`,
                start: from * 1000, // Convert to milliseconds
                end: now * 1000,
                max_nodes: 8192, // Sufficient for detailed profiles
            });

            const requestBuffer = selectMergeProfileRequest.encode(requestMessage).finish();
            if (shouldLogDebug()) {
                this.logger.debug(`Request size: ${requestBuffer.length} bytes (protobuf)`);
            }

            // Use the official gRPC-gateway endpoint for SelectMergeProfile
            // Send protobuf-encoded request, receive protobuf-encoded pprof response
            const response = await this.client.post(url, Buffer.from(requestBuffer), {
                baseURL: grpcBaseUrl,
                responseType: 'arraybuffer',
                headers: {
                    'Content-Type': 'application/proto',
                },
            });

            if (shouldLogDebug()) {
                this.logger.debug(`Response: ${response.status}, ${response.data.length} bytes`);
            }

            return Buffer.from(response.data);
        } catch (error: any) {
            this.logger.error(
                `POST /querier.v1.QuerierService/SelectMergeProfile failed: ${error.message}`
            );

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
