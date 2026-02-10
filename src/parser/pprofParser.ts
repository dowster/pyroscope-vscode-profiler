import * as protobuf from 'protobufjs';
import * as path from 'path';

export interface ParsedProfile {
    sampleTypes: SampleType[];
    samples: ProfileSample[];
    locations: Map<number, ProfileLocation>;
    functions: Map<number, ProfileFunction>;
    stringTable: string[];
    timeNanos: number;
    durationNanos: number;
}

export interface SampleType {
    type: string;
    unit: string;
}

export interface ProfileSample {
    locationIds: number[];
    values: number[];
}

export interface ProfileLocation {
    id: number;
    lines: LocationLine[];
}

export interface LocationLine {
    functionId: number;
    line: number;
}

export interface ProfileFunction {
    id: number;
    name: string;
    systemName: string;
    filename: string;
    startLine: number;
}

/**
 * Parses a pprof protobuf buffer and returns structured profile data
 */
export async function parseProfile(buffer: Buffer): Promise<ParsedProfile> {
    try {
        // Load the protobuf definition
        const protoPath = path.join(__dirname, '../../proto/profile.proto');
        const root = await protobuf.load(protoPath);
        const Profile = root.lookupType('perftools.profiles.Profile');

        // Decode the protobuf message
        const message = Profile.decode(buffer);
        const profile = Profile.toObject(message, {
            longs: Number,
            enums: String,
            bytes: Buffer,
            defaults: true,
        });

        // Extract string table (all strings are referenced by index)
        const stringTable: string[] = profile.stringTable || [];

        // Helper to get string from table
        const getString = (index: number): string => {
            return stringTable[index] || '';
        };

        // Parse sample types
        const sampleTypes: SampleType[] = (profile.sampleType || []).map((st: any) => ({
            type: getString(st.type),
            unit: getString(st.unit),
        }));

        // Parse functions
        const functions = new Map<number, ProfileFunction>();
        (profile.function || []).forEach((fn: any) => {
            functions.set(fn.id, {
                id: fn.id,
                name: getString(fn.name),
                systemName: getString(fn.systemName),
                filename: getString(fn.filename),
                startLine: fn.startLine || 0,
            });
        });

        // Parse locations
        const locations = new Map<number, ProfileLocation>();
        (profile.location || []).forEach((loc: any) => {
            locations.set(loc.id, {
                id: loc.id,
                lines: (loc.line || []).map((line: any) => ({
                    functionId: line.functionId,
                    line: line.line || 0,
                })),
            });
        });

        // Parse samples
        const samples: ProfileSample[] = (profile.sample || []).map((sample: any) => ({
            locationIds: sample.locationId || [],
            values: sample.value || [],
        }));

        return {
            sampleTypes,
            samples,
            locations,
            functions,
            stringTable,
            timeNanos: profile.timeNanos || 0,
            durationNanos: profile.durationNanos || 0,
        };
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to parse profile: ${error.message}`);
        }
        throw new Error('Failed to parse profile: Unknown error');
    }
}

/**
 * Get the index of a specific sample type (e.g., "cpu", "alloc_space")
 */
export function getSampleTypeIndex(profile: ParsedProfile, typeName: string): number {
    return profile.sampleTypes.findIndex((st) =>
        st.type.toLowerCase().includes(typeName.toLowerCase())
    );
}
