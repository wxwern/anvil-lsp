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
 *         "line": number,
 *         "col": number,
 *         "len": number
 *       } | null,
 *       "desc": string
 *     }
 *   ],
 *   "output": string | null
 * }
 * ```
 */

import { spawn } from 'child_process';

/**
 * JSON error structure from anvil compiler
 */
interface AnvilJsonError {
    type: "warning" | "error";
    path?: string | null;
    trace?: {
        line: number;
        col: number;
        len: number;
    } | null;
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
 * Represents a compilation error from the Anvil compiler
 */
export interface AnvilCompilationError {
    /** The error type: "warning" or "error" */
    type: "warning" | "error";
    /** The absolute file path where the error occurred */
    filepath: string;
    /** The line number (1-based) where the error occurred */
    line: number;
    /** The column number (1-based) where the error occurred */
    col: number;
    /** The number of characters in the error */
    length: number;
    /** The full error message description */
    message: string;
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
 *     console.log(`${error.filepath}:${error.line}:${error.col} - ${error.message}`);
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
    async compile(filePaths: string | string[]): Promise<AnvilCompilationResult> {
        const files = Array.isArray(filePaths) ? filePaths : [filePaths];
        
        return new Promise((resolve) => {
            // Use -json flag to get structured output
            const args = ['-json', ...files];
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
                    const errors = this.convertJsonErrors(jsonOutput.errors);
                    
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
                            line: 0,
                            col: 0,
                            length: 1,
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
                        line: 0,
                        col: 0,
                        length: Number.MAX_VALUE,
                        message: 
                            `Failed to execute anvil compiler: ${error.message}\n\n` +
                            `Ensure it's in your PATH or specified correctly in Anvil Language Server extension settings`
                    }],
                    stderr: error.message,
                    stdout: ''
                });
            });
        });
    }

    /**
     * Convert JSON errors from anvil compiler to our interface
     * @param jsonErrors Array of JSON errors from compiler
     * @returns Array of AnvilCompilationError objects
     */
    private convertJsonErrors(jsonErrors: AnvilJsonError[]): AnvilCompilationError[] {
        return jsonErrors.map(error => ({
            type: error.type,
            filepath: error.path || '',
            line: error.trace?.line || 0,
            col: error.trace?.col || 0,
            length: error.trace?.len || 1,
            message: error.desc
        }));
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
