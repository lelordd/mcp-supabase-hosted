import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// Output schema for trigger definition
const GetTriggerDefinitionOutputSchema = z.object({
    schema_name: z.string(),
    table_name: z.string(),
    trigger_name: z.string(),
    trigger_timing: z.string(),
    trigger_level: z.string(),
    events: z.array(z.string()),
    function_schema: z.string(),
    function_name: z.string(),
    enabled: z.string(),
    definition: z.string(),
    function_definition: z.string().nullable(),
});

// Input schema
const GetTriggerDefinitionInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    table: z.string().describe('Table name the trigger is on.'),
    trigger_name: z.string().describe('Name of the trigger.'),
    include_function: z.boolean().optional().default(true).describe('Include the trigger function source code.'),
});
type GetTriggerDefinitionInput = z.infer<typeof GetTriggerDefinitionInputSchema>;

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
            description: 'Table name the trigger is on.',
        },
        trigger_name: {
            type: 'string',
            description: 'Name of the trigger.',
        },
        include_function: {
            type: 'boolean',
            default: true,
            description: 'Include the trigger function source code.',
        },
    },
    required: ['table', 'trigger_name'],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

export const getTriggerDefinitionTool = {
    name: 'get_trigger_definition',
    description: 'Gets the full definition of a trigger, optionally including its function source code.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: GetTriggerDefinitionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetTriggerDefinitionOutputSchema,

    execute: async (input: GetTriggerDefinitionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, table, trigger_name, include_function } = input;

        // Validate identifiers
        if (!identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (!identifierPattern.test(table)) {
            throw new Error(`Invalid table name: ${table}`);
        }
        if (!identifierPattern.test(trigger_name)) {
            throw new Error(`Invalid trigger name: ${trigger_name}`);
        }

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
                END AS enabled,
                pg_catalog.pg_get_triggerdef(t.oid, true) AS definition,
                ${include_function ? 'pg_catalog.pg_get_functiondef(p.oid)' : 'NULL'} AS function_definition
            FROM pg_catalog.pg_trigger t
            JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
            JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
            WHERE n.nspname = '${schema}'
              AND c.relname = '${table}'
              AND t.tgname = '${trigger_name}'
            LIMIT 1
        `;

        const result = await executeSqlWithFallback(client, sql, true);

        if (isSqlErrorResponse(result)) {
            throw new Error(result.error.message || 'Failed to get trigger definition');
        }

        const rows = result as unknown[];
        if (!rows || rows.length === 0) {
            throw new Error(`Trigger "${trigger_name}" not found on ${schema}.${table}.`);
        }

        return GetTriggerDefinitionOutputSchema.parse(rows[0]);
    },
};
