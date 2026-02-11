import * as vscode from 'vscode';
import { ProfileMetrics, FileMetrics } from '../parser/sourceMapper';

export interface ProfileInfo {
    name: string;
    timestamp: string;
}

export interface ProfileEntry {
    name: string;
    typeId: string;
    sampleType: string;
    unit: string;
    metrics: ProfileMetrics;
}

export class ProfileStore {
    private profiles: Map<string, ProfileEntry> = new Map();
    private profileInfo: ProfileInfo | null = null;
    private changeEmitter = new vscode.EventEmitter<void>();

    public readonly onProfileChanged = this.changeEmitter.event;

    /**
     * Load new profile data (legacy method for backward compatibility)
     */
    public loadProfile(metrics: ProfileMetrics, name: string): void {
        // Convert single profile to multi-profile format with "cpu" as default type
        const entry: ProfileEntry = {
            name: 'cpu',
            typeId: 'process_cpu:cpu:nanoseconds:cpu:nanoseconds',
            sampleType: 'cpu',
            unit: 'nanoseconds',
            metrics,
        };
        this.profiles.clear();
        this.profiles.set('cpu', entry);
        this.profileInfo = {
            name,
            timestamp: new Date().toISOString(),
        };
        this.changeEmitter.fire();
    }

    /**
     * Load multiple profile entries
     */
    public loadProfiles(entries: ProfileEntry[], sessionName: string): void {
        this.profiles.clear();
        entries.forEach((entry) => {
            this.profiles.set(entry.name, entry);
        });
        this.profileInfo = {
            name: sessionName,
            timestamp: new Date().toISOString(),
        };
        this.changeEmitter.fire();
    }

    /**
     * Clear all profile data
     */
    public clearProfile(): void {
        this.profiles.clear();
        this.profileInfo = null;
        this.changeEmitter.fire();
    }

    /**
     * Get metrics for a specific file (backward compatible - uses first profile)
     * @deprecated Use getMetricsForProfile instead
     */
    public getMetricsForFile(filePath: string): FileMetrics | null;
    /**
     * Get metrics for a specific profile and file
     */
    public getMetricsForFile(profileName: string, filePath: string): FileMetrics | null;
    public getMetricsForFile(arg1: string, arg2?: string): FileMetrics | null {
        // Handle backward compatibility: single argument means filePath only
        if (arg2 === undefined) {
            const filePath = arg1;
            // Use first profile for backward compatibility
            if (this.profiles.size === 0) {
                return null;
            }
            const firstProfile = Array.from(this.profiles.values())[0];
            return this.getMetricsForProfile(firstProfile.name, filePath);
        }

        // New API: profileName and filePath
        const profileName = arg1;
        const filePath = arg2;
        return this.getMetricsForProfile(profileName, filePath);
    }

    /**
     * Get metrics for a specific profile and file
     */
    public getMetricsForProfile(profileName: string, filePath: string): FileMetrics | null {
        const entry = this.profiles.get(profileName);
        if (!entry) {
            return null;
        }

        // Try exact match first
        if (entry.metrics.has(filePath)) {
            return entry.metrics.get(filePath)!;
        }

        // Try to find by normalized path comparison
        for (const [profilePath, metrics] of entry.metrics.entries()) {
            if (this.pathsMatch(profilePath, filePath)) {
                return metrics;
            }
        }

        return null;
    }

    /**
     * Get all loaded profile names
     */
    public getLoadedProfileNames(): string[] {
        return Array.from(this.profiles.keys());
    }

    /**
     * Get profile entry by name
     */
    public getProfileEntry(name: string): ProfileEntry | null {
        return this.profiles.get(name) || null;
    }

    /**
     * Check if a profile is loaded
     */
    public hasProfile(): boolean {
        return this.profiles.size > 0;
    }

    /**
     * Get profile information
     */
    public getProfileInfo(): ProfileInfo | null {
        return this.profileInfo;
    }

    /**
     * Get all file paths with metrics (from first profile for backward compatibility)
     */
    public getFilePaths(): string[] {
        if (this.profiles.size === 0) {
            return [];
        }
        const firstProfile = Array.from(this.profiles.values())[0];
        return Array.from(firstProfile.metrics.keys());
    }

    /**
     * Get all metrics (for debug info - from first profile for backward compatibility)
     */
    public getAllMetrics(): ProfileMetrics {
        if (this.profiles.size === 0) {
            return new Map();
        }
        const firstProfile = Array.from(this.profiles.values())[0];
        return firstProfile.metrics;
    }

    /**
     * Helper to check if two paths refer to the same file
     */
    private pathsMatch(path1: string, path2: string): boolean {
        // Normalize both paths
        const norm1 = this.normalizePath(path1);
        const norm2 = this.normalizePath(path2);

        // Exact match
        if (norm1 === norm2) {
            return true;
        }

        // Check if one ends with the other (handles absolute vs relative)
        if (norm1.endsWith(norm2) || norm2.endsWith(norm1)) {
            return true;
        }

        // Check basename match as last resort
        const base1 = norm1.split('/').pop();
        const base2 = norm2.split('/').pop();
        return base1 === base2 && base1 !== '';
    }

    /**
     * Normalize a path for comparison
     */
    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/').toLowerCase();
    }
}
