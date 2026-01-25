import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for edge function output
const EdgeFunctionSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    status: z.string().nullable(),
    version: z.number().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
});
const ListEdgeFunctionsOutputSchema = z.array(EdgeFunctionSchema);
type ListEdgeFunctionsOutput = z.infer<typeof ListEdgeFunctionsOutputSchema>;

// Input schema (none needed)
const ListEdgeFunctionsInputSchema = z.object({});
type ListEdgeFunctionsInput = z.infer<typeof ListEdgeFunctionsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {},
    required: [],
};

// Tool definition
export const listEdgeFunctionsTool = {
    name: 'list_edge_functions',
    description: 'Lists all deployed Supabase Edge Functions. Returns empty array if edge functions are not available or none are deployed.',
    inputSchema: ListEdgeFunctionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListEdgeFunctionsOutputSchema,
    execute: async (input: ListEdgeFunctionsInput, context: ToolContext): Promise<ListEdgeFunctionsOutput> => {
        const client = context.selfhostedClient;

        // First check if supabase_functions schema exists
        const checkSchemaSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_functions'
            ) AS exists
        `;

        const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

        // Handle the schema check result
        if (Array.isArray(schemaCheckResult) && schemaCheckResult.length > 0) {
            const exists = schemaCheckResult[0]?.exists;
            if (!exists) {
                context.log('supabase_functions schema not found - Edge Functions may not be available in this installation', 'info');
                return [];
            }
        } else {
            context.log('Could not verify supabase_functions schema', 'warn');
            return [];
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
                return [];
            }
        } else {
            context.log('Could not verify functions table', 'warn');
            return [];
        }

        // Query edge functions
        const listEdgeFunctionsSql = `
            SELECT
                id,
                name,
                slug,
                status,
                version,
                created_at::text,
                updated_at::text
            FROM supabase_functions.functions
            ORDER BY name
        `;

        const result = await executeSqlWithFallback(client, listEdgeFunctionsSql, true);
        return handleSqlResponse(result, ListEdgeFunctionsOutputSchema);
    },
};
