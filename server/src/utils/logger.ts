/**
 * Logging utility for the Anvil Language Server.
 * Wraps JavaScript built-in loggers with a consistent "[...] ..." format.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

/**
 * Creates a logger with the specified prefix.
 * All log messages will be prefixed with "[prefix] message".
 */
export function createLogger(prefix: string) {
  const formatMessage = (message: unknown, ...optionalParams: unknown[]): [string, ...unknown[]] => {
    const formattedMessage = `[${prefix}] ${message}`;
    return [formattedMessage, ...optionalParams];
  };

  return {
    /**
     * Log a debug message.
     * Note: console.debug is not used; this uses console.log for compatibility.
     */
    debug: (message: unknown, ...optionalParams: unknown[]): void => {
      console.log(...formatMessage(message, ...optionalParams));
    },

    /**
     * Log an info message.
     */
    info: (message: unknown, ...optionalParams: unknown[]): void => {
      console.log(...formatMessage(message, ...optionalParams));
    },

    /**
     * Log a warning message.
     */
    warn: (message: unknown, ...optionalParams: unknown[]): void => {
      console.warn(...formatMessage(message, ...optionalParams));
    },

    /**
     * Log an error message.
     */
    error: (message: unknown, ...optionalParams: unknown[]): void => {
      console.error(...formatMessage(message, ...optionalParams));
    },

    /**
     * Log a message (alias for info).
     */
    log: (message: unknown, ...optionalParams: unknown[]): void => {
      console.log(...formatMessage(message, ...optionalParams));
    },
  };
}

/**
 * Default logger for server-wide logging.
 */
export const serverLogger = createLogger('Server');

/**
 * Logger for AST operations.
 */
export const astLogger = createLogger('AST');

/**
 * Logger for completion operations.
 */
export const completionLogger = createLogger('Completion');

/**
 * Logger for signature help operations.
 */
export const signatureHelpLogger = createLogger('SignatureHelp');

/**
 * Logger for compiler operations.
 */
export const compilerLogger = createLogger('Compiler');

/**
 * Logger for diagnostics operations.
 */
export const diagnosticsLogger = createLogger('Diagnostics');

/**
 * Logger for inlay hint operations.
 */
export const inlayHintLogger = createLogger('InlayHint');
