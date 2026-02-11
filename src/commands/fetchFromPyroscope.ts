import * as vscode from 'vscode';
import { ProfileStore } from '../state/profileStore';
import { PyroscopeClient } from '../pyroscope/client';
import { decompressBuffer } from '../parser/decompressor';
import { parseProfile } from '../parser/pprofParser';
import { mapSamplesToSource } from '../parser/sourceMapper';
import { getLogger, shouldLogDebug } from '../utils/logger';
import { PathResolver } from '../utils/pathResolver';

export function registerFetchFromPyroscopeCommand(profileStore: ProfileStore): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.fetchFromPyroscope', async () => {
        const logger = getLogger();

        try {
            logger.info('=== Fetching Profile from Pyroscope ===');

            // Get configuration
            const config = vscode.workspace.getConfiguration('pyroscope');
            const serverUrl = config.get<string>('serverUrl', 'http://localhost:4040');
            const authToken = config.get<string>('authToken', '');

            logger.info(`Server URL: ${serverUrl}`);
            logger.info(`Auth token: ${authToken ? '(configured)' : '(none)'}`);

            if (!serverUrl) {
                logger.error('Server URL not configured');
                vscode.window.showErrorMessage('Please configure pyroscope.serverUrl in settings');
                return;
            }

            const client = new PyroscopeClient(serverUrl, authToken);

            // Test connection and get apps
            let apps: string[];
            try {
                logger.info('Fetching application list...');
                apps = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Connecting to Pyroscope...',
                        cancellable: false,
                    },
                    async () => await client.getApplications()
                );
                logger.info(`Found ${apps.length} applications`);

                if (shouldLogDebug()) {
                    logger.debug(`Applications: ${apps.join(', ')}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`Failed to fetch applications: ${message}`);
                vscode.window.showErrorMessage(`Failed to connect to Pyroscope: ${message}`);
                return;
            }

            if (apps.length === 0) {
                logger.warn('No applications found on server');
                vscode.window.showWarningMessage('No applications found in Pyroscope');
                return;
            }

            // Show application picker
            const selectedApp = await vscode.window.showQuickPick(apps, {
                placeHolder: 'Select an application',
            });

            if (!selectedApp) {
                logger.info('Application selection cancelled');
                return;
            }

            logger.info(`Selected application: ${selectedApp}`);

            // Show time range picker
            const timeRanges = [
                { label: 'Last 1 hour', value: 3600 },
                { label: 'Last 6 hours', value: 21600 },
                { label: 'Last 24 hours', value: 86400 },
                { label: 'Last 7 days', value: 604800 },
            ];

            const selectedTimeRange = await vscode.window.showQuickPick(timeRanges, {
                placeHolder: 'Select time range',
            });

            if (!selectedTimeRange) {
                logger.info('Time range selection cancelled');
                return;
            }

            logger.info(`Time range: ${selectedTimeRange.label} (${selectedTimeRange.value}s)`);

            // Fetch profile
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching Profile from Pyroscope',
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: 'Downloading profile...' });
                    logger.info('Fetching profile data...');

                    const profileData = await client.fetchProfile(
                        selectedApp,
                        selectedTimeRange.value
                    );
                    logger.info(`Profile fetched: ${profileData.length} bytes`);

                    progress.report({ message: 'Decompressing...' });
                    const decompressed = decompressBuffer(profileData);
                    logger.info(`Decompressed: ${decompressed.length} bytes`);

                    progress.report({ message: 'Parsing profile...' });
                    const parsed = await parseProfile(decompressed);
                    logger.info(
                        `Parsed: ${parsed.samples.length} samples, ${parsed.functions.size} functions`
                    );

                    progress.report({ message: 'Mapping to source files...' });
                    const pathResolver = new PathResolver(logger);
                    const metrics = await mapSamplesToSource(parsed, pathResolver);

                    // Check results
                    if (metrics.size === 0) {
                        logger.warn('⚠ Profile fetched but NO files matched!');
                        logger.info('💡 Possible reasons:');
                        logger.info("   - Paths in profile don't match local workspace");
                        logger.info(
                            '   - Configure path mappings in settings (pyroscope.pathMappings)'
                        );
                        logger.info('   - Run "Pyroscope: Show Debug Info" for details');

                        const action = await vscode.window.showWarningMessage(
                            'Profile loaded but no files matched. Check Output for details.',
                            'Open Output',
                            'Configure Path Mappings'
                        );

                        if (action === 'Open Output') {
                            logger.show();
                        } else if (action === 'Configure Path Mappings') {
                            vscode.commands.executeCommand(
                                'workbench.action.openSettings',
                                'pyroscope.pathMappings'
                            );
                        }
                    } else {
                        const fileCount = metrics.size;
                        let totalLines = 0;
                        metrics.forEach((fileMetrics) => {
                            totalLines += fileMetrics.size;
                        });

                        logger.info(`✓ SUCCESS: ${fileCount} files, ${totalLines} annotated lines`);

                        vscode.window.showInformationMessage(
                            `Profile loaded: ${fileCount} files, ${totalLines} annotated lines`
                        );
                    }

                    // Store the profile
                    const profileName = `${selectedApp} (${selectedTimeRange.label})`;
                    profileStore.loadProfile(metrics, profileName);
                }
            );
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to fetch profile: ${errMsg}`);
            logger.error(error instanceof Error ? error.stack || '' : '');

            let userMessage = `Failed to fetch profile: ${errMsg}`;
            if (errMsg.includes('connect')) {
                userMessage += '\n\nCheck server URL and network connectivity.';
            } else if (errMsg.includes('401') || errMsg.includes('403')) {
                userMessage += '\n\nCheck authentication token in settings.';
            }

            vscode.window.showErrorMessage(userMessage);
        }
    });
}
