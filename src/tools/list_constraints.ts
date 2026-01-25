import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for constraints
const ListConstraintsOutputSchema = z.array(z.object({
    schema_name: z.string(),
    table_name: z.string(),
    constraint_name: z.string(),
    constraint_type: z.string(), // PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, EXCLUDE
    columns: z.array(z.string()),
    definition: z.string(),
    is_deferrable: z.boolean(),
    initially_deferred: z.boolean(),
}));

// Input schema with optional filters
const ListConstraintsInputSchema = z.object({
    schema: z.string().optional().describe('Filter by schema name.'),
    table: z.string().optional().describe('Filter by table name.'),
    constraint_type: z.enum(['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'EXCLUDE']).optional().describe('Filter by constraint type.'),
    include_system: z.boolean().optional().default(false).describe('Include constraints in system schemas.'),
});
type ListConstraintsInput = z.infer<typeof ListConstraintsInputSchema>;

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
        constraint_type: {
            type: 'string',
            enum: ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'EXCLUDE'],
            description: 'Filter by constraint type.',
        },
        include_system: {
            type: 'boolean',
            default: false,
            description: 'Include constraints in system schemas.',
        },
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const listConstraintsTool = {
    name: 'list_constraints',
    description: 'Lists all constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, EXCLUDE) in the database. Can filter by schema, table, and type.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListConstraintsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListConstraintsOutputSchema,

    execute: async (input: ListConstraintsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, constraint_type, include_system } = input;

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
            conditions.push("n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'pgbouncer', 'realtime', 'supabase_functions', 'supabase_migrations', '_realtime')");
        }

        if (schema) {
            conditions.push(`n.nspname = '${schema}'`);
        }
        if (table) {
            conditions.push(`rel.relname = '${table}'`);
        }
        if (constraint_type) {
            // Use Map to prevent object injection attacks
            const typeMap = new Map<string, string>([
                ['PRIMARY KEY', 'p'],
                ['FOREIGN KEY', 'f'],
                ['UNIQUE', 'u'],
                ['CHECK', 'c'],
                ['EXCLUDE', 'x'],
            ]);
            const typeCode = typeMap.get(constraint_type);
            if (typeCode) {
                conditions.push(`c.contype = '${typeCode}'`);
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT
                n.nspname AS schema_name,
                rel.relname AS table_name,
                c.conname AS constraint_name,
                CASE c.contype
                    WHEN 'p' THEN 'PRIMARY KEY'
                    WHEN 'f' THEN 'FOREIGN KEY'
                    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'c' THEN 'CHECK'
                    WHEN 'x' THEN 'EXCLUDE'
                    ELSE c.contype::text
                END AS constraint_type,
                ARRAY(
                    SELECT a.attname
                    FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                    ORDER BY k.ord
                ) AS columns,
                pg_get_constraintdef(c.oid) AS definition,
                c.condeferrable AS is_deferrable,
                c.condeferred AS initially_deferred
            FROM pg_catalog.pg_constraint c
            JOIN pg_catalog.pg_class rel ON rel.oid = c.conrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = rel.relnamespace
            ${whereClause}
            ORDER BY n.nspname, rel.relname, c.conname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListConstraintsOutputSchema);
    },
};
