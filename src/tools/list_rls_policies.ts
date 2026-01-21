import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for RLS policies
const ListRlsPoliciesOutputSchema = z.array(z.object({
    schema_name: z.string(),
    table_name: z.string(),
    policy_name: z.string(),
    command: z.string(), // SELECT, INSERT, UPDATE, DELETE, or ALL
    policy_type: z.string(), // PERMISSIVE or RESTRICTIVE
    roles: z.array(z.string()),
    using_expression: z.string().nullable(),
    with_check_expression: z.string().nullable(),
}));

// Input schema with optional filters
const ListRlsPoliciesInputSchema = z.object({
    schema: z.string().optional().describe('Filter policies by schema name.'),
    table: z.string().optional().describe('Filter policies by table name.'),
});
type ListRlsPoliciesInput = z.infer<typeof ListRlsPoliciesInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter policies by schema name.',
        },
        table: {
            type: 'string',
            description: 'Filter policies by table name.',
        },
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const listRlsPoliciesTool = {
    name: 'list_rls_policies',
    description: 'Lists all Row Level Security (RLS) policies in the database. Can filter by schema and/or table name.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListRlsPoliciesInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListRlsPoliciesOutputSchema,

    execute: async (input: ListRlsPoliciesInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table } = input;

        // Validate identifiers if provided
        if (schema && !identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (table && !identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }

        // Build WHERE conditions based on filters
        const conditions: string[] = [
            "n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')",
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
                pol.polname AS policy_name,
                CASE pol.polcmd
                    WHEN 'r' THEN 'SELECT'
                    WHEN 'a' THEN 'INSERT'
                    WHEN 'w' THEN 'UPDATE'
                    WHEN 'd' THEN 'DELETE'
                    WHEN '*' THEN 'ALL'
                    ELSE pol.polcmd::text
                END AS command,
                CASE pol.polpermissive
                    WHEN true THEN 'PERMISSIVE'
                    ELSE 'RESTRICTIVE'
                END AS policy_type,
                COALESCE(
                    ARRAY(SELECT r.rolname FROM pg_catalog.pg_roles r WHERE r.oid = ANY(pol.polroles)),
                    ARRAY['public']::text[]
                ) AS roles,
                pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
                pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) AS with_check_expression
            FROM pg_catalog.pg_policy pol
            JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE ${whereClause}
            ORDER BY n.nspname, c.relname, pol.polname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListRlsPoliciesOutputSchema);
    },
};
