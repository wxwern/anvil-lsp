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
import { AnvilAST, AnvilASTOutput } from './anvilAST';

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
    /** Anvil AST representation */
    ast?: AnvilAST;
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

        if (!files || files.length === 0) {
            return {
                success: true,
                errors: [],
                stderr: '',
                stdout: ''
            };
        }

        if (files.length > 1) {
            return {
                success: false,
                errors: [{
                    type: 'error',
                    filepath: '',
                    startLine: 1,
                    startCol: 0,
                    endLine: 1,
                    endCol: Number.MAX_VALUE,
                    message: 'AnvilCompiler only supports compiling one file at a time, but language server was asked to compile multiple files.'
                }],
                stderr: '',
                stdout: ''
            };
        }

        const hasInMemoryData = fileData[files[0]] !== undefined;

        if (process.env.DEBUG) {
            console.log('Input files:', files);
            console.log();
        }

        // Use -json flag to get structured output
        const args = hasInMemoryData ? ['-json', '-stdin', files[0]] : ['-json', files[0]];
        try {
            const stdinData = hasInMemoryData ? fileData[files[0]] : undefined
            const result = await this.runAnvil(args, stdinData);

            const { stdout, stderr, exitCode } = result;

            let astOutput: AnvilAST | undefined = undefined;

            let errors: AnvilCompilationError[] = [];

            try {
                const result = await this.runAnvil(['-ast', ...args], stdinData);
                const jsonOutput = JSON.parse(result.stdout);

                errors.push(...this.convertJsonErrors(jsonOutput.errors));

                if (jsonOutput.success && jsonOutput.output) {
                    astOutput = new AnvilAST(jsonOutput.output);
                }

            } catch (e) {
                console.error("Error parsing AST output:", e);
            }

            try {
                const jsonOutput: AnvilJsonOutput = JSON.parse(stdout);
                const errors = this.convertJsonErrors(jsonOutput.errors);

                return {
                    success: jsonOutput.success,
                    errors,
                    stderr,
                    stdout,
                    ast: astOutput
                };
            } catch (parseError) {
                // If JSON parsing fails, treat as compilation error
                console.error("Error parsing compiler output:", parseError);
                return {
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
                };
            }

        } catch (error) {
            console.error("Error spawning anvil process:", error);

            return {
                success: false,
                errors: [{
                    type: 'error',
                    filepath: '',
                    startLine: 1,
                    startCol: 0,
                    endLine: 1,
                    endCol: Number.MAX_VALUE,
                    message:
                        `Failed to execute anvil compiler: ${error instanceof Error ? error.message : String(error)}\n\n` +
                        `Ensure it's in your PATH or specified correctly in Anvil Language Server extension settings`
                }],
                stderr: error instanceof Error ? error.message : String(error),
                stdout: ''
            };
        }
    }

    private runAnvil(
        args: string[], stdinData?: string
    ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {

        return new Promise((resolve, reject) => {
            console.log(`Running anvil: ${this.anvilBinaryPath} ${args.join(' ')}`);
            const proc = spawn(this.anvilBinaryPath, args, { cwd: this.projectRoot, stdio: 'pipe' });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                resolve({ stdout, stderr, exitCode: code });
            });

            proc.on('error', (error) => {
                reject(error);
            });

            if (stdinData) {
                proc.stdin.write(stdinData + '\n');
            }

            proc.stdin.end();
        });
    }

    /**
     * Convert JSON errors from anvil compiler to our interface
     * @param jsonErrors Array of JSON errors from compiler
     * @returns Array of AnvilCompilationError objects
     */
    private convertJsonErrors(
        jsonErrors: AnvilJsonError[]
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

            // Assemble full error message from all text fragments
            let message = '';
            const numberOfCodespanFragments = error.description.filter(f => f.kind === "codespan").length;
            for (const fragment of error.description) {
                if (fragment.kind === "text" && fragment.text) {
                    message += fragment.text || '';
                } else if (fragment.kind === "codespan" && numberOfCodespanFragments > 1) {
                    const relPath = path.relative(this.projectRoot, fragment.path || filepath);
                    message += `${relPath}:${fragment.trace.start.line}:${fragment.trace.start.col}:\n`;
                    message += (fragment.text || '')
                }
                if (fragment.text && !fragment.text.endsWith('\n')) {
                    message += '\n';
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
                            supplementaryInfo.push({
                                filepath: fragment.path || filepath,
                                startLine: fragment.trace.start.line + LINE_OFFSET,
                                startCol: fragment.trace.start.col + COL_OFFSET,
                                endLine: fragment.trace.end.line + LINE_OFFSET,
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
