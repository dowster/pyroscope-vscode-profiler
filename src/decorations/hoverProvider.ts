import * as vscode from 'vscode';
import { ProfileStore } from '../state/profileStore';
import { LineMetrics } from '../parser/sourceMapper';

export class PyroscopeHoverProvider implements vscode.HoverProvider {
    constructor(private profileStore: ProfileStore) {}

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const lineNumber = position.line + 1; // VS Code lines are 0-indexed
        const filePath = document.uri.fsPath;

        const loadedProfiles = this.profileStore.getLoadedProfileNames();
        if (loadedProfiles.length === 0) {
            return null;
        }

        const sections: string[] = [];

        loadedProfiles.forEach((profileName) => {
            const entry = this.profileStore.getProfileEntry(profileName);
            if (!entry) {
                return;
            }

            const fileMetrics = this.profileStore.getMetricsForProfile(profileName, filePath);
            const metrics = fileMetrics?.get(lineNumber);
            if (!metrics) {
                return;
            }

            sections.push(this.formatProfileSection(profileName, metrics, entry.unit));
        });

        if (sections.length === 0) {
            return null;
        }

        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;
        markdown.appendMarkdown('### 🔥 Pyroscope Profile Data\n\n');
        markdown.appendMarkdown(sections.join('\n\n---\n\n'));

        return new vscode.Hover(markdown);
    }

    private formatProfileSection(name: string, metrics: LineMetrics, unit: string): string {
        let section = `**${name.toUpperCase()} Profile**\n\n`;

        if (unit === 'nanoseconds') {
            // CPU profile
            section += `- **Self CPU**: ${this.formatPercent(metrics.selfCpuPercent)}`;
            if (metrics.selfCpuNanoseconds > 0) {
                section += ` (${this.formatNanoseconds(metrics.selfCpuNanoseconds)})`;
            }
            section += '\n';
            section += `- **Cumulative CPU**: ${this.formatPercent(metrics.cpuPercent)}`;
            if (metrics.cpuNanoseconds > 0) {
                section += ` (${this.formatNanoseconds(metrics.cpuNanoseconds)})`;
            }
            section += '\n';
            section += `- **Samples**: ${metrics.cpuSamples.toLocaleString()}\n`;
        } else if (unit === 'bytes') {
            // Memory profile
            section += `- **Self Memory**: ${this.formatBytes(metrics.memoryBytes)} (${this.formatPercent(metrics.selfMemoryPercent)})\n`;
            section += `- **Cumulative Memory**: ${this.formatPercent(metrics.memoryPercent)}\n`;
            if (metrics.allocations > 0) {
                section += `- **Allocations**: ${metrics.allocations.toLocaleString()}\n`;
            }
        } else if (unit === 'count') {
            // Generic count (goroutines, blocks, etc.)
            section += `- **Count**: ${metrics.cpuSamples.toLocaleString()}\n`;
            section += `- **Percentage**: ${this.formatPercent(metrics.cpuPercent)}\n`;
        } else {
            // Unknown - show generic info
            section += `- **Value**: ${this.formatPercent(metrics.cpuPercent)}\n`;
            section += `- **Unit**: ${unit}\n`;
        }

        return section;
    }

    private formatPercent(value: number): string {
        if (value >= 10) {
            return `**${value.toFixed(1)}%**`;
        } else if (value >= 1) {
            return `${value.toFixed(2)}%`;
        } else {
            return `${value.toFixed(3)}%`;
        }
    }

    private formatNanoseconds(nanoseconds: number): string {
        if (nanoseconds === 0) {
            return '0ns';
        }

        const microseconds = nanoseconds / 1000;
        const milliseconds = microseconds / 1000;
        const seconds = milliseconds / 1000;
        const minutes = seconds / 60;

        if (minutes >= 1) {
            return `${minutes.toFixed(2)}min`;
        } else if (seconds >= 1) {
            return `${seconds.toFixed(2)}s`;
        } else if (milliseconds >= 1) {
            return `${milliseconds.toFixed(2)}ms`;
        } else if (microseconds >= 1) {
            return `${microseconds.toFixed(2)}μs`;
        } else {
            return `${nanoseconds.toFixed(0)}ns`;
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const value = bytes / Math.pow(k, i);

        if (i === 0) {
            return `${value.toLocaleString()} ${sizes[i]}`;
        } else if (value >= 100) {
            return `${value.toFixed(0)} ${sizes[i]}`;
        } else if (value >= 10) {
            return `${value.toFixed(1)} ${sizes[i]}`;
        } else {
            return `${value.toFixed(2)} ${sizes[i]}`;
        }
    }
}
