import axios, { AxiosInstance } from 'axios';

export interface AuthConfig {
    token?: string;
    username?: string;
    password?: string;
}

/**
 * Creates an axios instance with authentication configured
 */
export function createAuthenticatedClient(baseURL: string, authConfig: AuthConfig): AxiosInstance {
    const config: any = {
        baseURL,
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    // Add authentication
    if (authConfig.token) {
        config.headers['Authorization'] = `Bearer ${authConfig.token}`;
    } else if (authConfig.username && authConfig.password) {
        config.auth = {
            username: authConfig.username,
            password: authConfig.password
        };
    }

    return axios.create(config);
}
