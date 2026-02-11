import { LineMetrics } from '../parser/sourceMapper';

export interface HintConfig {
    displayMode: 'cpu' | 'memory' | 'both';
    colorScheme: 'heatmap' | 'threshold' | 'minimal';
    threshold: number;
    displayProfiles?: string[];
}

export interface RenderedHint {
    text: string;
    color: string;
}

/**
 * Formats inline hint text for a line with metrics (single profile - legacy)
 */
export function renderHint(metrics: LineMetrics, config: HintConfig): RenderedHint | null;
/**
 * Formats inline hint text for multiple profile types on a single line
 */
export function renderHint(
    profileMetrics: Map<string, { metrics: LineMetrics; unit: string }>,
    config: HintConfig
): RenderedHint | null;
export function renderHint(
    metricsOrMap: LineMetrics | Map<string, { metrics: LineMetrics; unit: string }>,
    config: HintConfig
): RenderedHint | null {
    // Handle legacy single-profile case
    if (!(metricsOrMap instanceof Map)) {
        return renderSingleProfileHint(metricsOrMap, config);
    }

    // Handle multi-profile case
    return renderMultiProfileHint(metricsOrMap, config);
}

/**
 * Render hint for single profile (backward compatible)
 */
function renderSingleProfileHint(metrics: LineMetrics, config: HintConfig): RenderedHint | null {
    const parts: string[] = [];

    // Check threshold
    const maxPercent = Math.max(metrics.selfCpuPercent, metrics.selfMemoryPercent);
    if (maxPercent < config.threshold) {
        return null;
    }

    // Add CPU info
    if (config.displayMode === 'cpu' || config.displayMode === 'both') {
        if (metrics.selfCpuPercent > 0) {
            parts.push(`CPU: ${formatPercent(metrics.selfCpuPercent)}`);
        }
    }

    // Add memory info
    if (config.displayMode === 'memory' || config.displayMode === 'both') {
        if (metrics.memoryBytes > 0) {
            parts.push(`Mem: ${formatBytes(metrics.memoryBytes)}`);
        }
    }

    if (parts.length === 0) {
        return null;
    }

    const text = parts.join(' | ');
    const color = getColor(maxPercent, config.colorScheme);

    return { text, color };
}

/**
 * Determines the color based on percentage and color scheme
 */
function getColor(percent: number, scheme: string): string {
    if (scheme === 'minimal') {
        return 'rgba(128, 128, 128, 0.5)';
    }

    if (scheme === 'threshold') {
        if (percent >= 10) {
            return 'rgba(255, 0, 0, 0.7)';
        } else if (percent >= 5) {
            return 'rgba(255, 165, 0, 0.7)';
        } else {
            return 'rgba(255, 255, 0, 0.7)';
        }
    }

    // Heatmap: green -> yellow -> orange -> red
    if (percent >= 15) {
        return 'rgba(255, 0, 0, 0.7)'; // Red for hot spots
    } else if (percent >= 10) {
        return 'rgba(255, 100, 0, 0.7)'; // Orange-red
    } else if (percent >= 5) {
        return 'rgba(255, 165, 0, 0.7)'; // Orange
    } else if (percent >= 2) {
        return 'rgba(255, 215, 0, 0.7)'; // Yellow-orange
    } else {
        return 'rgba(144, 238, 144, 0.7)'; // Light green
    }
}

/**
 * Formats a percentage value
 */
function formatPercent(value: number): string {
    if (value >= 10) {
        return `${value.toFixed(1)}%`;
    } else if (value >= 1) {
        return `${value.toFixed(2)}%`;
    } else {
        return `${value.toFixed(3)}%`;
    }
}

/**
 * Render hint for multiple profile types
 */
function renderMultiProfileHint(
    profileMetrics: Map<string, { metrics: LineMetrics; unit: string }>,
    config: HintConfig
): RenderedHint | null {
    const parts: string[] = [];
    let maxPercent = 0;

    // Get profiles to display (either from config or all profiles)
    const displayProfiles = config.displayProfiles || Array.from(profileMetrics.keys());

    // Iterate through profiles in displayProfiles order
    displayProfiles.forEach((profileName) => {
        const data = profileMetrics.get(profileName);
        if (!data) {
            return;
        }

        const { metrics, unit } = data;

        // Format based on unit type
        let text: string;
        let percent: number;

        if (unit === 'nanoseconds') {
            // CPU profile
            percent = metrics.selfCpuPercent;
            if (percent < config.threshold) {
                return;
            }
            text = `${profileName}: ${formatPercent(percent)}`;
        } else if (unit === 'bytes') {
            // Memory profile
            percent = metrics.selfMemoryPercent;
            if (percent < config.threshold) {
                return;
            }
            const mb = (metrics.memoryBytes / (1024 * 1024)).toFixed(1);
            text = `${profileName}: ${mb}MB (${formatPercent(percent)})`;
        } else if (unit === 'count') {
            // Goroutines, blocks, mutex, etc.
            percent = metrics.selfCpuPercent; // Reuse cpuPercent field for generic percentage
            if (percent < config.threshold) {
                return;
            }
            const count = metrics.cpuSamples; // Reuse cpuSamples for generic count
            text = `${profileName}: ${count}`;
        } else {
            // Unknown unit - generic display
            percent = metrics.selfCpuPercent;
            if (percent < config.threshold) {
                return;
            }
            text = `${profileName}: ${formatPercent(percent)}`;
        }

        parts.push(text);
        maxPercent = Math.max(maxPercent, percent);
    });

    if (parts.length === 0) {
        return null;
    }

    // Calculate color based on max percentage
    const color = getColor(maxPercent, config.colorScheme);

    return {
        text: parts.join(' | '),
        color,
    };
}

/**
 * Formats byte values to human-readable format
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const value = bytes / Math.pow(k, i);

    if (i === 0) {
        return `${value} ${sizes[i]}`;
    } else if (value >= 100) {
        return `${value.toFixed(0)} ${sizes[i]}`;
    } else if (value >= 10) {
        return `${value.toFixed(1)} ${sizes[i]}`;
    } else {
        return `${value.toFixed(2)} ${sizes[i]}`;
    }
}
