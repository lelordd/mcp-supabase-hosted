import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for triggers
const ListTriggersOutputSchema = z.array(z.object({
    schema_name: z.string(),
    table_name: z.string(),
    trigger_name: z.string(),
    trigger_timing: z.string(), // BEFORE, AFTER, INSTEAD OF
    trigger_level: z.string(), // ROW or STATEMENT
    events: z.array(z.string()), // INSERT, UPDATE, DELETE, TRUNCATE
    function_schema: z.string(),
    function_name: z.string(),
    enabled: z.string(), // O=enabled, D=disabled, R=replica, A=always
}));

// Input schema with optional filters
const ListTriggersInputSchema = z.object({
    schema: z.string().optional().describe('Filter triggers by schema name.'),
    table: z.string().optional().describe('Filter triggers by table name.'),
});
type ListTriggersInput = z.infer<typeof ListTriggersInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            description: 'Filter triggers by schema name.',
        },
        table: {
            type: 'string',
            description: 'Filter triggers by table name.',
        },
    },
    required: [],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const listTriggersTool = {
    name: 'list_triggers',
    description: 'Lists all triggers on tables. Can filter by schema and/or table name.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListTriggersInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListTriggersOutputSchema,

    execute: async (input: ListTriggersInput, context: ToolContext) => {
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
            'NOT t.tgisinternal', // Exclude internal triggers
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
                t.tgname AS trigger_name,
                CASE
                    WHEN t.tgtype::int & 2 > 0 THEN 'BEFORE'
                    WHEN t.tgtype::int & 64 > 0 THEN 'INSTEAD OF'
                    ELSE 'AFTER'
                END AS trigger_timing,
                CASE WHEN t.tgtype::int & 1 > 0 THEN 'ROW' ELSE 'STATEMENT' END AS trigger_level,
                ARRAY_REMOVE(ARRAY[
                    CASE WHEN t.tgtype::int & 4 > 0 THEN 'INSERT' END,
                    CASE WHEN t.tgtype::int & 8 > 0 THEN 'DELETE' END,
                    CASE WHEN t.tgtype::int & 16 > 0 THEN 'UPDATE' END,
                    CASE WHEN t.tgtype::int & 32 > 0 THEN 'TRUNCATE' END
                ], NULL) AS events,
                pn.nspname AS function_schema,
                p.proname AS function_name,
                CASE t.tgenabled
                    WHEN 'O' THEN 'ENABLED'
                    WHEN 'D' THEN 'DISABLED'
                    WHEN 'R' THEN 'REPLICA'
                    WHEN 'A' THEN 'ALWAYS'
                    ELSE t.tgenabled::text
                END AS enabled
            FROM pg_catalog.pg_trigger t
            JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
            JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
            WHERE ${whereClause}
            ORDER BY n.nspname, c.relname, t.tgname
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListTriggersOutputSchema);
    },
};
