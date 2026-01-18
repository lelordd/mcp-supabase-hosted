import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback, isSqlErrorResponse } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for updated bucket output
const UpdatedBucketSchema = z.object({
    id: z.string(),
    name: z.string(),
    public: z.boolean(),
    file_size_limit: z.number().nullable(),
    allowed_mime_types: z.array(z.string()).nullable(),
});
const UpdateStorageConfigOutputSchema = z.object({
    success: z.boolean(),
    bucket: UpdatedBucketSchema.nullable(),
    message: z.string(),
});
type UpdateStorageConfigOutput = z.infer<typeof UpdateStorageConfigOutputSchema>;

// Input schema
const UpdateStorageConfigInputSchema = z.object({
    bucket_id: z.string().describe('The bucket ID to update'),
    file_size_limit: z.number().min(0).optional().describe('Maximum file size in bytes (0 or null for no limit)'),
    allowed_mime_types: z.array(z.string()).optional().describe('Array of allowed MIME types (e.g., ["image/png", "image/jpeg"]). Empty array means all types allowed.'),
    public: z.boolean().optional().describe('Whether the bucket is publicly accessible'),
});
type UpdateStorageConfigInput = z.infer<typeof UpdateStorageConfigInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        bucket_id: {
            type: 'string',
            description: 'The bucket ID to update',
        },
        file_size_limit: {
            type: 'number',
            minimum: 0,
            description: 'Maximum file size in bytes (0 or null for no limit)',
        },
        allowed_mime_types: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of allowed MIME types (e.g., ["image/png", "image/jpeg"]). Empty array means all types allowed.',
        },
        public: {
            type: 'boolean',
            description: 'Whether the bucket is publicly accessible',
        },
    },
    required: ['bucket_id'],
};

// Tool definition
export const updateStorageConfigTool = {
    name: 'update_storage_config',
    description: 'Updates storage configuration for a Supabase Storage bucket. Can modify file size limits, allowed MIME types, and public/private status.',
    inputSchema: UpdateStorageConfigInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: UpdateStorageConfigOutputSchema,
    execute: async (input: UpdateStorageConfigInput, context: ToolContext): Promise<UpdateStorageConfigOutput> => {
        const client = context.selfhostedClient;
        const { bucket_id, file_size_limit, allowed_mime_types, public: isPublic } = input;

        // Check if storage schema exists
        const checkSchemaSql = `
            SELECT EXISTS (
                SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'storage'
            ) AS exists
        `;

        const schemaCheckResult = await executeSqlWithFallback(client, checkSchemaSql, true);

        if (!Array.isArray(schemaCheckResult) || schemaCheckResult.length === 0 || !schemaCheckResult[0]?.exists) {
            return {
                success: false,
                bucket: null,
                message: 'Storage schema not found - Storage may not be configured',
            };
        }

        // Check if bucket exists
        const escapedBucketId = bucket_id.replace(/'/g, "''");
        const checkBucketSql = `
            SELECT EXISTS (
                SELECT 1 FROM storage.buckets WHERE id = '${escapedBucketId}'
            ) AS exists
        `;

        const bucketCheckResult = await executeSqlWithFallback(client, checkBucketSql, true);

        if (!Array.isArray(bucketCheckResult) || bucketCheckResult.length === 0 || !bucketCheckResult[0]?.exists) {
            return {
                success: false,
                bucket: null,
                message: `Bucket '${bucket_id}' not found`,
            };
        }

        // Build update query
        const updates: string[] = [];

        if (file_size_limit !== undefined) {
            updates.push(`file_size_limit = ${file_size_limit === 0 ? 'NULL' : file_size_limit}`);
        }

        if (allowed_mime_types !== undefined) {
            if (allowed_mime_types.length === 0) {
                updates.push('allowed_mime_types = NULL');
            } else {
                const escapedTypes = allowed_mime_types.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
                updates.push(`allowed_mime_types = ARRAY[${escapedTypes}]`);
            }
        }

        if (isPublic !== undefined) {
            updates.push(`public = ${isPublic}`);
        }

        if (updates.length === 0) {
            return {
                success: false,
                bucket: null,
                message: 'No updates specified. Provide at least one of: file_size_limit, allowed_mime_types, or public',
            };
        }

        updates.push('updated_at = NOW()');

        const updateSql = `
            UPDATE storage.buckets
            SET ${updates.join(', ')}
            WHERE id = '${escapedBucketId}'
            RETURNING id, name, public, file_size_limit, allowed_mime_types
        `;

        const updateResult = await executeSqlWithFallback(client, updateSql, false);

        if (isSqlErrorResponse(updateResult)) {
            return {
                success: false,
                bucket: null,
                message: `Failed to update bucket: ${updateResult.error.message}`,
            };
        }

        const resultSchema = z.array(
            z.object({
                id: z.string(),
                name: z.string(),
                public: z.boolean(),
                file_size_limit: z.number().nullable(),
                allowed_mime_types: z.array(z.string()).nullable(),
            })
        );

        try {
            const updatedBuckets = handleSqlResponse(updateResult, resultSchema);

            if (updatedBuckets.length === 0) {
                return {
                    success: false,
                    bucket: null,
                    message: 'Update executed but no rows returned',
                };
            }

            return {
                success: true,
                bucket: updatedBuckets[0],
                message: `Successfully updated bucket '${bucket_id}'`,
            };
        } catch (error) {
            return {
                success: false,
                bucket: null,
                message: `Failed to parse update result: ${error}`,
            };
        }
    },
};
