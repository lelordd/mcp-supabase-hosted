import type { SelfhostedSupabaseClient } from '../client/index.js';

// Define log function type
type LogFunction = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Privilege levels for tools.
 * - 'regular': Safe read-only operations, can be called by any authenticated user
 * - 'privileged': Requires service_role key or direct DB connection, performs admin operations
 * - 'sensitive': Returns sensitive configuration data (keys, secrets) - use with caution
 */
export type ToolPrivilegeLevel = 'regular' | 'privileged' | 'sensitive';

/**
 * Defines the expected shape of the context object passed to tool execute functions.
 */
export interface ToolContext {
    selfhostedClient: SelfhostedSupabaseClient;
    log: LogFunction; // Explicitly define the log function
    workspacePath?: string; // Path to the workspace root
    [key: string]: unknown; // Allow other context properties, though log is now typed
} 