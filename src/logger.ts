import { config } from './config.js'

/**
 * Defines the available log levels and their severity order.
 */
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const // Use 'as const' for stricter typing

type LogLevel = keyof typeof logLevels

/**
 * A simple logger that writes messages to stderr based on the configured log level.
 * Using stderr for logs is common practice in CLI/server applications,
 * keeping stdout free for primary data output (like MCP responses).
 */
export const logger = {
  /**
   * Logs an error message. Always displayed unless logLevel is explicitly invalid.
   * @param message The main log message.
   * @param args Additional arguments to log (e.g., error objects, context).
   */
  error: (message: string, ...args: any[]): void => {
    if (logLevels[config.logLevel as LogLevel] >= logLevels.error) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args)
    }
  },

  /**
   * Logs a warning message. Displayed if logLevel is 'warn', 'info', or 'debug'.
   * @param message The main log message.
   * @param args Additional arguments to log.
   */
  warn: (message: string, ...args: any[]): void => {
    if (logLevels[config.logLevel as LogLevel] >= logLevels.warn) {
      console.error(`[WARN]  ${new Date().toISOString()} - ${message}`, ...args)
    }
  },

  /**
   * Logs an informational message. Displayed if logLevel is 'info' or 'debug'.
   * @param message The main log message.
   * @param args Additional arguments to log.
   */
  info: (message: string, ...args: any[]): void => {
    if (logLevels[config.logLevel as LogLevel] >= logLevels.info) {
      console.error(`[INFO]  ${new Date().toISOString()} - ${message}`, ...args)
    }
  },

  /**
   * Logs a debug message. Displayed only if logLevel is 'debug'.
   * Useful for detailed tracing during development.
   * @param message The main log message.
   * @param args Additional arguments to log.
   */
  debug: (message: string, ...args: any[]): void => {
    if (logLevels[config.logLevel as LogLevel] >= logLevels.debug) {
      // Use console.debug for potential browser filtering capabilities
      console.debug(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args)
    }
  },
}
