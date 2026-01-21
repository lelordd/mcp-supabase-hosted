import { z } from 'zod';
import type { SqlExecutionResult, SqlErrorResponse } from '../types/index.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SelfhostedSupabaseClient } from '../client/index.js';

const execAsync = promisify(exec);

/**
 * Type guard to check if a SQL execution result is an error response.
 */
export function isSqlErrorResponse(result: SqlExecutionResult): result is SqlErrorResponse {
    return (result as SqlErrorResponse).error !== undefined;
}

/**
 * Handles SQL execution results and validates them against the expected schema.
 * Throws an error if the result contains an error or doesn't match the schema.
 */
export function handleSqlResponse<T>(result: SqlExecutionResult, schema: z.ZodSchema<T>): T {
    // Check if the result contains an error
    if ('error' in result) {
        throw new Error(`SQL Error (${result.error.code}): ${result.error.message}`);
    }

    // Validate the result against the schema
    try {
        return schema.parse(result);
    } catch (validationError) {
        if (validationError instanceof z.ZodError) {
            throw new Error(`Schema validation failed: ${validationError.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        }
        throw new Error(`Unexpected validation error: ${validationError}`);
    }
}

/**
 * Executes an external shell command asynchronously.
 * Returns stdout, stderr, and any execution error.
 */
export async function runExternalCommand(command: string): Promise<{
    stdout: string;
    stderr: string;
    error: Error | null;
}> {
    try {
        const { stdout, stderr } = await execAsync(command);
        return { stdout, stderr, error: null };
    } catch (error: unknown) {
        // execAsync throws on non-zero exit code, includes stdout/stderr in the error object
        const execError = error as Error & { stdout?: string; stderr?: string };
        return {
            stdout: execError.stdout || '',
            stderr: execError.stderr || execError.message, // Use message if stderr is empty
            error: execError,
        };
    }
}

/**
 * Executes SQL using the best available method with proper privilege escalation.
 *
 * Execution order:
 * 1. Direct database connection (bypasses all auth, most reliable for dev)
 * 2. Service role RPC (uses execute_sql function with service_role privileges)
 * 3. Fails if neither is available
 *
 * SECURITY NOTE: This function is for PRIVILEGED operations only.
 * The execute_sql RPC function is restricted to service_role - authenticated users cannot call it.
 */
export async function executeSqlWithFallback(
    client: SelfhostedSupabaseClient,
    sql: string,
    readOnly: boolean = true
): Promise<SqlExecutionResult> {
    // Try direct database connection first (bypasses JWT authentication)
    if (client.isPgAvailable()) {
        console.info('Using direct database connection (bypassing JWT)...');
        return await client.executeSqlWithPg(sql);
    }

    // Try service role RPC (required since execute_sql is restricted to service_role)
    if (client.isServiceRoleAvailable()) {
        console.info('Using service role RPC method...');
        return await client.executeSqlViaServiceRoleRpc(sql, readOnly);
    }

    // Neither method available - fail with clear error
    return {
        error: {
            message: 'Neither direct database connection (DATABASE_URL) nor service role key (SUPABASE_SERVICE_ROLE_KEY) is configured. Cannot execute SQL.',
            code: 'MCP_CONFIG_ERROR',
        },
    };
} 