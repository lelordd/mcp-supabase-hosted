/**
 * get_vector_index_stats - Gets detailed statistics for vector indexes.
 *
 * Requires the pgvector extension to be installed.
 * Shows usage statistics and size information for vector indexes.
 */

import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback, isSqlErrorResponse } from './utils.js';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';

// SQL identifier validation - prevents SQL injection via identifier names
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

const VectorIndexStatsSchema = z.object({
    schemaname: z.string(),
    tablename: z.string(),
    indexname: z.string(),
    index_type: z.string(),
    idx_scan: z.number(),
    idx_tup_read: z.number(),
    idx_tup_fetch: z.number(),
    index_size: z.string(),
    index_size_bytes: z.number(),
});

const GetVectorIndexStatsOutputSchema = z.array(VectorIndexStatsSchema);

const GetVectorIndexStatsInputSchema = z.object({
    schema: z.string().optional().describe('Filter by schema name.'),
    table: z.string().optional().describe('Filter by table name.'),
    indexname: z.string().optional().describe('Filter by index name.'),
});

type GetVectorIndexStatsInput = z.infer<typeof GetVectorIndexStatsInputSchema>;

const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter by schema name.',
        },
        table: {
            type: 'string',
            description: 'Filter by table name.',
        },
        indexname: {
            type: 'string',
            description: 'Filter by index name.',
        },
    },
    required: [],
};

export const getVectorIndexStatsTool = {
    name: 'get_vector_index_stats',
    description: 'Gets usage statistics and size information for pgvector indexes.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: GetVectorIndexStatsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetVectorIndexStatsOutputSchema,

    execute: async (input: GetVectorIndexStatsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, indexname } = input;

        // SECURITY: Validate identifiers to prevent SQL injection
        if (schema && !identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}. Must be a valid SQL identifier.`);
        }
        if (table && !identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}. Must be a valid SQL identifier.`);
        }
        if (indexname && !identifierPattern.test(indexname)) {
            throw new Error(`Invalid index name: ${indexname}. Must be a valid SQL identifier.`);
        }

        // First check if pgvector extension is installed
        const checkExtensionSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_extension WHERE extname = 'vector'
            ) as installed;
        `;

        const extensionCheck = await executeSqlWithFallback(client, checkExtensionSql, true);

        if (isSqlErrorResponse(extensionCheck)) {
            throw new Error(extensionCheck.error.message || 'Failed to check pgvector extension status.');
        }

        const checkRows = extensionCheck as Array<{ installed: boolean }>;
        if (!checkRows || checkRows.length === 0 || !checkRows[0].installed) {
            throw new Error('pgvector extension is not installed. Install it with: CREATE EXTENSION vector;');
        }

        // Build conditions - identifiers are validated above
        const statsConditions: string[] = [];

        if (schema) {
            statsConditions.push(`s.schemaname = '${schema}'`);
        }

        if (table) {
            statsConditions.push(`s.relname = '${table}'`);
        }

        if (indexname) {
            statsConditions.push(`s.indexrelname = '${indexname}'`);
        }

        const statsWhereClause = statsConditions.length > 0 ? `AND ${statsConditions.join(' AND ')}` : '';

        // Query vector index statistics
        const statsSql = `
            WITH vector_indexes AS (
                SELECT
                    schemaname,
                    tablename,
                    indexname,
                    CASE
                        WHEN indexdef LIKE '%USING ivfflat%' THEN 'IVFFlat'
                        WHEN indexdef LIKE '%USING hnsw%' THEN 'HNSW'
                        ELSE 'Unknown'
                    END AS index_type
                FROM pg_indexes
                WHERE indexdef LIKE '%vector_%ops%'
            )
            SELECT
                vi.schemaname,
                vi.tablename,
                vi.indexname,
                vi.index_type,
                COALESCE(s.idx_scan, 0) AS idx_scan,
                COALESCE(s.idx_tup_read, 0) AS idx_tup_read,
                COALESCE(s.idx_tup_fetch, 0) AS idx_tup_fetch,
                pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
                pg_relation_size(s.indexrelid) AS index_size_bytes
            FROM vector_indexes vi
            JOIN pg_stat_user_indexes s
                ON vi.schemaname = s.schemaname
                AND vi.indexname = s.indexrelname
            WHERE 1=1 ${statsWhereClause}
            ORDER BY s.idx_scan DESC, index_size_bytes DESC
        `;

        const result = await executeSqlWithFallback(client, statsSql, true);
        return handleSqlResponse(result, GetVectorIndexStatsOutputSchema);
    },
};
