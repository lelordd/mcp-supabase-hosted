import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for cron job output
const CronJobSchema = z.object({
    jobid: z.number(),
    schedule: z.string(),
    command: z.string(),
    nodename: z.string(),
    nodeport: z.number(),
    database: z.string(),
    username: z.string(),
    active: z.boolean(),
});
const ListCronJobsOutputSchema = z.array(CronJobSchema);
type ListCronJobsOutput = z.infer<typeof ListCronJobsOutputSchema>;

// Input schema (none needed)
const ListCronJobsInputSchema = z.object({});
type ListCronJobsInput = z.infer<typeof ListCronJobsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {},
    required: [],
};

// Tool definition
export const listCronJobsTool = {
    name: 'list_cron_jobs',
    description: 'Lists all scheduled cron jobs from pg_cron extension. Returns empty array if pg_cron is not installed.',
    inputSchema: ListCronJobsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListCronJobsOutputSchema,
    execute: async (input: ListCronJobsInput, context: ToolContext): Promise<ListCronJobsOutput> => {
        const client = context.selfhostedClient;

        // First check if cron schema exists
        const checkSchemaSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
            ) AS exists
        `;

        const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

        // Handle the schema check result
        if (Array.isArray(schemaCheckResult) && schemaCheckResult.length > 0) {
            const exists = schemaCheckResult[0]?.exists;
            if (!exists) {
                context.log('pg_cron extension not installed (cron schema not found)', 'info');
                return [];
            }
        } else {
            context.log('Could not verify pg_cron installation', 'warn');
            return [];
        }

        // Query cron jobs
        const listCronJobsSql = `
            SELECT
                jobid,
                schedule,
                command,
                nodename,
                nodeport,
                database,
                username,
                active
            FROM cron.job
            ORDER BY jobid
        `;

        const result = await executeSqlWithFallback(client, listCronJobsSql, true);
        return handleSqlResponse(result, ListCronJobsOutputSchema);
    },
};
