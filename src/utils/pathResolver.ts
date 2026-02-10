import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { shouldLogDebug } from './logger';

export interface PathMapping {
    from: string;
    to: string;
}

export class PathResolver {
    private workspaceFolders: readonly vscode.WorkspaceFolder[];
    private pathMappings: PathMapping[];
    private logger: vscode.LogOutputChannel;

    constructor(logger: vscode.LogOutputChannel) {
        this.workspaceFolders = vscode.workspace.workspaceFolders || [];
        this.pathMappings = this.loadPathMappings();
        this.logger = logger;
    }

    private loadPathMappings(): PathMapping[] {
        const config = vscode.workspace.getConfiguration('pyroscope');
        const mappings = config.get<PathMapping[]>('pathMappings', []);

        // Substitute ${workspaceFolder} variable
        return mappings.map((m) => ({
            from: m.from,
            to: this.substituteVariables(m.to),
        }));
    }

    private substituteVariables(pathStr: string): string {
        if (this.workspaceFolders.length > 0) {
            return pathStr.replace('${workspaceFolder}', this.workspaceFolders[0].uri.fsPath);
        }
        return pathStr;
    }

    public resolveFilePath(profilePath: string): string | null {
        this.logger.trace(`Resolving: ${profilePath}`);

        // Strategy 1: Apply path mappings
        for (const mapping of this.pathMappings) {
            if (profilePath.startsWith(mapping.from)) {
                const relativePath = profilePath.substring(mapping.from.length);
                const mappedPath = path.join(mapping.to, relativePath);

                if (fs.existsSync(mappedPath)) {
                    this.logger.debug(`✓ Mapped: ${profilePath} → ${mappedPath}`);
                    return mappedPath;
                }
                this.logger.trace(`  Mapping didn't exist: ${mappedPath}`);
            }
        }

        // Strategy 2: Try as absolute path
        if (path.isAbsolute(profilePath) && fs.existsSync(profilePath)) {
            this.logger.debug(`✓ Absolute path exists: ${profilePath}`);
            return profilePath;
        }

        // Strategy 3: Relative to workspace folders
        for (const folder of this.workspaceFolders) {
            const candidatePath = path.join(folder.uri.fsPath, profilePath);
            if (fs.existsSync(candidatePath)) {
                this.logger.debug(`✓ Workspace relative: ${profilePath} → ${candidatePath}`);
                return candidatePath;
            }
        }

        // Strategy 4: Basename fallback with collision detection
        const basename = path.basename(profilePath);
        const matches = this.findFilesByBasename(basename);

        if (matches.length === 1) {
            this.logger.warn(`⚠ Using basename fallback: ${profilePath} → ${matches[0]}`);
            return matches[0];
        } else if (matches.length > 1) {
            this.logger.warn(
                `⚠ Multiple files match basename "${basename}": ${matches.join(', ')}`
            );
            return null;
        }

        this.logger.warn(`✗ Path not resolved: ${profilePath}`);
        return null;
    }

    private findFilesByBasename(basename: string): string[] {
        // Search workspace for files matching basename
        const matches: string[] = [];
        for (const folder of this.workspaceFolders) {
            // Simple recursive search
            this.searchDirectory(folder.uri.fsPath, basename, matches);
        }
        return matches;
    }

    private searchDirectory(dir: string, basename: string, results: string[]): void {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    this.searchDirectory(fullPath, basename, results);
                } else if (entry.isFile() && entry.name === basename) {
                    results.push(fullPath);
                }
            }
        } catch (e) {
            // Skip directories we can't read
        }
    }
}
