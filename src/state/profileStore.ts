import * as vscode from 'vscode';
import { ProfileMetrics, FileMetrics } from '../parser/sourceMapper';

export interface ProfileInfo {
    name: string;
    timestamp: string;
}

export class ProfileStore {
    private metrics: ProfileMetrics | null = null;
    private profileInfo: ProfileInfo | null = null;
    private changeEmitter = new vscode.EventEmitter<void>();

    public readonly onProfileChanged = this.changeEmitter.event;

    /**
     * Load new profile data
     */
    public loadProfile(metrics: ProfileMetrics, name: string): void {
        this.metrics = metrics;
        this.profileInfo = {
            name,
            timestamp: new Date().toISOString(),
        };
        this.changeEmitter.fire();
    }

    /**
     * Clear all profile data
     */
    public clearProfile(): void {
        this.metrics = null;
        this.profileInfo = null;
        this.changeEmitter.fire();
    }

    /**
     * Get metrics for a specific file
     */
    public getMetricsForFile(filePath: string): FileMetrics | null {
        if (!this.metrics) {
            return null;
        }

        // Try exact match first
        if (this.metrics.has(filePath)) {
            return this.metrics.get(filePath)!;
        }

        // Try to find by normalized path comparison
        for (const [profilePath, metrics] of this.metrics.entries()) {
            if (this.pathsMatch(profilePath, filePath)) {
                return metrics;
            }
        }

        return null;
    }

    /**
     * Check if a profile is loaded
     */
    public hasProfile(): boolean {
        return this.metrics !== null;
    }

    /**
     * Get profile information
     */
    public getProfileInfo(): ProfileInfo | null {
        return this.profileInfo;
    }

    /**
     * Get all file paths with metrics
     */
    public getFilePaths(): string[] {
        if (!this.metrics) {
            return [];
        }
        return Array.from(this.metrics.keys());
    }

    /**
     * Get all metrics (for debug info)
     */
    public getAllMetrics(): ProfileMetrics {
        return this.metrics || new Map();
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
