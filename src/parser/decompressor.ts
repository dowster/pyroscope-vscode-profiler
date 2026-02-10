import * as fs from 'fs';
import * as pako from 'pako';

/**
 * Decompresses a .pb.gz file and returns the raw protobuf data
 */
export async function decompressProfile(filePath: string): Promise<Buffer> {
    try {
        // Read the gzipped file
        const compressedData = await fs.promises.readFile(filePath);

        // Check if file is gzipped (magic number 0x1f 0x8b)
        const isGzipped = compressedData[0] === 0x1f && compressedData[1] === 0x8b;

        if (!isGzipped) {
            // If not gzipped, assume it's already decompressed protobuf
            return compressedData;
        }

        // Decompress using pako
        const decompressed = pako.ungzip(compressedData);

        return Buffer.from(decompressed);
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to decompress profile: ${error.message}`);
        }
        throw new Error('Failed to decompress profile: Unknown error');
    }
}

/**
 * Decompresses raw gzipped data (for API responses)
 */
export function decompressBuffer(data: Buffer): Buffer {
    try {
        // Check if data is gzipped
        const isGzipped = data[0] === 0x1f && data[1] === 0x8b;

        if (!isGzipped) {
            return data;
        }

        const decompressed = pako.ungzip(data);
        return Buffer.from(decompressed);
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to decompress buffer: ${error.message}`);
        }
        throw new Error('Failed to decompress buffer: Unknown error');
    }
}
