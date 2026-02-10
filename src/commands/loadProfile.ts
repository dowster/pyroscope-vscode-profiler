import * as vscode from 'vscode';
import * as path from 'path';
import { ProfileStore } from '../state/profileStore';
import { decompressProfile } from '../parser/decompressor';
import { parseProfile } from '../parser/pprofParser';
import { mapSamplesToSource } from '../parser/sourceMapper';
import { getLogger, shouldLogDebug } from '../utils/logger';
import { PathResolver } from '../utils/pathResolver';

export function registerLoadProfileCommand(profileStore: ProfileStore): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.loadProfile', async () => {
        const logger = getLogger();

        try {
            logger.info('=== Loading Profile from File ===');

            // Show file picker
            const fileUris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'Profile Files': ['pb.gz', 'pb', 'pprof'],
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    'All Files': ['*'],
                },
                openLabel: 'Load Profile',
            });

            if (!fileUris || fileUris.length === 0) {
                logger.info('Profile load cancelled by user');
                return;
            }

            const filePath = fileUris[0].fsPath;
            const fileName = path.basename(filePath);
            logger.info(`Loading profile: ${filePath}`);

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
                    logger.info(`Decompressed: ${decompressed.length} bytes`);

                    progress.report({ message: 'Parsing profile...' });

                    // Parse the protobuf
                    const parsed = await parseProfile(decompressed);
                    logger.info(
                        `Parsed: ${parsed.samples.length} samples, ${parsed.functions.size} functions`
                    );

                    progress.report({ message: 'Mapping to source files...' });

                    // Map samples to source locations with PathResolver
                    const pathResolver = new PathResolver(logger);
                    const metrics = mapSamplesToSource(parsed, pathResolver);

                    // Check results
                    if (metrics.size === 0) {
                        logger.warn('⚠ Profile loaded but NO files matched!');
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
                    profileStore.loadProfile(metrics, fileName);
                }
            );
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to load profile: ${errMsg}`);
            logger.error(error instanceof Error ? error.stack || '' : '');

            vscode.window.showErrorMessage(`Failed to load profile: ${errMsg}`);
        }
    });
}
