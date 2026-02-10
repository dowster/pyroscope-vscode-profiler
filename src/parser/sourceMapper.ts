import * as path from 'path';
import * as vscode from 'vscode';
import { ParsedProfile, getSampleTypeIndex } from './pprofParser';

export interface LineMetrics {
    filePath: string;
    line: number;
    cpuPercent: number;
    cpuSamples: number;
    memoryBytes: number;
    memoryPercent: number;
    allocations: number;
    selfCpuPercent: number;
    selfMemoryPercent: number;
}

export type FileMetrics = Map<number, LineMetrics>;
export type ProfileMetrics = Map<string, FileMetrics>;

/**
 * Maps profile samples to source code locations and calculates metrics per line
 */
export function mapSamplesToSource(profile: ParsedProfile): ProfileMetrics {
    const metricsMap = new Map<string, FileMetrics>();

    // Find sample type indices
    const cpuIndex = findSampleTypeIndex(profile, ['cpu', 'samples', 'sample']);
    const allocSpaceIndex = findSampleTypeIndex(profile, ['alloc_space', 'allocated', 'bytes']);
    const allocObjectsIndex = findSampleTypeIndex(profile, ['alloc_objects', 'allocations', 'count']);
    const inuseSpaceIndex = findSampleTypeIndex(profile, ['inuse_space', 'inuse']);

    // Calculate totals for percentage calculations
    let totalCpu = 0;
    let totalMemory = 0;

    profile.samples.forEach(sample => {
        if (cpuIndex !== -1 && sample.values[cpuIndex]) {
            totalCpu += sample.values[cpuIndex];
        }
        if (allocSpaceIndex !== -1 && sample.values[allocSpaceIndex]) {
            totalMemory += sample.values[allocSpaceIndex];
        } else if (inuseSpaceIndex !== -1 && sample.values[inuseSpaceIndex]) {
            totalMemory += sample.values[inuseSpaceIndex];
        }
    });

    // Process each sample
    profile.samples.forEach(sample => {
        // Get the stack trace for this sample
        const stack = getStackTrace(sample, profile);

        // Process each frame in the stack
        stack.forEach((frame, index) => {
            if (!frame.filename || frame.line === 0) {
                return;
            }

            // Normalize the file path
            const normalizedPath = normalizeFilePath(frame.filename);
            if (!normalizedPath) {
                return;
            }

            // Get or create file metrics map
            let fileMetrics = metricsMap.get(normalizedPath);
            if (!fileMetrics) {
                fileMetrics = new Map<number, LineMetrics>();
                metricsMap.set(normalizedPath, fileMetrics);
            }

            // Get or create line metrics
            let lineMetrics = fileMetrics.get(frame.line);
            if (!lineMetrics) {
                lineMetrics = {
                    filePath: normalizedPath,
                    line: frame.line,
                    cpuPercent: 0,
                    cpuSamples: 0,
                    memoryBytes: 0,
                    memoryPercent: 0,
                    allocations: 0,
                    selfCpuPercent: 0,
                    selfMemoryPercent: 0
                };
                fileMetrics.set(frame.line, lineMetrics);
            }

            // Accumulate metrics
            const isSelfFrame = index === 0; // First frame is "self" time

            if (cpuIndex !== -1 && sample.values[cpuIndex]) {
                const cpuValue = sample.values[cpuIndex];
                lineMetrics.cpuSamples += cpuValue;
                if (isSelfFrame) {
                    lineMetrics.selfCpuPercent += cpuValue;
                }
            }

            if (allocSpaceIndex !== -1 && sample.values[allocSpaceIndex]) {
                const memValue = sample.values[allocSpaceIndex];
                lineMetrics.memoryBytes += memValue;
                if (isSelfFrame) {
                    lineMetrics.selfMemoryPercent += memValue;
                }
            } else if (inuseSpaceIndex !== -1 && sample.values[inuseSpaceIndex]) {
                const memValue = sample.values[inuseSpaceIndex];
                lineMetrics.memoryBytes += memValue;
                if (isSelfFrame) {
                    lineMetrics.selfMemoryPercent += memValue;
                }
            }

            if (allocObjectsIndex !== -1 && sample.values[allocObjectsIndex]) {
                lineMetrics.allocations += sample.values[allocObjectsIndex];
            }
        });
    });

    // Calculate percentages
    metricsMap.forEach(fileMetrics => {
        fileMetrics.forEach(lineMetrics => {
            if (totalCpu > 0) {
                lineMetrics.cpuPercent = (lineMetrics.cpuSamples / totalCpu) * 100;
                lineMetrics.selfCpuPercent = (lineMetrics.selfCpuPercent / totalCpu) * 100;
            }
            if (totalMemory > 0) {
                lineMetrics.memoryPercent = (lineMetrics.memoryBytes / totalMemory) * 100;
                lineMetrics.selfMemoryPercent = (lineMetrics.selfMemoryPercent / totalMemory) * 100;
            }
        });
    });

    return metricsMap;
}

interface StackFrame {
    filename: string;
    line: number;
    functionName: string;
}

/**
 * Extracts the stack trace from a sample
 */
function getStackTrace(sample: any, profile: ParsedProfile): StackFrame[] {
    const frames: StackFrame[] = [];

    sample.locationIds.forEach((locationId: number) => {
        const location = profile.locations.get(locationId);
        if (!location) {
            return;
        }

        location.lines.forEach(line => {
            const func = profile.functions.get(line.functionId);
            if (func) {
                frames.push({
                    filename: func.filename,
                    line: line.line,
                    functionName: func.name || func.systemName
                });
            }
        });
    });

    return frames;
}

/**
 * Finds the index of a sample type by trying multiple possible names
 */
function findSampleTypeIndex(profile: ParsedProfile, possibleNames: string[]): number {
    for (const name of possibleNames) {
        const index = getSampleTypeIndex(profile, name);
        if (index !== -1) {
            return index;
        }
    }
    return -1;
}

/**
 * Normalizes file paths to match workspace files
 * Handles: absolute paths, relative paths, GOPATH variations
 */
function normalizeFilePath(filePath: string): string | null {
    if (!filePath) {
        return null;
    }

    // Clean the path
    let normalized = filePath.replace(/\\/g, '/').trim();

    // Try to find the file in workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return normalized;
    }

    // Strategy 1: Check if it's an absolute path that exists
    if (path.isAbsolute(normalized)) {
        return normalized;
    }

    // Strategy 2: Try relative to each workspace folder
    for (const folder of workspaceFolders) {
        const candidate = path.join(folder.uri.fsPath, normalized);
        // We'll validate existence later; for now just return the candidate
        return candidate;
    }

    // Strategy 3: Check if path contains common patterns and strip them
    // For Go: remove everything before the module path
    const goModuleMatch = normalized.match(/\/go\/pkg\/mod\/(.+)/);
    if (goModuleMatch) {
        // This is a dependency, not user code - skip it
        return null;
    }

    // Strategy 4: Try to find by basename in workspace
    // This is a fallback and should be used carefully
    const basename = path.basename(normalized);
    for (const folder of workspaceFolders) {
        const candidate = path.join(folder.uri.fsPath, basename);
        return candidate;
    }

    return normalized;
}
