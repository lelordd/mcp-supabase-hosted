import type { SelfhostedSupabaseClient } from '../client/index.js';

// Define log function type
type LogFunction = (message: string, level?: 'info' | 'warn' | 'error') => void;

/**
 * Privilege levels for tools.
 * - 'regular': Safe read-only operations, can be called by any authenticated user
 * - 'privileged': Requires service_role key or direct DB connection, performs admin operations
 */
export type ToolPrivilegeLevel = 'regular' | 'privileged';

/**
 * User context from JWT authentication (HTTP mode only).
 */
export interface UserContext {
    userId: string;
    email: string | null;
    role: string;
}

/**
 * Maps JWT roles to allowed tool privilege levels.
 * - 'service_role': Can access all tools (regular + privileged)
 * - 'authenticated': Can only access regular tools
 * - 'anon': No tool access (anonymous users should not access MCP tools directly)
 *
 * SECURITY NOTE: Anonymous users are blocked from MCP tool access because:
 * 1. MCP tools provide admin-level database introspection
 * 2. Anon JWTs are meant for public API access, not admin tooling
 * 3. If anon access is needed, use authenticated role with appropriate RLS
 */
const ROLE_PRIVILEGE_MAP: Record<string, Set<ToolPrivilegeLevel>> = {
    service_role: new Set<ToolPrivilegeLevel>(['regular', 'privileged']),
    authenticated: new Set<ToolPrivilegeLevel>(['regular']),
    anon: new Set<ToolPrivilegeLevel>([]), // No access for anonymous users
};

/**
 * Checks if a JWT role can access a tool with the given privilege level.
 *
 * @param userRole - The role from the JWT token
 * @param toolPrivilegeLevel - The privilege level required by the tool
 * @returns true if access is allowed, false otherwise
 */
export function canAccessTool(
    userRole: string,
    toolPrivilegeLevel: ToolPrivilegeLevel
): boolean {
    // SECURITY: Use Object.hasOwn to prevent prototype pollution / object injection
    const allowedLevels = Object.hasOwn(ROLE_PRIVILEGE_MAP, userRole)
        ? ROLE_PRIVILEGE_MAP[userRole] // NOSONAR - validated via Object.hasOwn above
        : ROLE_PRIVILEGE_MAP.authenticated;
    return allowedLevels.has(toolPrivilegeLevel);
}

/**
 * Defines the expected shape of the context object passed to tool execute functions.
 */
export interface ToolContext {
    selfhostedClient: SelfhostedSupabaseClient;
    log: LogFunction; // Explicitly define the log function
    workspacePath?: string; // Path to the workspace root
    user?: UserContext; // User context from JWT (HTTP mode only)
    [key: string]: unknown; // Allow other context properties
} 