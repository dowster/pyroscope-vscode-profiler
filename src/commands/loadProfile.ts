import * as vscode from 'vscode';
import * as path from 'path';
import { ProfileStore } from '../state/profileStore';
import { decompressProfile } from '../parser/decompressor';
import { parseProfile } from '../parser/pprofParser';
import { mapSamplesToSource } from '../parser/sourceMapper';

export function registerLoadProfileCommand(profileStore: ProfileStore): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.loadProfile', async () => {
        try {
            // Show file picker
            const fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'Profile Files': ['pb.gz', 'pb', 'pprof'],
                    'All Files': ['*'],
                },
                openLabel: 'Load Profile',
            });

            if (!fileUris || fileUris.length === 0) {
                return;
            }

            const filePath = fileUris[0].fsPath;
            const fileName = path.basename(filePath);

            // Show progress
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Loading Pyroscope Profile',
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: 'Decompressing...' });

                    // Decompress the file
                    const decompressed = await decompressProfile(filePath);

                    progress.report({ message: 'Parsing profile...' });

                    // Parse the protobuf
                    const parsed = await parseProfile(decompressed);

                    progress.report({ message: 'Mapping to source files...' });

                    // Map samples to source locations
                    const metrics = mapSamplesToSource(parsed);

                    // Store the profile
                    profileStore.loadProfile(metrics, fileName);

                    // Show summary
                    const fileCount = metrics.size;
                    let totalLines = 0;
                    metrics.forEach((fileMetrics) => {
                        totalLines += fileMetrics.size;
                    });

                    vscode.window.showInformationMessage(
                        `Profile loaded: ${fileCount} files, ${totalLines} annotated lines`
                    );
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to load profile: ${message}`);
            console.error('Profile loading error:', error);
        }
    });
}
