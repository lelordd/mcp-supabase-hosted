import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for edge function details output
const EdgeFunctionDetailsSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.string().nullable(),
    version: z.number().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    verify_jwt: z.boolean().nullable(),
    import_map: z.boolean().nullable(),
});
const GetEdgeFunctionDetailsOutputSchema = z.array(EdgeFunctionDetailsSchema);
type GetEdgeFunctionDetailsOutput = z.infer<typeof EdgeFunctionDetailsSchema> | null;

// Input schema
const GetEdgeFunctionDetailsInputSchema = z.object({
    function_identifier: z.string().describe('The function ID (UUID) or slug to look up'),
});
type GetEdgeFunctionDetailsInput = z.infer<typeof GetEdgeFunctionDetailsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        function_identifier: {
            type: 'string',
            description: 'The function ID (UUID) or slug to look up',
        },
    },
    required: ['function_identifier'],
};

// Tool definition
export const getEdgeFunctionDetailsTool = {
    name: 'get_edge_function_details',
    description: 'Gets detailed information about a specific Supabase Edge Function by ID or slug. Returns null if not found or edge functions are not available.',
    inputSchema: GetEdgeFunctionDetailsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: EdgeFunctionDetailsSchema.nullable(),
    execute: async (input: GetEdgeFunctionDetailsInput, context: ToolContext): Promise<GetEdgeFunctionDetailsOutput> => {
        const client = context.selfhostedClient;
        const { function_identifier } = input;

        // First check if supabase_functions schema exists
        const checkSchemaSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_functions'
            ) AS exists
        `;

        const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

        if (Array.isArray(schemaCheckResult) && schemaCheckResult.length > 0) {
            const exists = schemaCheckResult[0]?.exists;
            if (!exists) {
                context.log('supabase_functions schema not found - Edge Functions may not be available in this installation', 'info');
                return null;
            }
        } else {
            context.log('Could not verify supabase_functions schema', 'warn');
            return null;
        }

        // Check if the functions table exists
        const checkTableSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_tables
                WHERE schemaname = 'supabase_functions' AND tablename = 'functions'
            ) AS exists
        `;

        const tableCheckResult = await executeSqlWithFallback(client, checkTableSql, true);

        if (Array.isArray(tableCheckResult) && tableCheckResult.length > 0) {
            const exists = tableCheckResult[0]?.exists;
            if (!exists) {
                context.log('supabase_functions.functions table not found', 'info');
                return null;
            }
        } else {
            context.log('Could not verify functions table', 'warn');
            return null;
        }

        // Escape single quotes in the identifier to prevent SQL injection
        const escapedIdentifier = function_identifier.replace(/'/g, "''");

        // Query edge function details - try matching both id and slug
        const getEdgeFunctionDetailsSql = `
            SELECT
                id,
                name,
                slug,
                status,
                version,
                created_at::text,
                updated_at::text,
                verify_jwt,
                import_map
            FROM supabase_functions.functions
            WHERE id::text = '${escapedIdentifier}' OR slug = '${escapedIdentifier}'
            LIMIT 1
        `;

        const result = await executeSqlWithFallback(client, getEdgeFunctionDetailsSql, true);
        const functions = handleSqlResponse(result, GetEdgeFunctionDetailsOutputSchema);

        if (functions.length === 0) {
            context.log(`Edge function not found: ${function_identifier}`, 'info');
            return null;
        }

        return functions[0];
    },
};
