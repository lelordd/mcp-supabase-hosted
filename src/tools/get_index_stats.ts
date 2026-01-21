/**
 * get_index_stats - Gets detailed statistics for a specific index.
 *
 * Shows usage counts, size information, and effectiveness metrics.
 */

import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// SQL identifier validation - prevents SQL injection via identifier names
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

// Output schema for index stats
const GetIndexStatsOutputSchema = z.object({
    schema_name: z.string(),
    table_name: z.string(),
    index_name: z.string(),
    index_type: z.string(),
    is_unique: z.boolean(),
    is_primary: z.boolean(),
    is_valid: z.boolean(),
    number_of_scans: z.number(),
    tuples_read: z.number(),
    tuples_fetched: z.number(),
    index_size: z.string(),
    table_size: z.string(),
    index_size_bytes: z.number(),
    table_size_bytes: z.number(),
    usage_ratio: z.string().nullable(), // Percentage of table accesses that used this index
});

// Input schema
const GetIndexStatsInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    index_name: z.string().describe('Name of the index.'),
});
type GetIndexStatsInput = z.infer<typeof GetIndexStatsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            default: 'public',
            description: 'Schema name (defaults to public).',
        },
        index_name: {
            type: 'string',
            description: 'Name of the index.',
        },
    },
    required: ['index_name'],
};

export const getIndexStatsTool = {
    name: 'get_index_stats',
    description: 'Gets detailed statistics for a specific index including usage counts and size.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: GetIndexStatsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetIndexStatsOutputSchema,

    execute: async (input: GetIndexStatsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, index_name } = input;

        // SECURITY: Validate identifiers to prevent SQL injection
        if (!identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}. Must be a valid SQL identifier.`);
        }
        if (!identifierPattern.test(index_name)) {
            throw new Error(`Invalid index name: ${index_name}. Must be a valid SQL identifier.`);
        }

        const sql = `
            SELECT
                s.schemaname AS schema_name,
                s.relname AS table_name,
                s.indexrelname AS index_name,
                am.amname AS index_type,
                i.indisunique AS is_unique,
                i.indisprimary AS is_primary,
                i.indisvalid AS is_valid,
                COALESCE(s.idx_scan, 0)::bigint AS number_of_scans,
                COALESCE(s.idx_tup_read, 0)::bigint AS tuples_read,
                COALESCE(s.idx_tup_fetch, 0)::bigint AS tuples_fetched,
                pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
                pg_size_pretty(pg_relation_size(s.relid)) AS table_size,
                pg_relation_size(s.indexrelid)::bigint AS index_size_bytes,
                pg_relation_size(s.relid)::bigint AS table_size_bytes,
                CASE
                    WHEN (st.seq_scan + st.idx_scan) > 0
                    THEN ROUND((st.idx_scan::numeric / (st.seq_scan + st.idx_scan)::numeric) * 100, 2)::text || '%'
                    ELSE NULL
                END AS usage_ratio
            FROM pg_stat_user_indexes s
            JOIN pg_catalog.pg_index i ON i.indexrelid = s.indexrelid
            JOIN pg_catalog.pg_class c ON c.oid = s.indexrelid
            JOIN pg_catalog.pg_am am ON am.oid = c.relam
            JOIN pg_stat_user_tables st ON st.relid = s.relid
            WHERE s.schemaname = '${schema}'
              AND s.indexrelname = '${index_name}'
            LIMIT 1
        `;

        const result = await executeSqlWithFallback(client, sql, true);

        if (isSqlErrorResponse(result)) {
            throw new Error(result.error.message || 'Failed to get index stats');
        }

        const rows = result as unknown[];
        if (rows.length === 0) {
            throw new Error(`Index "${index_name}" not found in schema "${schema}".`);
        }

        return GetIndexStatsOutputSchema.parse(rows[0]);
    },
};
