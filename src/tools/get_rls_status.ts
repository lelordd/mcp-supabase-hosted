import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for RLS status
const GetRlsStatusOutputSchema = z.array(z.object({
    schema_name: z.string(),
    table_name: z.string(),
    rls_enabled: z.boolean(),
    rls_forced: z.boolean(),
    policy_count: z.number(),
}));

// Input schema with optional filters
const GetRlsStatusInputSchema = z.object({
    schema: z.string().optional().describe('Filter by schema name.'),
    table: z.string().optional().describe('Filter by table name.'),
});
type GetRlsStatusInput = z.infer<typeof GetRlsStatusInputSchema>;

// Static JSON Schema for MCP capabilities
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
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const getRlsStatusTool = {
    name: 'get_rls_status',
    description: 'Checks if Row Level Security (RLS) is enabled on tables and shows the number of policies. Can filter by schema and/or table.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: GetRlsStatusInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetRlsStatusOutputSchema,

    execute: async (input: GetRlsStatusInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table } = input;

        // Validate identifiers if provided
        if (schema && !identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (table && !identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }

        // Build WHERE conditions
        const conditions: string[] = [
            "c.relkind = 'r'", // ordinary tables only
            "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'realtime', 'supabase_functions', 'supabase_migrations', '_realtime')",
        ];

        if (schema) {
            conditions.push(`n.nspname = '${schema}'`);
        }
        if (table) {
            conditions.push(`c.relname = '${table}'`);
        }

        const whereClause = conditions.join(' AND ');

        const sql = `
            SELECT
                n.nspname AS schema_name,
                c.relname AS table_name,
                c.relrowsecurity AS rls_enabled,
                c.relforcerowsecurity AS rls_forced,
                COUNT(pol.polname)::int AS policy_count
            FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_catalog.pg_policy pol ON pol.polrelid = c.oid
            WHERE ${whereClause}
            GROUP BY n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
            ORDER BY n.nspname, c.relname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, GetRlsStatusOutputSchema);
    },
};
