import * as vscode from 'vscode';
import { DecorationManager } from './decorations/decorationManager';
import { ProfileStore } from './state/profileStore';
import { registerLoadProfileCommand } from './commands/loadProfile';
import { registerFetchFromPyroscopeCommand } from './commands/fetchFromPyroscope';
import { registerToggleHintsCommand, registerClearProfileCommand } from './commands/toggleHints';

let decorationManager: DecorationManager;
let profileStore: ProfileStore;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    console.log('Pyroscope Profile Viewer extension is now active');

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
}

function updateStatusBar() {
    const profileInfo = profileStore.getProfileInfo();
    if (profileInfo) {
        statusBarItem.text = `$(flame) ${profileInfo.name}`;
        statusBarItem.tooltip = `Pyroscope Profile: ${profileInfo.name}\nLoaded at: ${profileInfo.timestamp}\nClick to clear`;
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
