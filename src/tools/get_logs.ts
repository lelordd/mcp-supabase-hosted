import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback, isSqlErrorResponse } from './utils.js';
import type { ToolContext } from './types.js';

// Service types that can be queried for logs
const LogServiceSchema = z.enum(['postgres', 'auth', 'storage', 'realtime', 'postgrest']);
type LogService = z.infer<typeof LogServiceSchema>;

// Schema for log entry output
const LogEntrySchema = z.object({
    timestamp: z.string().nullable(),
    level: z.string().nullable(),
    message: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
});
const GetLogsOutputSchema = z.object({
    logs: z.array(LogEntrySchema),
    source: z.string(),
    service: LogServiceSchema,
    message: z.string().optional(),
});
type GetLogsOutput = z.infer<typeof GetLogsOutputSchema>;

// Input schema
const GetLogsInputSchema = z.object({
    service: LogServiceSchema.describe('The service to fetch logs for (postgres, auth, storage, realtime, postgrest)'),
    limit: z.number().min(1).max(1000).optional().describe('Maximum number of log entries to return (default: 100, max: 1000)'),
});
type GetLogsInput = z.infer<typeof GetLogsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        service: {
            type: 'string',
            enum: ['postgres', 'auth', 'storage', 'realtime', 'postgrest'],
            description: 'The service to fetch logs for (postgres, auth, storage, realtime, postgrest)',
        },
        limit: {
            type: 'number',
            minimum: 1,
            maximum: 1000,
            description: 'Maximum number of log entries to return (default: 100, max: 1000)',
        },
    },
    required: ['service'],
};

// Tool definition
export const getLogsTool = {
    name: 'get_logs',
    description: 'Gets logs for a Supabase service. Attempts to query the analytics stack first, then falls back to PostgreSQL CSV logs. Returns logs from the last 24 hours. Note: Log availability depends on your self-hosted installation configuration.',
    inputSchema: GetLogsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetLogsOutputSchema,
    execute: async (input: GetLogsInput, context: ToolContext): Promise<GetLogsOutput> => {
        const client = context.selfhostedClient;
        const { service, limit = 100 } = input;

        // Try analytics stack first (_analytics schema)
        const analyticsResult = await tryAnalyticsLogs(client, service, limit, context);
        if (analyticsResult) {
            return analyticsResult;
        }

        // For postgres service, try CSV log file approach
        if (service === 'postgres') {
            const csvResult = await tryPostgresCsvLogs(client, limit, context);
            if (csvResult) {
                return csvResult;
            }
        }

        // No log source available
        return {
            logs: [],
            source: 'none',
            service,
            message: `Log access not available for ${service}. Self-hosted installations may need to configure the analytics stack or enable PostgreSQL CSV logging.`,
        };
    },
};

// Try to get logs from the analytics stack
async function tryAnalyticsLogs(
    client: ToolContext['selfhostedClient'],
    service: LogService,
    limit: number,
    context: ToolContext
): Promise<GetLogsOutput | null> {
    // Check if _analytics schema exists
    const checkSchemaSql = `
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = '_analytics'
        ) AS exists
    `;

    const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

    if (!Array.isArray(schemaCheckResult) || schemaCheckResult.length === 0 || !schemaCheckResult[0]?.exists) {
        context.log('_analytics schema not found - analytics stack not deployed', 'info');
        return null;
    }

    // Map service to analytics table
    const tableMap: Record<LogService, string> = {
        postgres: 'postgres_logs',
        auth: 'auth_logs',
        storage: 'storage_logs',
        realtime: 'realtime_logs',
        postgrest: 'postgrest_logs',
    };

    const tableName = tableMap[service];

    // Check if the specific logs table exists
    const checkTableSql = `
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_tables
            WHERE schemaname = '_analytics' AND tablename = '${tableName}'
        ) AS exists
    `;

    const tableCheckResult = await executeSqlWithFallback(client, checkTableSql, true);

    if (!Array.isArray(tableCheckResult) || tableCheckResult.length === 0 || !tableCheckResult[0]?.exists) {
        context.log(`_analytics.${tableName} table not found`, 'info');
        return null;
    }

    // Query logs from analytics table (last 24 hours)
    const queryLogsSql = `
        SELECT
            timestamp::text,
            COALESCE(level, 'info') as level,
            message,
            metadata::jsonb as metadata
        FROM _analytics.${tableName}
        WHERE timestamp > NOW() - INTERVAL '24 hours'
        ORDER BY timestamp DESC
        LIMIT ${limit}
    `;

    try {
        const result = await executeSqlWithFallback(client, queryLogsSql, true);

        if (isSqlErrorResponse(result)) {
            context.log(`Error querying analytics logs: ${result.error.message}`, 'warn');
            return null;
        }

        const logsSchema = z.array(
            z.object({
                timestamp: z.string().nullable(),
                level: z.string().nullable(),
                message: z.string().nullable(),
                metadata: z.record(z.string(), z.unknown()).nullable(),
            })
        );

        const logs = handleSqlResponse(result, logsSchema);

        return {
            logs,
            source: 'analytics',
            service,
        };
    } catch (error) {
        context.log(`Failed to query analytics logs: ${error}`, 'warn');
        return null;
    }
}

