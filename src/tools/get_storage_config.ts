import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for bucket configuration
const BucketConfigSchema = z.object({
    id: z.string(),
    name: z.string(),
    public: z.boolean(),
    file_size_limit: z.number().nullable(),
    allowed_mime_types: z.array(z.string()).nullable(),
    avif_autodetection: z.boolean().nullable(),
    owner: z.string().nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
});

// Schema for output
const GetStorageConfigOutputSchema = z.object({
    buckets: z.array(BucketConfigSchema),
    global_config: z.object({
        max_file_size_limit: z.number().nullable(),
        bucket_count: z.number(),
    }),
});
type GetStorageConfigOutput = z.infer<typeof GetStorageConfigOutputSchema>;

// Input schema
const GetStorageConfigInputSchema = z.object({
    bucket_id: z.string().optional().describe('Optional bucket ID to get config for a specific bucket. If omitted, returns all buckets.'),
});
type GetStorageConfigInput = z.infer<typeof GetStorageConfigInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        bucket_id: {
            type: 'string',
            description: 'Optional bucket ID to get config for a specific bucket. If omitted, returns all buckets.',
        },
    },
    required: [],
};

// Tool definition
export const getStorageConfigTool = {
    name: 'get_storage_config',
    description: 'Gets storage configuration for Supabase Storage buckets. Returns bucket settings including file size limits, allowed MIME types, and public/private status.',
    inputSchema: GetStorageConfigInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetStorageConfigOutputSchema,
    execute: async (input: GetStorageConfigInput, context: ToolContext): Promise<GetStorageConfigOutput> => {
        const client = context.selfhostedClient;
        const { bucket_id } = input;

        // Check if storage schema exists
        const checkSchemaSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'storage'
            ) AS exists
        `;

        const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

        if (!Array.isArray(schemaCheckResult) || schemaCheckResult.length === 0 || !schemaCheckResult[0]?.exists) {
            context.log('storage schema not found - Storage may not be configured', 'info');
            return {
                buckets: [],
                global_config: {
                    max_file_size_limit: null,
                    bucket_count: 0,
                },
            };
        }

        // Build query for buckets
        let bucketQuery = `
            SELECT
                id,
                name,
                public,
                file_size_limit,
                allowed_mime_types,
                avif_autodetection,
                owner::text,
                created_at::text,
                updated_at::text
            FROM storage.buckets
        `;

        if (bucket_id) {
            // Escape single quotes
            const escapedBucketId = bucket_id.replace(/'/g, "''");
            bucketQuery += ` WHERE id = '${escapedBucketId}'`;
        }

        bucketQuery += ' ORDER BY name';

        const bucketsResult = await executeSqlWithFallback(client, bucketQuery, true);

        const bucketsSchema = z.array(
            z.object({
                id: z.string(),
                name: z.string(),
                public: z.boolean(),
                file_size_limit: z.number().nullable(),
                allowed_mime_types: z.array(z.string()).nullable(),
                avif_autodetection: z.boolean().nullable(),
                owner: z.string().nullable(),
                created_at: z.string().nullable(),
                updated_at: z.string().nullable(),
            })
        );

        const buckets = handleSqlResponse(bucketsResult, bucketsSchema);

        // Get global stats
        const statsQuery = `
            SELECT
                MAX(file_size_limit) as max_file_size_limit,
                COUNT(*) as bucket_count
            FROM storage.buckets
        `;

        const statsResult = await executeSqlWithFallback(client, statsQuery, true);

        let globalConfig = {
            max_file_size_limit: null as number | null,
            bucket_count: buckets.length,
        };

        if (Array.isArray(statsResult) && statsResult.length > 0) {
            const maxLimit = statsResult[0]?.max_file_size_limit;
            globalConfig = {
                max_file_size_limit: typeof maxLimit === 'number' ? maxLimit : null,
                bucket_count: Number(statsResult[0]?.bucket_count) || 0,
            };
        }

        return {
            buckets,
            global_config: globalConfig,
        };
    },
};
