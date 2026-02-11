import * as path from 'path';
import * as vscode from 'vscode';
import { ParsedProfile, getSampleTypeIndex } from './pprofParser';
import { PathResolver } from '../utils/pathResolver';
import { getLogger, shouldLogDebug } from '../utils/logger';

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
 * This function yields to the event loop periodically to keep the UI responsive
 */
export async function mapSamplesToSource(
    profile: ParsedProfile,
    pathResolver: PathResolver
): Promise<ProfileMetrics> {
    const logger = getLogger();
    const metricsMap = new Map<string, FileMetrics>();

    // Log all sample types in the profile
    if (shouldLogDebug()) {
        logger.debug(`Profile sample types (${profile.sampleTypes.length}):`);
        profile.sampleTypes.forEach((st, idx) => {
            logger.debug(`  [${idx}] ${st.type} (${st.unit})`);
        });
    }

    // Find sample type indices
    const cpuIndex = findSampleTypeIndex(profile, ['cpu', 'samples', 'sample']);
    const allocSpaceIndex = findSampleTypeIndex(profile, ['alloc_space', 'allocated', 'bytes']);
    const allocObjectsIndex = findSampleTypeIndex(profile, [
        'alloc_objects',
        'allocations',
        'count',
    ]);
    const inuseSpaceIndex = findSampleTypeIndex(profile, ['inuse_space', 'inuse']);

    logger.info(
        `Sample type indices: cpu=${cpuIndex}, allocSpace=${allocSpaceIndex}, allocObjects=${allocObjectsIndex}, inuseSpace=${inuseSpaceIndex}`
    );

    // Warn if we couldn't find any sample types
    if (cpuIndex === -1 && allocSpaceIndex === -1 && inuseSpaceIndex === -1) {
        logger.warn(
            '⚠️  Could not find any recognized sample types in profile! Metrics may be incorrect.'
        );
        logger.warn(
            'This usually means the profile type is not supported or the sample type names do not match.'
        );
    }

    // Log unique paths from profile
    const uniquePaths = new Set<string>();
    profile.samples.forEach((sample) => {
        const stack = getStackTrace(sample, profile);
        stack.forEach((frame) => {
            if (frame.filename) {
                uniquePaths.add(frame.filename);
            }
        });
    });

    if (shouldLogDebug()) {
        logger.debug(`Profile contains ${uniquePaths.size} unique file paths:`);
        uniquePaths.forEach((p) => logger.debug(`  ${p}`));
    }

    // Calculate totals for percentage calculations
    let totalCpu = 0;
    let totalMemory = 0;

    profile.samples.forEach((sample) => {
        if (cpuIndex !== -1 && sample.values[cpuIndex]) {
            totalCpu += sample.values[cpuIndex];
        }
        if (allocSpaceIndex !== -1 && sample.values[allocSpaceIndex]) {
            totalMemory += sample.values[allocSpaceIndex];
        } else if (inuseSpaceIndex !== -1 && sample.values[inuseSpaceIndex]) {
            totalMemory += sample.values[inuseSpaceIndex];
        }
    });

    logger.info(
        `Processing ${profile.samples.length} samples: totalCpu=${totalCpu}, totalMemory=${totalMemory}`
    );

    // Process each sample
    // Yield to event loop every N samples to keep UI responsive
    const YIELD_INTERVAL = 1000;
    for (let sampleIdx = 0; sampleIdx < profile.samples.length; sampleIdx++) {
        const sample = profile.samples[sampleIdx];

        // Yield to event loop periodically to prevent UI freeze
        if (sampleIdx % YIELD_INTERVAL === 0 && sampleIdx > 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }

        // Get the stack trace for this sample
        const stack = getStackTrace(sample, profile);

        // Process each frame in the stack
        stack.forEach((frame) => {
            if (!frame.filename || frame.line === 0) {
                return;
            }

            // Use PathResolver instead of normalizeFilePath
            const resolvedPath = pathResolver.resolveFilePath(frame.filename);
            if (!resolvedPath) {
                // Path couldn't be resolved - already logged by PathResolver
                return;
            }

            // Get or create file metrics map
            let fileMetrics = metricsMap.get(resolvedPath);
            if (!fileMetrics) {
                fileMetrics = new Map<number, LineMetrics>();
                metricsMap.set(resolvedPath, fileMetrics);
            }

            // Get or create line metrics
            let lineMetrics = fileMetrics.get(frame.line);
            if (!lineMetrics) {
                lineMetrics = {
                    filePath: resolvedPath,
                    line: frame.line,
                    cpuPercent: 0,
                    cpuSamples: 0,
                    memoryBytes: 0,
                    memoryPercent: 0,
                    allocations: 0,
                    selfCpuPercent: 0,
                    selfMemoryPercent: 0,
                };
                fileMetrics.set(frame.line, lineMetrics);
            }

            // Accumulate metrics
            // locationIndex 0 = leaf (self time), 1+ = callers (cumulative only)
            const isSelfFrame = frame.locationIndex === 0;

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
    }

    // Calculate percentages
    metricsMap.forEach((fileMetrics) => {
        fileMetrics.forEach((lineMetrics) => {
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

    logger.info(`Mapped metrics to ${metricsMap.size} files`);

    if (shouldLogDebug()) {
        logger.debug('Matched files:');
        metricsMap.forEach((lines, filePath) => {
            logger.debug(`  ${filePath}: ${lines.size} lines`);
        });
    }

    return metricsMap;
}

interface StackFrame {
    filename: string;
    line: number;
    functionName: string;
    locationIndex: number; // Track which location this frame came from
}

/**
 * Extracts the stack trace from a sample
 * locationIndex tracks which location (0 = leaf/self) each frame came from
 */
function getStackTrace(sample: any, profile: ParsedProfile): StackFrame[] {
    const frames: StackFrame[] = [];

    sample.locationIds.forEach((locationId: number, locationIndex: number) => {
        const location = profile.locations.get(locationId);
        if (!location) {
            return;
        }

        location.lines.forEach((line) => {
            const func = profile.functions.get(line.functionId);
            if (func) {
                frames.push({
                    filename: func.filename,
                    line: line.line,
                    functionName: func.name || func.systemName,
                    locationIndex, // 0 = leaf (self), 1+ = callers (cumulative only)
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
