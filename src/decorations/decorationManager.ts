import * as vscode from 'vscode';
import { ProfileStore } from '../state/profileStore';
import { renderHint, HintConfig } from './hintRenderer';
import { PyroscopeHoverProvider } from './hoverProvider';
import { getLogger, shouldLogDebug } from '../utils/logger';

export class DecorationManager {
    private decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
    private enabled: boolean = true;
    private hoverProvider: vscode.Disposable | null = null;
    private logger: ReturnType<typeof getLogger>;

    constructor(private profileStore: ProfileStore) {
        this.logger = getLogger();
        this.registerHoverProvider();
    }

    /**
     * Register hover provider for all supported languages
     */
    private registerHoverProvider(): void {
        const provider = new PyroscopeHoverProvider(this.profileStore);
        const languages = ['go', 'python', 'javascript', 'typescript'];

        this.hoverProvider = vscode.languages.registerHoverProvider(
            languages.map((lang) => ({ language: lang })),
            provider
        );
    }

    /**
     * Update decorations for all visible editors
     */
    public updateDecorations(): void {
        if (shouldLogDebug()) {
            this.logger.debug('Updating decorations for visible editors');
        }

        if (!this.enabled || !this.profileStore.hasProfile()) {
            this.clearAllDecorations();
            return;
        }

        const config = this.getConfig();

        vscode.window.visibleTextEditors.forEach((editor) => {
            this.updateEditorDecorations(editor, config);
        });
    }

    /**
     * Update decorations for a specific editor
     */
    private updateEditorDecorations(editor: vscode.TextEditor, config: HintConfig): void {
        const filePath = editor.document.uri.fsPath;

        // Get loaded profile names and which ones to display
        const loadedProfiles = this.profileStore.getLoadedProfileNames();
        const displayProfiles = config.displayProfiles || loadedProfiles;

        if (shouldLogDebug()) {
            this.logger.debug(
                `  ${filePath}: Displaying ${displayProfiles.length} profiles: ${displayProfiles.join(', ')}`
            );
        }

        // Group metrics by line number, collecting from all profiles
        const lineMetricsMap = new Map<
            number,
            Map<string, { metrics: import('../parser/sourceMapper').LineMetrics; unit: string }>
        >();

        displayProfiles.forEach((profileName) => {
            if (!loadedProfiles.includes(profileName)) {
                return;
            }

            const entry = this.profileStore.getProfileEntry(profileName);
            if (!entry) {
                return;
            }

            const fileMetrics = this.profileStore.getMetricsForProfile(profileName, filePath);
            if (!fileMetrics) {
                return;
            }

            fileMetrics.forEach((metrics, lineNumber) => {
                if (!lineMetricsMap.has(lineNumber)) {
                    lineMetricsMap.set(lineNumber, new Map());
                }
                lineMetricsMap.get(lineNumber)!.set(profileName, {
                    metrics,
                    unit: entry.unit,
                });
            });
        });

        if (shouldLogDebug()) {
            this.logger.debug(`  ${filePath}: ${lineMetricsMap.size} lines with metrics`);
        }

        if (lineMetricsMap.size === 0) {
            return;
        }

        // Group decorations by color
        const decorationsByColor = new Map<string, vscode.DecorationOptions[]>();

        lineMetricsMap.forEach((profileMetrics, lineNumber) => {
            const hint = renderHint(profileMetrics, config);
            if (!hint) {
                return;
            }

            // Create decoration
            const line = lineNumber - 1; // VS Code lines are 0-indexed
            const decoration: vscode.DecorationOptions = {
                range: new vscode.Range(line, 1024, line, 1024), // End of line
                renderOptions: {
                    after: {
                        contentText: ` ${hint.text}`,
                        color: hint.color,
                        fontStyle: 'italic',
                        margin: '0 0 0 1em',
                    },
                },
            };

            // Group by color
            if (!decorationsByColor.has(hint.color)) {
                decorationsByColor.set(hint.color, []);
            }
            decorationsByColor.get(hint.color)!.push(decoration);
        });

        // Apply decorations
        decorationsByColor.forEach((decorations, color) => {
            const decorationType = this.getOrCreateDecorationType(color);
            editor.setDecorations(decorationType, decorations);
        });
    }

    /**
     * Get or create a decoration type for a specific color
     */
    private getOrCreateDecorationType(color: string): vscode.TextEditorDecorationType {
        if (!this.decorationTypes.has(color)) {
            const decorationType = vscode.window.createTextEditorDecorationType({
                after: {
                    color: color,
                    fontStyle: 'italic',
                },
            });
            this.decorationTypes.set(color, decorationType);
        }
        return this.decorationTypes.get(color)!;
    }

    /**
     * Clear all decorations from all editors
     */
    private clearAllDecorations(): void {
        this.decorationTypes.forEach((decorationType) => {
            vscode.window.visibleTextEditors.forEach((editor) => {
                editor.setDecorations(decorationType, []);
            });
        });
    }

    /**
     * Toggle hints visibility
     */
    public toggleHints(): void {
        this.enabled = !this.enabled;
        this.updateDecorations();
        vscode.window.showInformationMessage(
            `Pyroscope hints ${this.enabled ? 'enabled' : 'disabled'}`
        );
    }

    /**
     * Get current configuration
     */
    private getConfig(): HintConfig {
        const config = vscode.workspace.getConfiguration('pyroscope');

        // Get display profiles (new setting)
        let displayProfiles = config.get<string[]>('displayProfiles');

        // If not set or empty, use all loaded profiles
        if (!displayProfiles || displayProfiles.length === 0) {
            displayProfiles = this.profileStore.getLoadedProfileNames();
        }

        return {
            displayMode: config.get<'cpu' | 'memory' | 'both'>('displayMode', 'both'),
            colorScheme: config.get<'heatmap' | 'threshold' | 'minimal'>('colorScheme', 'heatmap'),
            threshold: config.get<number>('threshold', 1.0),
            displayProfiles,
        };
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this.clearAllDecorations();
        this.decorationTypes.forEach((decorationType) => decorationType.dispose());
        this.decorationTypes.clear();

        if (this.hoverProvider) {
            this.hoverProvider.dispose();
        }
    }
}
