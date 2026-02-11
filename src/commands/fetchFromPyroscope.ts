import * as vscode from 'vscode';
import { ProfileStore, ProfileEntry } from '../state/profileStore';
import { PyroscopeClient, ProfileType } from '../pyroscope/client';
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

            // Get available environments
            let environments: string[];
            try {
                logger.info('Fetching environments...');
                environments = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fetching environments...',
                        cancellable: false,
                    },
                    async () => await client.getEnvironments()
                );
                logger.info(`Found ${environments.length} environments`);

                if (shouldLogDebug()) {
                    logger.debug(`Environments: ${environments.join(', ')}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`Failed to fetch environments: ${message}`);
                // Continue without environment filter if this fails
                environments = [];
            }

            // Show environment picker if environments are available
            let selectedEnvironment: string | undefined;
            if (environments.length > 0) {
                // Add an "All Environments" option
                const envOptions = ['All Environments', ...environments];

                const selectedEnv = await vscode.window.showQuickPick(envOptions, {
                    placeHolder: 'Select deployment environment',
                });

                if (!selectedEnv) {
                    logger.info('Environment selection cancelled');
                    return;
                }

                if (selectedEnv !== 'All Environments') {
                    selectedEnvironment = selectedEnv;
                    logger.info(`Selected environment: ${selectedEnvironment}`);
                } else {
                    logger.info('Selected all environments (no filter)');
                }
            } else {
                logger.info('No environments available, skipping environment selection');
            }

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

            const now = Math.floor(Date.now() / 1000);
            const from = now - selectedTimeRange.value;

            // Fetch available profile types
            let availableTypes: ProfileType[];
            try {
                availableTypes = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Fetching available profile types...',
                        cancellable: false,
                    },
                    async () => await client.getProfileTypes(from, now)
                );
                logger.info(`Found ${availableTypes.length} profile types`);
                if (shouldLogDebug()) {
                    availableTypes.forEach((type) => {
                        logger.debug(
                            `  - ${type.name}: ${type.sampleType}:${type.sampleUnit} (${type.id})`
                        );
                    });
                }
            } catch (error: any) {
                logger.error(`Failed to fetch profile types: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to fetch profile types: ${error.message}`);
                return;
            }

            if (availableTypes.length === 0) {
                logger.warn('No profile types available for this service');
                vscode.window.showWarningMessage('No profile types available for this service');
                return;
            }

            // Show profile type picker (multi-select)
            const typeItems = availableTypes.map((type) => ({
                label: type.name,
                description: `${type.sampleType}:${type.sampleUnit}`,
                picked: false,
                profileType: type,
            }));

            const selectedTypes = await vscode.window.showQuickPick(typeItems, {
                placeHolder: 'Select profile types to fetch (multiple selection)',
                canPickMany: true,
            });

            if (!selectedTypes || selectedTypes.length === 0) {
                logger.info('Profile type selection cancelled');
                return;
            }

            logger.info(
                `Selected ${selectedTypes.length} profile types: ${selectedTypes.map((t) => t.label).join(', ')}`
            );

            // Fetch all selected profile types in parallel
            const profileEntries = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Fetching profiles',
                    cancellable: false,
                },
                async (progress) => {
                    const entries: ProfileEntry[] = [];
                    const total = selectedTypes.length;

                    // Fetch all profiles in parallel
                    const fetchPromises = selectedTypes.map(async (item, index) => {
                        const type = item.profileType;
                        progress.report({
                            message: `Fetching ${type.name} (${index + 1}/${total})`,
                            increment: 100 / total,
                        });

                        try {
                            logger.info(`Fetching ${type.name} profile...`);

                            // Fetch profile
                            const profileData = await client.fetchProfile(
                                selectedApp,
                                selectedTimeRange.value,
                                type.id,
                                selectedEnvironment
                            );
                            logger.info(`  ${type.name}: Fetched ${profileData.length} bytes`);

                            // Decompress
                            const decompressed = decompressBuffer(profileData);
                            logger.info(
                                `  ${type.name}: Decompressed ${decompressed.length} bytes`
                            );

                            // Parse
                            const parsed = await parseProfile(decompressed);
                            logger.info(
                                `  ${type.name}: Parsed ${parsed.samples.length} samples, ${parsed.functions.size} functions`
                            );

                            // Map to source
                            const pathResolver = new PathResolver(logger);
                            const metrics = await mapSamplesToSource(parsed, pathResolver);

                            if (metrics.size === 0) {
                                logger.warn(
                                    `  ${type.name}: ⚠ Profile fetched but NO files matched`
                                );
                                return null;
                            }

                            logger.info(
                                `  ${type.name}: ✓ SUCCESS: ${metrics.size} files with metrics`
                            );

                            return {
                                name: type.name,
                                typeId: type.id,
                                sampleType: type.sampleType,
                                unit: type.sampleUnit,
                                metrics,
                            } as ProfileEntry;
                        } catch (error: any) {
                            logger.error(`  ${type.name}: Failed - ${error.message}`);
                            vscode.window.showWarningMessage(
                                `Failed to fetch ${type.name} profile: ${error.message}`
                            );
                            return null;
                        }
                    });

                    const results = await Promise.all(fetchPromises);
                    return results.filter((entry): entry is ProfileEntry => entry !== null);
                }
            );

            if (profileEntries.length === 0) {
                logger.error('Failed to fetch any profiles');
                vscode.window.showErrorMessage('Failed to fetch any profiles');
                return;
            }

            // Store the profiles
            let sessionName = selectedApp;
            if (selectedEnvironment) {
                sessionName += ` [${selectedEnvironment}]`;
            }
            sessionName += ` (${selectedTimeRange.label})`;
            profileStore.loadProfiles(profileEntries, sessionName);

            // Show success message
            const profileNames = profileEntries.map((e) => e.name).join(', ');
            const fileCount = new Set(profileEntries.flatMap((e) => Array.from(e.metrics.keys())))
                .size;

            logger.info(
                `✓ Loaded ${profileEntries.length} profiles (${profileNames}): ${fileCount} files`
            );

            vscode.window.showInformationMessage(
                `Loaded ${profileEntries.length} profiles (${profileNames}): ${fileCount} files`
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
