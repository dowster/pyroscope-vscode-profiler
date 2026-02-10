import * as vscode from 'vscode';
import { ProfileStore } from '../state/profileStore';
import { PyroscopeClient } from '../pyroscope/client';
import { decompressBuffer } from '../parser/decompressor';
import { parseProfile } from '../parser/pprofParser';
import { mapSamplesToSource } from '../parser/sourceMapper';

export function registerFetchFromPyroscopeCommand(profileStore: ProfileStore): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.fetchFromPyroscope', async () => {
        try {
            // Get configuration
            const config = vscode.workspace.getConfiguration('pyroscope');
            const serverUrl = config.get<string>('serverUrl', 'http://localhost:4040');
            const authToken = config.get<string>('authToken', '');

            if (!serverUrl) {
                vscode.window.showErrorMessage('Please configure pyroscope.serverUrl in settings');
                return;
            }

            const client = new PyroscopeClient(serverUrl, authToken);

            // Test connection and get apps
            let apps: string[];
            try {
                apps = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Connecting to Pyroscope...',
                        cancellable: false
                    },
                    async () => await client.getApplications()
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`Failed to connect to Pyroscope: ${message}`);
                return;
            }

            if (apps.length === 0) {
                vscode.window.showWarningMessage('No applications found in Pyroscope');
                return;
            }

            // Show application picker
            const selectedApp = await vscode.window.showQuickPick(apps, {
                placeHolder: 'Select an application'
            });

            if (!selectedApp) {
                return;
            }

            // Show time range picker
            const timeRanges = [
                { label: 'Last 1 hour', value: 3600 },
                { label: 'Last 6 hours', value: 21600 },
                { label: 'Last 24 hours', value: 86400 },
                { label: 'Last 7 days', value: 604800 }
            ];

            const selectedTimeRange = await vscode.window.showQuickPick(timeRanges, {
                placeHolder: 'Select time range'
            });

            if (!selectedTimeRange) {
                return;
            }

            // Fetch profile
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching Profile from Pyroscope',
                    cancellable: false
                },
                async (progress) => {
                    progress.report({ message: 'Downloading profile...' });

                    const profileData = await client.fetchProfile(
                        selectedApp,
                        selectedTimeRange.value
                    );

                    progress.report({ message: 'Decompressing...' });
                    const decompressed = decompressBuffer(profileData);

                    progress.report({ message: 'Parsing profile...' });
                    const parsed = await parseProfile(decompressed);

                    progress.report({ message: 'Mapping to source files...' });
                    const metrics = mapSamplesToSource(parsed);

                    // Store the profile
                    const profileName = `${selectedApp} (${selectedTimeRange.label})`;
                    profileStore.loadProfile(metrics, profileName);

                    // Show summary
                    const fileCount = metrics.size;
                    let totalLines = 0;
                    metrics.forEach(fileMetrics => {
                        totalLines += fileMetrics.size;
                    });

                    vscode.window.showInformationMessage(
                        `Profile loaded: ${fileCount} files, ${totalLines} annotated lines`
                    );
                }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to fetch profile: ${message}`);
            console.error('Profile fetch error:', error);
        }
    });
}
