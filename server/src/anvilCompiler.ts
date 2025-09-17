/**
 * Anvil Compiler Wrapper for TypeScript
 *
 * This module provides a TypeScript interface to the Anvil compiler (bin/anvil).
 * It executes the binary with the -json flag and parses JSON output to extract
 * compilation errors with precise location information.
 *
 * JSON Format Parsed:
 * ```json
 * {
 *   "success": boolean,
 *   "errors": [
 *     {
 *       "type": "warning" | "error",
 *       "path": string | null,
 *       "trace": {
 *         "start": {
 *           "line": number,
 *           "col": number
 *         },
 *         "end": {
 *           "line": number,
 *           "col": number
 *         }
 *       } | null,
 *       "desc": string
 *     }
 *   ],
 *   "output": string | null
 * }
 * ```
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/**
 * JSON position structure from anvil compiler
 */
interface AnvilJsonPosition {
    line: number;
    col: number;
}

/**
 * JSON trace structure from anvil compiler
 */

interface AnvilJsonTrace {
    start: AnvilJsonPosition;
    end: AnvilJsonPosition;
}

type AnvilJsonFragment =
    | { kind: "text"; text: string }
    | { kind: "codespan"; text?: string; path?: string | null; trace: AnvilJsonTrace };

interface AnvilJsonError {
    type: "warning" | "error";
    path?: string | null;
    description: AnvilJsonFragment[];
}

/**
 * JSON error structure from anvil compiler
 */
interface AnvilJsonError {
    type: "warning" | "error";
    path?: string | null;
    trace?: AnvilJsonTrace | null;
    desc: string;
}

/**
 * JSON output structure from anvil compiler
 */
interface AnvilJsonOutput {
    success: boolean;
    errors: AnvilJsonError[];
    output?: string | null;
}


/**
 * Represents information about a compilation error from the Anvil compiler
 */
export interface AnvilCompilationErrorInfo {
    /** The absolute file path where the error occurred */
    filepath: string;
    /** The line number (1-based) where the error starts */
    startLine: number;
    /** The column number (1-based) where the error starts */
    startCol: number;
    /** The line number (1-based) where the error ends */
    endLine: number;
    /** The column number (1-based) where the error ends */
    endCol: number;
    /** The full error message description */
    message: string;
}

/**
 * Represents a compilation error from the Anvil compiler
 */
export interface AnvilCompilationError extends AnvilCompilationErrorInfo {
    /** The error type: "warning" or "error" */
    type: "warning" | "error";

    /** Other supplementary information about the error */
    supplementaryInfo?: AnvilCompilationErrorInfo[];
}

/**
 * Result of compiling an Anvil file
 */
export interface AnvilCompilationResult {
    /** Whether the compilation was successful (no errors) */
    success: boolean;
    /** Array of parsed compilation errors */
    errors: AnvilCompilationError[];
    /** Raw stderr output from the compiler */
    stderr: string;
    /** Raw stdout output from the compiler */
    stdout: string;
}

/**
 * Anvil compiler wrapper that executes the bin/anvil binary and parses compilation errors.
 * 
 * @example
 * ```typescript
 * const compiler = new AnvilCompiler('/path/to/project');
 * const result = await compiler.compile('src/example.anvil');
 * 
 * if (!result.success) {
 *   result.errors.forEach(error => {
 *     console.log(`${error.filepath}:${error.trace.start.line}:${error.trace.start.col} - ${error.message}`);
 *   });
 * }
 * ```
 */
export class AnvilCompiler {
    private readonly projectRoot: string;
    private readonly anvilBinaryPath: string;

