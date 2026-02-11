import { AxiosInstance } from 'axios';
import { createAuthenticatedClient } from './auth';
import { getLogger, shouldLogDebug } from '../utils/logger';
import * as protobuf from 'protobufjs';
import * as path from 'path';

export interface ProfileType {
    id: string;
    name: string;
    sampleType: string;
    sampleUnit: string;
    periodType: string;
    periodUnit: string;
}

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
     * Get label values from Pyroscope
     * @param labelName - The label name to query (e.g., "service_name", "deployment_environment")
     * @returns Array of label values
     */
    async getLabelValues(labelName: string): Promise<string[]> {
        // Strip /pyroscope suffix if present - gRPC endpoints are at root
        const baseUrl = this.client.defaults.baseURL || '';
        const grpcBaseUrl = baseUrl.replace(/\/pyroscope\/?$/, '');

        const url = '/querier.v1.QuerierService/LabelValues';
        if (shouldLogDebug()) {
            this.logger.debug(`POST ${grpcBaseUrl}${url} (label: ${labelName})`);
        }

        try {
            const response = await this.client.post(
                url,
                {
                    name: labelName,
                },
                {
                    baseURL: grpcBaseUrl,
                }
            );
            if (shouldLogDebug()) {
                this.logger.debug(`Response: ${response.status} ${response.statusText}`);
            }

            // Response format: {"names": ["value1", "value2", ...]}
            if (response.data && Array.isArray(response.data.names)) {
                this.logger.info(`Found ${response.data.names.length} values for ${labelName}`);
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
     * Get list of service names from Pyroscope (Grafana Pyroscope uses gRPC-gateway)
     */
    async getApplications(): Promise<string[]> {
        return this.getLabelValues('service_name');
    }

    /**
     * Get list of deployment environments from Pyroscope
     */
    async getEnvironments(): Promise<string[]> {
        return this.getLabelValues('deployment_environment');
    }

    /**
     * Fetch a profile from Pyroscope using the gRPC-gateway endpoint
     * @param appName - Service name to query
     * @param durationSeconds - Time range in seconds (from now back)
     * @param profileType - Type of profile (process_cpu, memory, etc.)
     * @param environment - Optional deployment environment to filter by
     */
    async fetchProfile(
        appName: string,
        durationSeconds: number = 3600,
        profileType: string = 'process_cpu',
        environment?: string
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

            // Build label selector with service_name and optional environment
            let labelSelector = `{service_name="${appName}"`;
            if (environment) {
                labelSelector += `,deployment_environment="${environment}"`;
            }
            labelSelector += '}';

            if (shouldLogDebug()) {
                this.logger.debug(`Label selector: ${labelSelector}`);
            }

            // Create and encode the request message as protobuf binary
            // Note: Field names must match proto exactly when using keepCase: true
            const requestMessage = selectMergeProfileRequest.create({
                profile_typeID: profileTypeId,
                label_selector: labelSelector,
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
     * Get available profile types for a time range
     * @param startTime - Start time in seconds (unix timestamp)
     * @param endTime - End time in seconds (unix timestamp)
     * @returns Array of available profile types
     */
    async getProfileTypes(startTime: number, endTime: number): Promise<ProfileType[]> {
        try {
            // Strip /pyroscope suffix if present - gRPC endpoints are at root
            const baseUrl = this.client.defaults.baseURL || '';
            const grpcBaseUrl = baseUrl.replace(/\/pyroscope\/?$/, '');

            const url = '/querier.v1.QuerierService/ProfileTypes';
            if (shouldLogDebug()) {
                this.logger.debug(`POST ${grpcBaseUrl}${url}`);
                this.logger.debug(`Request: start=${startTime * 1000}, end=${endTime * 1000}`);
            }

            // Load protobuf definition
            const protoRoot = path.join(__dirname, '../../proto');
            const root = new protobuf.Root();
            root.resolvePath = (_origin: string, target: string) => {
                if (path.isAbsolute(target)) {
                    return target;
                }
                return path.join(protoRoot, target);
            };

            await root.load('querier/v1/querier.proto', { keepCase: true });
            const requestType = root.lookupType('querier.v1.ProfileTypesRequest');
            const responseType = root.lookupType('querier.v1.ProfileTypesResponse');

            // Create and encode request
            const requestMessage = requestType.create({
                start: startTime * 1000, // Convert to milliseconds
                end: endTime * 1000,
            });
            const requestBuffer = requestType.encode(requestMessage).finish();

            if (shouldLogDebug()) {
                this.logger.debug(`Request size: ${requestBuffer.length} bytes (protobuf)`);
            }

            // Make request
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

            // Decode response
            const responseMessage = responseType.decode(new Uint8Array(response.data));
            const responseObj = responseMessage.toJSON();
            const profileTypes = (responseObj.profile_types || []) as any[];

            if (shouldLogDebug()) {
                this.logger.debug(`Found ${profileTypes.length} profile types`);
            }

            // Parse and return profile types
            return profileTypes.map((pt: any) => ({
                id: pt.ID || '',
                name: pt.name || '',
                sampleType: pt.sample_type || '',
                sampleUnit: pt.sample_unit || '',
                periodType: pt.period_type || '',
                periodUnit: pt.period_unit || '',
            }));
        } catch (error: any) {
            this.logger.error(
                `POST /querier.v1.QuerierService/ProfileTypes failed: ${error.message}`
            );

            if (error.response) {
                this.logger.error(`  Status: ${error.response.status}`);
                throw new Error(`Failed to fetch profile types: ${error.response.status}`);
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
