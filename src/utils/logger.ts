import * as vscode from 'vscode';

let outputChannel: vscode.LogOutputChannel | undefined;

/**
 * Initialize the logger - must be called during extension activation
 */
export function initializeLogger(context: vscode.ExtensionContext): vscode.LogOutputChannel {
    outputChannel = vscode.window.createOutputChannel('Pyroscope Profile Viewer', { log: true });
    context.subscriptions.push(outputChannel);
    return outputChannel;
}

/**
 * Get the logger instance
 * @throws Error if logger hasn't been initialized
 */
export function getLogger(): vscode.LogOutputChannel {
    if (!outputChannel) {
        throw new Error('Logger not initialized. Call initializeLogger first.');
    }
    return outputChannel;
}

/**
 * Check if debug logging is enabled in settings
 */
export function shouldLogDebug(): boolean {
    return vscode.workspace.getConfiguration('pyroscope').get<boolean>('debugLogging', false);
}
