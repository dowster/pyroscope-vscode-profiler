import * as vscode from 'vscode';
import { ProfileStore } from '../state/profileStore';
import { DecorationManager } from '../decorations/decorationManager';

export function registerToggleHintsCommand(
    decorationManager: DecorationManager
): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.toggleHints', () => {
        decorationManager.toggleHints();
    });
}

export function registerClearProfileCommand(profileStore: ProfileStore): vscode.Disposable {
    return vscode.commands.registerCommand('pyroscope.clearProfile', async () => {
        if (!profileStore.hasProfile()) {
            vscode.window.showInformationMessage('No profile loaded');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            'Clear the current profile?',
            'Yes',
            'No'
        );

        if (answer === 'Yes') {
            profileStore.clearProfile();
            vscode.window.showInformationMessage('Profile cleared');
        }
    });
}
