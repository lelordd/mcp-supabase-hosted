import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for indexes
const ListIndexesOutputSchema = z.array(z.object({
    schema_name: z.string(),
    table_name: z.string(),
    index_name: z.string(),
    index_type: z.string(), // btree, hash, gist, gin, brin
    is_unique: z.boolean(),
    is_primary: z.boolean(),
    is_valid: z.boolean(),
    columns: z.string(),
    size: z.string(),
    definition: z.string(),
}));

// Input schema with optional filters
const ListIndexesInputSchema = z.object({
    schema: z.string().optional().describe('Filter indexes by schema name.'),
    table: z.string().optional().describe('Filter indexes by table name.'),
    include_system: z.boolean().optional().default(false).describe('Include indexes on system tables.'),
});
type ListIndexesInput = z.infer<typeof ListIndexesInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter indexes by schema name.',
        },
        table: {
            type: 'string',
            description: 'Filter indexes by table name.',
        },
        include_system: {
            type: 'boolean',
            default: false,
            description: 'Include indexes on system tables.',
        },
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const listIndexesTool = {
    name: 'list_indexes',
    description: 'Lists all indexes in the database with their definitions and sizes. Can filter by schema and/or table.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListIndexesInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListIndexesOutputSchema,

    execute: async (input: ListIndexesInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, include_system } = input;

        // Validate identifiers if provided
        if (schema && !identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (table && !identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }

        // Build WHERE conditions
        const conditions: string[] = [];

        if (!include_system) {
            conditions.push("schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'realtime', 'supabase_functions', 'supabase_migrations', '_realtime')");
        }

        if (schema) {
            conditions.push(`schemaname = '${schema}'`);
        }
        if (table) {
            conditions.push(`tablename = '${table}'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT
                i.schemaname AS schema_name,
                i.tablename AS table_name,
                i.indexname AS index_name,
                am.amname AS index_type,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                ix.indisvalid AS is_valid,
                pg_catalog.pg_get_indexdef(ix.indexrelid, 0, true) AS columns,
                pg_size_pretty(pg_relation_size(ix.indexrelid)) AS size,
                i.indexdef AS definition
            FROM pg_indexes i
            JOIN pg_catalog.pg_class c ON c.relname = i.indexname
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
            JOIN pg_catalog.pg_index ix ON ix.indexrelid = c.oid
            JOIN pg_catalog.pg_am am ON am.oid = c.relam
            ${whereClause}
            ORDER BY i.schemaname, i.tablename, i.indexname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListIndexesOutputSchema);
    },
};
