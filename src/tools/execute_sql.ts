import { z } from 'zod';
import type { SelfhostedSupabaseClient } from '../client/index.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';

// Input schema
const ExecuteSqlInputSchema = z.object({
    sql: z.string().describe('The SQL query to execute.'),
    read_only: z.boolean().optional().default(false).describe('Hint for the RPC function whether the query is read-only (best effort).'),
    // Future enhancement: Add option to force direct connection?
    // use_direct_connection: z.boolean().optional().default(false).describe('Attempt to use direct DB connection instead of RPC.'),
});
type ExecuteSqlInput = z.infer<typeof ExecuteSqlInputSchema>;

// Output schema - expects an array of results (rows)
const ExecuteSqlOutputSchema = z.array(z.unknown()).describe('The array of rows returned by the SQL query.');

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        sql: { type: 'string', description: 'The SQL query to execute.' },
        read_only: { type: 'boolean', default: false, description: 'Hint for the RPC function whether the query is read-only (best effort).' },
    },
    required: ['sql'],
};

// The tool definition - No explicit McpToolDefinition type needed
export const executeSqlTool = {
    name: 'execute_sql',
    description: 'Executes an arbitrary SQL query against the database. SECURITY: Requires service_role key or direct database connection.',
    privilegeLevel: 'privileged' as ToolPrivilegeLevel,
    inputSchema: ExecuteSqlInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ExecuteSqlOutputSchema,
    execute: async (input: ExecuteSqlInput, context: ToolContext) => {
        const client = context.selfhostedClient;

        // SECURITY: Verify privilege requirements before executing arbitrary SQL
        if (!client.isPgAvailable() && !client.isServiceRoleAvailable()) {
            throw new Error(
                'execute_sql requires either a direct database connection (DATABASE_URL) ' +
                'or a service role key (SUPABASE_SERVICE_ROLE_KEY) to be configured. ' +
                'This tool cannot be used with only the anon key for security reasons.'
            );
        }

        // AUDIT: Log SQL execution with user context
        const userInfo = context.user
            ? `user=${context.user.email || context.user.userId} role=${context.user.role}`
            : 'user=unknown (stdio mode)';

        // Log query for audit (truncate long queries)
        const queryPreview = input.sql.length > 200
            ? `${input.sql.substring(0, 200)}... [truncated, ${input.sql.length} chars total]`
            : input.sql;

        console.error(`[AUDIT] SQL execution by ${userInfo}: ${queryPreview}`);
        context.log(`Executing SQL (readOnly: ${input.read_only})`, 'info');

        const result = await executeSqlWithFallback(client, input.sql, input.read_only);
        return handleSqlResponse(result, ExecuteSqlOutputSchema);
    },
}; 