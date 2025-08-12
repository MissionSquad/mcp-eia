/**
 * This file is intended for exporting shared constants, types, or simple utility
 * functions that are used across multiple modules within the `src` directory.
 * Keeping shared elements here helps avoid circular dependencies.
 */

// Re-export constants from config.ts to make them easily accessible
export { apiKeyErrorMessage } from './config.js'

// Add any other shared elements below if needed.
// For example:
// export const DEFAULT_TIMEOUT = 5000;
// export type CommonStatus = 'pending' | 'processing' | 'completed' | 'failed';
