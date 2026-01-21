/**
 * list_edge_function_logs - Lists execution logs for edge functions.
 *
 * Queries the function_edge_logs table if available in the Supabase instance.
 * This table is automatically created by Supabase for edge function logging.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';

const EdgeFunctionLogSchema = z.object({
    execution_id: z.string().nullable(),
    function_id: z.string(),
    status_code: z.number().nullable(),
    request_start_time: z.string(),
    request_duration_ms: z.number().nullable(),
    error_message: z.string().nullable(),
    request_path: z.string().nullable(),
    request_method: z.string().nullable(),
});

const ListEdgeFunctionLogsOutputSchema = z.array(EdgeFunctionLogSchema);

const ListEdgeFunctionLogsInputSchema = z.object({
    function_id: z.string().optional().describe('Filter by function ID/slug.'),
    status_code: z.number().optional().describe('Filter by HTTP status code.'),
    errors_only: z.boolean().optional().describe('Only show logs with errors (status >= 400).'),
    limit: z.number().optional().default(100).describe('Maximum number of log entries to return.'),
});

type ListEdgeFunctionLogsInput = z.infer<typeof ListEdgeFunctionLogsInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        function_id: {
            type: 'string',
            description: 'Filter by function ID/slug.',
        },
        status_code: {
            type: 'number',
            description: 'Filter by HTTP status code.',
        },
        errors_only: {
            type: 'boolean',
            description: 'Only show logs with errors (status >= 400).',
        },
        limit: {
            type: 'number',
            description: 'Maximum number of log entries to return.',
            default: 100,
        },
    },
    required: [],
};

// Pattern for function IDs (UUIDs or slugs)
const functionIdPattern = /^[a-zA-Z0-9_\-]+$/;

export const listEdgeFunctionLogsTool = {
    name: 'list_edge_function_logs',
    description: 'Lists execution logs for edge functions from the function_edge_logs table.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListEdgeFunctionLogsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListEdgeFunctionLogsOutputSchema,

    execute: async (input: ListEdgeFunctionLogsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { function_id, status_code, errors_only, limit = 100 } = input;

        // Validate function_id if provided
        if (function_id && !functionIdPattern.test(function_id)) {
            throw new Error(`Invalid function ID: ${function_id}. Use only alphanumeric, underscore, and hyphen characters.`);
        }

        // Check if function_edge_logs table exists
        const checkTableSql = `
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_name = 'function_edge_logs'
            ) as exists;
        `;

        const tableCheck = await executeSqlWithFallback(client, checkTableSql, true);

        if (!Array.isArray(tableCheck) || tableCheck.length === 0) {
            throw new Error('Failed to check for function_edge_logs table.');
        }

        if (!tableCheck[0].exists) {
            throw new Error(
                'Edge function logs table (function_edge_logs) not found. ' +
                'This table is automatically created by Supabase when edge functions are invoked. ' +
                'Ensure edge functions have been executed at least once.'
            );
        }

        // Build query with filters
        const conditions: string[] = [];

        if (function_id) {
            conditions.push(`function_id = '${function_id}'`);
        }

        if (status_code !== undefined) {
            // status_code is a number from Zod validation, safe to use directly
            conditions.push(`status_code = ${status_code}`);
        }

        if (errors_only) {
            conditions.push('status_code >= 400');
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Ensure limit is within bounds
        const safeLimit = Math.min(Math.max(1, limit), 1000);

        const logsSql = `
            SELECT
                execution_id::text,
                function_id,
                status_code,
                request_start_time::text,
                EXTRACT(EPOCH FROM (request_end_time - request_start_time)) * 1000 as request_duration_ms,
                error_message,
                request_path,
                request_method
            FROM function_edge_logs
            ${whereClause}
            ORDER BY request_start_time DESC
            LIMIT ${safeLimit}
        `;

        const result = await executeSqlWithFallback(client, logsSql, true);
        return handleSqlResponse(result, ListEdgeFunctionLogsOutputSchema);
    },
};
