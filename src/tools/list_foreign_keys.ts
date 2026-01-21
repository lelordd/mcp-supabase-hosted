import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for foreign keys
const ListForeignKeysOutputSchema = z.array(z.object({
    constraint_name: z.string(),
    schema_name: z.string(),
    table_name: z.string(),
    column_name: z.string(),
    referenced_schema: z.string(),
    referenced_table: z.string(),
    referenced_column: z.string(),
    update_rule: z.string(),
    delete_rule: z.string(),
    is_deferrable: z.boolean(),
    initially_deferred: z.boolean(),
}));

// Input schema with optional filters
const ListForeignKeysInputSchema = z.object({
    schema: z.string().optional().describe('Filter by schema name.'),
    table: z.string().optional().describe('Filter by table name.'),
    include_system: z.boolean().optional().default(false).describe('Include foreign keys in system schemas.'),
});
type ListForeignKeysInput = z.infer<typeof ListForeignKeysInputSchema>;

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
        include_system: {
            type: 'boolean',
            default: false,
            description: 'Include foreign keys in system schemas.',
        },
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const listForeignKeysTool = {
    name: 'list_foreign_keys',
    description: 'Lists all foreign key relationships in the database. Can filter by schema and/or table.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListForeignKeysInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListForeignKeysOutputSchema,

    execute: async (input: ListForeignKeysInput, context: ToolContext) => {
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
            conditions.push("tc.table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'realtime', 'supabase_functions', 'supabase_migrations', '_realtime')");
        }

        if (schema) {
            conditions.push(`tc.table_schema = '${schema}'`);
        }
        if (table) {
            conditions.push(`tc.table_name = '${table}'`);
        }

        const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT
                tc.constraint_name,
                tc.table_schema AS schema_name,
                tc.table_name,
                kcu.column_name,
                ccu.table_schema AS referenced_schema,
                ccu.table_name AS referenced_table,
                ccu.column_name AS referenced_column,
                rc.update_rule,
                rc.delete_rule,
                c.condeferrable AS is_deferrable,
                c.condeferred AS initially_deferred
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc
                ON tc.constraint_name = rc.constraint_name
                AND tc.table_schema = rc.constraint_schema
            JOIN pg_catalog.pg_constraint c
                ON c.conname = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
            ${whereClause}
            ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListForeignKeysOutputSchema);
    },
};
