import * as vscode from 'vscode';
import { DecorationManager } from './decorations/decorationManager';
import { ProfileStore } from './state/profileStore';
import { registerLoadProfileCommand } from './commands/loadProfile';
import { registerFetchFromPyroscopeCommand } from './commands/fetchFromPyroscope';
import { registerToggleHintsCommand, registerClearProfileCommand } from './commands/toggleHints';
import { initializeLogger, getLogger } from './utils/logger';

let decorationManager: DecorationManager;
let profileStore: ProfileStore;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger FIRST
    const logger = initializeLogger(context);
    logger.info('Pyroscope Profile Viewer extension activated');

    // Initialize core components
    profileStore = new ProfileStore();
    decorationManager = new DecorationManager(profileStore);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'pyroscope.clearProfile';
    context.subscriptions.push(statusBarItem);

    // Update status bar when profile changes
    profileStore.onProfileChanged(() => {
        updateStatusBar();
        decorationManager.updateDecorations();
    });

    // Register commands
    context.subscriptions.push(
        registerLoadProfileCommand(profileStore),
        registerFetchFromPyroscopeCommand(profileStore),
        registerToggleHintsCommand(decorationManager),
        registerClearProfileCommand(profileStore)
    );

    // Listen to active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            decorationManager.updateDecorations();
        })
    );

    // Listen to configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('pyroscope')) {
                decorationManager.updateDecorations();
            }
        })
    );

    // Register debug info command
    context.subscriptions.push(
        vscode.commands.registerCommand('pyroscope.showDebugInfo', () => {
            const logger = getLogger();
            logger.info('=== Debug Info ===');

            const config = vscode.workspace.getConfiguration('pyroscope');
            logger.info(`Server URL: ${config.get('serverUrl')}`);
            logger.info(`Auth token: ${config.get('authToken') ? '(configured)' : '(none)'}`);
            logger.info(`Display mode: ${config.get('displayMode')}`);
            logger.info(`Color scheme: ${config.get('colorScheme')}`);
            logger.info(`Threshold: ${config.get('threshold')}%`);
            logger.info(`Debug logging: ${config.get('debugLogging')}`);

            const pathMappings = config.get<any[]>('pathMappings', []);
            logger.info(`Path mappings: ${pathMappings.length} configured`);
            pathMappings.forEach((m, i) => {
                logger.info(`  ${i + 1}. "${m.from}" → "${m.to}"`);
            });

            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            logger.info(`Workspace folders: ${workspaceFolders.length}`);
            workspaceFolders.forEach((f) => {
                logger.info(`  ${f.name}: ${f.uri.fsPath}`);
            });

            const profileInfo = profileStore.getProfileInfo();
            if (profileInfo) {
                logger.info(`Loaded profile: ${profileInfo.name}`);
                logger.info(`  Timestamp: ${profileInfo.timestamp}`);

                const profileNames = profileStore.getLoadedProfileNames();
                logger.info(`  Profile types: ${profileNames.join(', ')}`);

                profileNames.forEach((name) => {
                    const entry = profileStore.getProfileEntry(name);
                    if (entry) {
                        logger.info(`  ${name}: ${entry.metrics.size} files`);
                    }
                });
            } else {
                logger.info('No profile loaded');
            }

            logger.show();
        })
    );
}

function updateStatusBar() {
    const profileInfo = profileStore.getProfileInfo();
    if (profileInfo) {
        const profileNames = profileStore.getLoadedProfileNames();
        statusBarItem.text = `$(flame) ${profileInfo.name}`;
        statusBarItem.tooltip = `Loaded profiles: ${profileNames.join(', ')}\nFetched: ${profileInfo.timestamp}\nClick to clear`;
        statusBarItem.show();
    } else {
        statusBarItem.hide();
    }
}

export function deactivate() {
    if (decorationManager) {
        decorationManager.dispose();
    }
}
