import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// Output schema for table columns
const ListTableColumnsOutputSchema = z.array(z.object({
    column_name: z.string(),
    data_type: z.string(),
    is_nullable: z.boolean(),
    column_default: z.string().nullable(),
    description: z.string().nullable(),
    ordinal_position: z.number(),
    character_maximum_length: z.number().nullable(),
    numeric_precision: z.number().nullable(),
    numeric_scale: z.number().nullable(),
    is_identity: z.boolean(),
    identity_generation: z.string().nullable(),
    is_generated: z.boolean(),
    generation_expression: z.string().nullable(),
}));

// Input schema
const ListTableColumnsInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name to get columns for.'),
});
type ListTableColumnsInput = z.infer<typeof ListTableColumnsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            default: 'public',
            description: 'Schema name (defaults to public).',
        },
        table: {
            type: 'string',
            description: 'Table name to get columns for.',
        },
    },
    required: ['table'],
};

export const listTableColumnsTool = {
    name: 'list_table_columns',
    description: 'Lists all columns for a table with detailed metadata including types, defaults, and constraints.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListTableColumnsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListTableColumnsOutputSchema,

    execute: async (input: ListTableColumnsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table } = input;

        // Basic SQL identifier validation - allow alphanumeric, underscore, and dollar sign
        const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
        if (!identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (!identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }

        const sql = `
            SELECT
                a.attname AS column_name,
                pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS is_nullable,
                pg_get_expr(d.adbin, d.adrelid) AS column_default,
                col_description(c.oid, a.attnum) AS description,
                a.attnum AS ordinal_position,
                CASE
                    WHEN a.atttypid = ANY(ARRAY[1042, 1043]) -- bpchar, varchar
                    THEN NULLIF(a.atttypmod, -1) - 4
                    ELSE NULL
                END AS character_maximum_length,
                CASE
                    WHEN a.atttypid = ANY(ARRAY[21, 23, 20, 1700]) -- int2, int4, int8, numeric
                    THEN ((a.atttypmod - 4) >> 16) & 65535
                    ELSE NULL
                END AS numeric_precision,
                CASE
                    WHEN a.atttypid = 1700 -- numeric
                    THEN (a.atttypmod - 4) & 65535
                    ELSE NULL
                END AS numeric_scale,
                a.attidentity != '' AS is_identity,
                CASE a.attidentity
                    WHEN 'a' THEN 'ALWAYS'
                    WHEN 'd' THEN 'BY DEFAULT'
                    ELSE NULL
                END AS identity_generation,
                a.attgenerated != '' AS is_generated,
                pg_get_expr(g.adbin, g.adrelid) AS generation_expression
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum AND a.attgenerated = ''
            LEFT JOIN pg_catalog.pg_attrdef g ON g.adrelid = a.attrelid AND g.adnum = a.attnum AND a.attgenerated != ''
            WHERE n.nspname = '${schema}'
              AND c.relname = '${table}'
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
        `;

        const result = await executeSqlWithFallback(client, sql, true);

        if (isSqlErrorResponse(result)) {
            throw new Error(result.error.message || 'Failed to list table columns');
        }

        const rows = result as unknown[];
        if (rows.length === 0) {
            throw new Error(`Table ${schema}.${table} not found or has no columns.`);
        }

        return handleSqlResponse(result, ListTableColumnsOutputSchema);
    },
};