    private static IMPORT_REGEX = /^\s*import\s+"(([^"]|\\")+)"\s*$/gm;

    constructor(projectRoot?: string, anvilBinaryPath?: string) {
        this.projectRoot = projectRoot || process.cwd();
        this.anvilBinaryPath = anvilBinaryPath || 'anvil';
    }

    /**
     * Compile one or more Anvil files using JSON output
     * @param filePaths Array of file paths to compile
     * @returns Promise<CompilationResult>
     */
    async compile(filePaths: string | string[], fileData?: Record<string, string>): Promise<AnvilCompilationResult> {
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        fileData = {...fileData}; // Clone fileData

        const inputContents = await this.importReferencedFiles(files, fileData);
        const { mergedContent, lineOffsets, unknownPaths } = this.mergeContentForStdin(inputContents);

        function lookupOriginalLocationFromLineNumber(lineNumber: number): { filePath: string, line: number } | null {
            let closestLineOffset = -1;
            let closestFilePath = '';

            const lineOffset = lineNumber - 1;

            for (const [filePath, offset] of Object.entries(lineOffsets)) {
                if (offset <= lineOffset && offset > closestLineOffset) {
                    closestLineOffset = offset;
                    closestFilePath = filePath;
                }
            }

            if (closestLineOffset === -1) {
                console.warn(`Could not map line number ${lineNumber} to any input file!`);
                return null;
            }

            return { filePath: closestFilePath, line: lineOffset - closestLineOffset + 1 };
        }

        if (process.env.DEBUG) {
            console.log('Input files:', files);
            console.log("File data contents:", inputContents);

            console.log("Merged:");
            for (const [i, line] of mergedContent.split('\n').entries()) {
                console.log(`  ${i + 1}: ${line}`);
            }

            console.log('Line offsets:', lineOffsets);
            console.log();
        }

        return new Promise((resolve) => {
            // Use -json flag to get structured output
            const args = ['-json', ...unknownPaths, '/dev/stdin'];
            console.log("Running anvil with args:", args);
            const process = spawn(this.anvilBinaryPath, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.projectRoot
            });

            let stdout = '';
            let stderr = '';

            process.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                try {
                    // Parse JSON output from stdout
                    const jsonOutput: AnvilJsonOutput = JSON.parse(stdout);
                    const errors = this.convertJsonErrors(jsonOutput.errors, l => lookupOriginalLocationFromLineNumber(l));
                    
                    resolve({
                        success: jsonOutput.success,
                        errors,
                        stderr,
                        stdout
                    });
                } catch (parseError) {
                    // If JSON parsing fails, treat as compilation error
                    resolve({
                        success: false,
                        errors: [{
                            type: 'error',
                            filepath: '',
                            startLine: 1,
                            startCol: 0,
                            endLine: 1,
                            endCol: Number.MAX_VALUE,
                            message: `Failed to parse compiler output as JSON: ${parseError}\n\nRaw output:\n${stdout}\n\nRaw stderr:\n${stderr}`
                        }],
                        stderr,
                        stdout
                    });
                }
            });

            process.on('error', (error) => {
                resolve({
                    success: false,
                    errors: [{
                        type: 'error',
                        filepath: '',
                        startLine: 1,
                        startCol: 0,
                        endLine: 1,
                        endCol: Number.MAX_VALUE,
                        message: 
                            `Failed to execute anvil compiler: ${error.message}\n\n` +
                            `Ensure it's in your PATH or specified correctly in Anvil Language Server extension settings`
                    }],
                    stderr: error.message,
                    stdout: ''
                });
            });

            // Write merged content to stdin
            process.stdin.write(mergedContent + '\n');
            process.stdin.end();
        });
    }

    /**
     * Convert JSON errors from anvil compiler to our interface
     * @param jsonErrors Array of JSON errors from compiler
     * @returns Array of AnvilCompilationError objects
     */
    private convertJsonErrors(
        jsonErrors: AnvilJsonError[],
        lookupOriginalLocation: (line: number) => { filePath: string, line: number } | null
    ): AnvilCompilationError[] {
        return jsonErrors.map(error => {
            const LINE_OFFSET = 0; // Anvil lines are 1-based (no offset needed)
            const COL_OFFSET = 1;  // Anvil compiler columns are 0-based (+1 offset needed)

            // Find the first codespan fragment
            const codespan = error.description.find(f => f.kind === "codespan") as (AnvilJsonFragment & { kind: "codespan" }) | undefined;
            
            let startLine = 1, endLine = 1, startCol = 0, endCol = 0, filepath = error.path || '';

            if (codespan && codespan.trace) {
                startLine = codespan.trace.start.line;
                endLine = codespan.trace.end.line;
                startCol = codespan.trace.start.col;
                endCol = codespan.trace.end.col;
                if (codespan.path) {
                    filepath = codespan.path;
                }
            }

            const originalStartLocation = lookupOriginalLocation(startLine);
            const originalEndLocation = lookupOriginalLocation(endLine);

            startLine = originalStartLocation?.line || startLine;
            endLine = originalEndLocation?.line || endLine;
            filepath = originalStartLocation?.filePath || error.path || filepath;
            
            // Assemble full error message from all text fragments
            let message = '';
            const numberOfCodespanFragments = error.description.filter(f => f.kind === "codespan").length;
            for (const fragment of error.description) {
                if (fragment.kind === "text" && fragment.text) {
                    message += fragment.text + '\n';
                } else if (fragment.kind === "codespan" && numberOfCodespanFragments > 1) {
                    const originalFragmentStart = lookupOriginalLocation(fragment.trace.start.line);
                    if (originalFragmentStart) {
                        const relPath = path.relative(this.projectRoot, originalFragmentStart.filePath);
                        message += `${relPath}:${originalFragmentStart.line}:${fragment.trace.start.col}:\n`;
                    }

                    message += (fragment.text || '') + '\n';
                }
            }

            // Assemble supplementary info if multiple codespans
            let supplementaryInfo: AnvilCompilationErrorInfo[] = [];
            if (numberOfCodespanFragments > 1) {
                let codespanDescribedBy = ""; // Text immediately preceding the codespan
                for (const fragment of error.description) {
                    switch (fragment.kind) {
                        case "text":
                            codespanDescribedBy = fragment.text?.trim().replace(/:$/, '');
                            break;
                        case "codespan":
                            const originalFragmentStart = lookupOriginalLocation(fragment.trace.start.line);
                            const originalFragmentEnd = lookupOriginalLocation(fragment.trace.end.line);
                            if (!originalFragmentStart || !originalFragmentEnd) continue;

                            let fragmentFilePath = filepath;
                            if (fragment.path) {
                                fragmentFilePath = fragment.path;
                            }
                            
                            supplementaryInfo.push({
                                filepath: originalFragmentStart.filePath,
                                startLine: originalFragmentStart.line + LINE_OFFSET,
                                startCol: fragment.trace.start.col + COL_OFFSET,
                                endLine: originalFragmentEnd.line + LINE_OFFSET,
                                endCol: fragment.trace.end.col + COL_OFFSET,
                                message: codespanDescribedBy.trim(),
                            });

                            codespanDescribedBy = "";
                    }
                }
            }

            return {
                type: error.type,
                filepath,
                startLine: startLine + LINE_OFFSET,
                startCol: startCol + COL_OFFSET,
                endLine: endLine + LINE_OFFSET,
                endCol: endCol + COL_OFFSET,
                message: message,
                supplementaryInfo: supplementaryInfo.length > 0 ? supplementaryInfo : undefined
            };
        });
    }

    /**
     * Merge filepaths and their content into a single stream for compilation via standard input.
     * 
     * @param pathContentPairs List of [filepath, content] pairs to process.
     * @returns Merged content string suitable for stdin, together with a map of each file's line offsets.
     */
    private mergeContentForStdin(pathContentPairs: [string, string | null][]): { mergedContent: string, lineOffsets: Record<string, number> , unknownPaths: string[]} {
        let mergedContent = '';
        const lineOffsets: Record<string, number> = {};
        let currentLine = 0;

        const unknownPaths: string[] = [];

        for (const [filePath, content] of pathContentPairs) {
            if (content === null) {
                const absolutePath = path.resolve(this.projectRoot, filePath);
                unknownPaths.push(absolutePath);
                continue; // Skip missing files
            }

            lineOffsets[filePath] = currentLine + 1; // +1 to the line after the comment

            mergedContent += `// ${filePath}\n`;
            mergedContent += content

            if (!content.endsWith('\n')) {
                mergedContent += '\n';
                currentLine += 1;
            }

            mergedContent += '\n';

            currentLine += content.split('\n').length + 1;
        }

        return { mergedContent, lineOffsets, unknownPaths };
    }

    /**
     * Automatically collects imports from a base set of cached file data. This also modifies the file data map in-place.
     * 
     * @param filePaths Initial list of files to process
     * @param fileData Map of file paths and their content (if available)
     * 
     * @returns Array of [filePath, content] tuples ordered by dependency (deepest first)
     */
    private async importReferencedFiles(filePaths: string[], fileData: Record<string, string | null> = {}): Promise<[string, string | null][]> {
        const dependencyGraph: Map<string, string[]> = new Map();
        const imports = [...filePaths];

        const resolvedPath = (base: string, p: string): string => {
            const absPath = path.resolve(base, p);
            if (absPath.startsWith(this.projectRoot)) {
                return path.relative(this.projectRoot, absPath);
            }
            return absPath;
        }

        let i: number;
        for (i = 0; i < imports.length; i++) {
            const importPath = imports[i];
            
            if (!fileData[importPath]) {
                // Try to read file content if not already cached
                try {
                    const content = await fs.readFile(importPath, 'utf-8');
                    fileData[importPath] = content;
                } catch (e) {
                    // Ignore missing files, they will be reported by the compiler
                    fileData[importPath] = null;
                    dependencyGraph.set(importPath, []);
                    continue;
                }
            }

            if (dependencyGraph.has(importPath)) {
                continue; // Already processed
            }

            try {
                const extractedImports = this.extractImports(fileData[importPath]);
                
                // Resolve relative to current file
                for (let j = 0; j < extractedImports.length; j++) {
                    extractedImports[j] = resolvedPath(path.dirname(importPath), extractedImports[j]);
                }

                if (process.env.DEBUG) {
                    console.log(`File ${importPath} imports:`, extractedImports);
                    console.log();
                }

                imports.push(...extractedImports);
                dependencyGraph.set(importPath, extractedImports);
            } catch (e) {
                // Ignore missing files, they will be reported by the compiler
                dependencyGraph.set(importPath, []);
            }
        }

        // Strip out all imports that have been collected
        for (const [filePath, content] of Object.entries(fileData)) {
            if (!content) continue;
            fileData[filePath] = this.stripImports(content, (importPath) => {
                const p = resolvedPath(path.dirname(filePath), importPath);
                if (fileData[p] == null) {
                    const absPath = path.resolve(this.projectRoot, p);
                    return absPath;
                }
                return fileData[p] != null;
            });
        }

        // Collect all imported files from dependency graph by topological order (deepest first)
        const allImports: [string, string | null][] = [];

        const visited = new Set<string>();
        const visit = (filePath: string) => {
            if (visited.has(filePath)) return;
            visited.add(filePath);

            const deps = dependencyGraph.get(filePath) || [];
            for (const dep of deps) {
                visit(dep);
            }

            allImports.push([filePath, fileData[filePath]]);
        }

        for (const filePath of dependencyGraph.keys()) {
            visit(filePath);
        }

        return allImports;
    }

    /**
     * Extract import statements from file content.
     * @param content File content as string
     * @returns Array of imported file paths
     * 
     * Example import statement: import "relative/file/path.anvil"
     */
    private extractImports(content: string): string[] {
        const imports: string[] = [];
        let match: RegExpExecArray | null;

        while ((match = AnvilCompiler.IMPORT_REGEX.exec(content)) !== null) {
            let path = match[1].replace(/\\"/g, '"'); // Unescape quotes
            imports.push(path);
        }
        return imports;
    }

    /**
     * Strip imports from file content.
     * 
     * @param content File content as string
     * @param shouldStrip Callback to verify whether to strip a given import
     * 
     * @returns Content with import statements removed
     */
    private stripImports(content: string, shouldStrip: (importPath: string) => string | boolean = () => true): string {
        return content.replace(AnvilCompiler.IMPORT_REGEX, (match, importPath) => {
            const result = shouldStrip(importPath.replace(/\\"/g, '"'));
            if (!result) {
                return match;
            }
            if (typeof result === "string") {
                return match.replace(importPath, result.replace(/"/g, '\\"'));
            }
            return "// STRIPPED: " + match;
        }).trim();
    }

    /**
     * Get the path to the anvil binary
     */
    getAnvilBinaryPath(): string {
        return this.anvilBinaryPath;
    }
}

/**
 * Convenience function to compile Anvil files
 * @param filePaths File path(s) to compile
 * @param projectRoot Optional project root directory
 * @returns Promise<CompilationResult>
 */
export async function compileAnvil(
    filePaths: string | string[], 
    projectRoot?: string
): Promise<AnvilCompilationResult> {
    const compiler = new AnvilCompiler(projectRoot);
    return compiler.compile(filePaths);
}
