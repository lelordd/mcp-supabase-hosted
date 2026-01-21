import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';

// Output schema for function definition
const GetFunctionDefinitionOutputSchema = z.object({
    schema_name: z.string(),
    function_name: z.string(),
    arguments: z.string(),
    return_type: z.string(),
    language: z.string(),
    volatility: z.string(),
    security_definer: z.boolean(),
    definition: z.string(),
});

// Input schema
const GetFunctionDefinitionInputSchema = z.object({
    schema: z.string().default('public').describe('Schema name (defaults to public).'),
    function_name: z.string().describe('Name of the function.'),
    argument_types: z.string().optional().describe('Argument types to disambiguate overloaded functions (e.g., "integer, text").'),
});
type GetFunctionDefinitionInput = z.infer<typeof GetFunctionDefinitionInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        schema: {
            type: 'string',
            default: 'public',
            description: 'Schema name (defaults to public).',
        },
        function_name: {
            type: 'string',
            description: 'Name of the function.',
        },
        argument_types: {
            type: 'string',
            description: 'Argument types to disambiguate overloaded functions (e.g., "integer, text").',
        },
    },
    required: ['function_name'],
};

// SQL identifier validation pattern
const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
// Pattern for argument types - allow common type names and modifiers
const argTypesPattern = /^[a-zA-Z0-9_$,\s\[\]()]+$/;

export const getFunctionDefinitionTool = {
    name: 'get_function_definition',
    description: 'Gets the full source code definition of a database function. Use argument_types if there are overloaded functions with the same name.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: GetFunctionDefinitionInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetFunctionDefinitionOutputSchema,

    execute: async (input: GetFunctionDefinitionInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { schema, function_name, argument_types } = input;

        // Validate identifiers
        if (!identifierPattern.test(schema)) {
            throw new Error(`Invalid schema name: ${schema}`);
        }
        if (!identifierPattern.test(function_name)) {
            throw new Error(`Invalid function name: ${function_name}`);
        }
        if (argument_types && !argTypesPattern.test(argument_types)) {
            throw new Error(`Invalid argument types format: ${argument_types}`);
        }

        // Build WHERE conditions
        let whereClause = `n.nspname = '${schema}' AND p.proname = '${function_name}'`;

        if (argument_types) {
            // Use pg_get_function_arguments to match the argument signature
            whereClause += ` AND pg_catalog.pg_get_function_arguments(p.oid) = '${argument_types}'`;
        }

        const sql = `
            SELECT
                n.nspname AS schema_name,
                p.proname AS function_name,
                pg_catalog.pg_get_function_arguments(p.oid) AS arguments,
                pg_catalog.pg_get_function_result(p.oid) AS return_type,
                l.lanname AS language,
                CASE p.provolatile
                    WHEN 'i' THEN 'IMMUTABLE'
                    WHEN 's' THEN 'STABLE'
                    WHEN 'v' THEN 'VOLATILE'
                    ELSE p.provolatile::text
                END AS volatility,
                p.prosecdef AS security_definer,
                pg_catalog.pg_get_functiondef(p.oid) AS definition
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
            JOIN pg_catalog.pg_language l ON l.oid = p.prolang
            WHERE ${whereClause}
            AND p.prokind = 'f'
            LIMIT 1
        `;

        const result = await executeSqlWithFallback(client, sql, true);

        // Handle the response - expect single result
        if (isSqlErrorResponse(result)) {
            throw new Error(result.error.message || 'Failed to get function definition');
        }

        const rows = result as unknown[];
        if (!rows || rows.length === 0) {
            throw new Error(`Function ${schema}.${function_name}${argument_types ? `(${argument_types})` : ''} not found.`);
        }

        // Return the first (and should be only) result
        return GetFunctionDefinitionOutputSchema.parse(rows[0]);
    },
};
