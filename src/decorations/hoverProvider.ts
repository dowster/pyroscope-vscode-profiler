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

        const fileMetrics = this.profileStore.getMetricsForFile(filePath);
        if (!fileMetrics) {
            return null;
        }

        const metrics = fileMetrics.get(lineNumber);
        if (!metrics) {
            return null;
        }

        const markdown = this.formatMetrics(metrics);
        return new vscode.Hover(markdown);
    }

    private formatMetrics(metrics: LineMetrics): vscode.MarkdownString {
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.supportHtml = true;

        md.appendMarkdown('### 🔥 Pyroscope Profile Data\n\n');

        // CPU Metrics
        if (metrics.cpuSamples > 0) {
            md.appendMarkdown('**CPU Usage:**\n\n');
            md.appendMarkdown(`- Self: ${this.formatPercent(metrics.selfCpuPercent)}\n`);
            md.appendMarkdown(`- Cumulative: ${this.formatPercent(metrics.cpuPercent)}\n`);
            md.appendMarkdown(`- Samples: ${metrics.cpuSamples.toLocaleString()}\n\n`);
        }

        // Memory Metrics
        if (metrics.memoryBytes > 0) {
            md.appendMarkdown('**Memory Allocation:**\n\n');
            md.appendMarkdown(`- Self: ${this.formatPercent(metrics.selfMemoryPercent)}\n`);
            md.appendMarkdown(`- Cumulative: ${this.formatPercent(metrics.memoryPercent)}\n`);
            md.appendMarkdown(`- Bytes: ${this.formatBytes(metrics.memoryBytes)}\n`);
            if (metrics.allocations > 0) {
                md.appendMarkdown(`- Allocations: ${metrics.allocations.toLocaleString()}\n`);
            }
            md.appendMarkdown('\n');
        }

        // Explanation
        md.appendMarkdown('---\n\n');
        md.appendMarkdown('*Self: time/memory spent in this line*\n\n');
        md.appendMarkdown('*Cumulative: includes time/memory in called functions*\n');

        return md;
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

    private formatBytes(bytes: number): string {
        if (bytes === 0) {
            return '0 B';
        }

        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const value = bytes / Math.pow(k, i);

        if (i === 0) {
            return `${value} ${sizes[i]}`;
        } else if (value >= 100) {
            return `${value.toFixed(0)} ${sizes[i]}`;
        } else if (value >= 10) {
            return `${value.toFixed(1)} ${sizes[i]}`;
        } else {
            return `${value.toFixed(2)} ${sizes[i]}`;
        }
    }
}