// Try to get PostgreSQL logs from CSV log files using file_fdw
async function tryPostgresCsvLogs(
    client: ToolContext['selfhostedClient'],
    limit: number,
    context: ToolContext
): Promise<GetLogsOutput | null> {
    // Check if file_fdw extension exists
    const checkExtensionSql = `
        SELECT EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'file_fdw'
        ) AS exists
    `;

    const extensionCheckResult = await executeSqlWithFallback(client, checkExtensionSql, true);

    if (!Array.isArray(extensionCheckResult) || extensionCheckResult.length === 0 || !extensionCheckResult[0]?.exists) {
        context.log('file_fdw extension not installed - cannot access CSV logs', 'info');
        return null;
    }

    // Get current log file path
    const getLogFileSql = `SELECT pg_current_logfile() as logfile`;
    const logFileResult = await executeSqlWithFallback(client, getLogFileSql, true);

    if (!Array.isArray(logFileResult) || logFileResult.length === 0 || !logFileResult[0]?.logfile) {
        context.log('Could not determine current log file path', 'info');
        return null;
    }

    const logFile = logFileResult[0].logfile;

    // Check if we have a foreign table set up for logs, or try to query directly
    // This is a simplified approach - full implementation would need proper foreign table setup
    const checkForeignTableSql = `
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_foreign_table ft
            JOIN pg_catalog.pg_class c ON c.oid = ft.ftrelid
            WHERE c.relname = 'pglog'
        ) AS exists
    `;

    const foreignTableResult = await executeSqlWithFallback(client, checkForeignTableSql, true);

    if (Array.isArray(foreignTableResult) && foreignTableResult.length > 0 && foreignTableResult[0]?.exists) {
        // Query existing foreign table
        const queryLogsSql = `
            SELECT
                log_time::text as timestamp,
                CASE
                    WHEN error_severity = 'ERROR' THEN 'error'
                    WHEN error_severity = 'WARNING' THEN 'warn'
                    WHEN error_severity = 'LOG' THEN 'info'
                    ELSE 'debug'
                END as level,
                message,
                jsonb_build_object(
                    'user_name', user_name,
                    'database_name', database_name,
                    'process_id', process_id,
                    'sql_state_code', sql_state_code
                ) as metadata
            FROM pglog
            WHERE log_time > NOW() - INTERVAL '24 hours'
            ORDER BY log_time DESC
            LIMIT ${limit}
        `;

        try {
            const result = await executeSqlWithFallback(client, queryLogsSql, true);

            if (isSqlErrorResponse(result)) {
                context.log(`Error querying CSV logs: ${result.error.message}`, 'warn');
                return null;
            }

            const logsSchema = z.array(
                z.object({
                    timestamp: z.string().nullable(),
                    level: z.string().nullable(),
                    message: z.string().nullable(),
                    metadata: z.record(z.string(), z.unknown()).nullable(),
                })
            );

            const logs = handleSqlResponse(result, logsSchema);

            return {
                logs,
                source: 'csv',
                service: 'postgres',
            };
        } catch (error) {
            context.log(`Failed to query CSV logs: ${error}`, 'warn');
            return null;
        }
    }

    context.log(`CSV log file found at ${logFile} but no pglog foreign table configured`, 'info');
    return null;
}
