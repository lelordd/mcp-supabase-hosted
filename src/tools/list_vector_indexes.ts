import { z } from 'zod';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';
import type { ToolContext } from './types.js';

// Schema for vector index output
const VectorIndexSchema = z.object({
    index_name: z.string(),
    table_name: z.string(),
    schema_name: z.string(),
    index_method: z.string(),
    index_definition: z.string(),
});
const ListVectorIndexesOutputSchema = z.array(VectorIndexSchema);
type ListVectorIndexesOutput = z.infer<typeof ListVectorIndexesOutputSchema>;

// Input schema (none needed)
const ListVectorIndexesInputSchema = z.object({});
type ListVectorIndexesInput = z.infer<typeof ListVectorIndexesInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {},
    required: [],
};

// Tool definition
export const listVectorIndexesTool = {
    name: 'list_vector_indexes',
    description: 'Lists all pgvector indexes (ivfflat, hnsw) in the database. Returns empty array if pgvector is not installed or no vector indexes exist.',
    inputSchema: ListVectorIndexesInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListVectorIndexesOutputSchema,
    execute: async (input: ListVectorIndexesInput, context: ToolContext): Promise<ListVectorIndexesOutput> => {
        const client = context.selfhostedClient;

        // Query for pgvector indexes using index access method names
        // This will return empty if pgvector is not installed (no ivfflat/hnsw access methods)
        const listVectorIndexesSql = `
            SELECT
                ix.relname AS index_name,
                t.relname AS table_name,
                n.nspname AS schema_name,
                am.amname AS index_method,
                pg_get_indexdef(i.indexrelid) AS index_definition
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_class ix ON ix.oid = i.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_am am ON am.oid = ix.relam
            WHERE am.amname IN ('ivfflat', 'hnsw')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            ORDER BY n.nspname, t.relname, ix.relname
        `;

        const result = await executeSqlWithFallback(client, listVectorIndexesSql, true);

        // The query will naturally return empty if pgvector is not installed
        // since there won't be any 'ivfflat' or 'hnsw' access methods
        const indexes = handleSqlResponse(result, ListVectorIndexesOutputSchema);

        if (indexes.length === 0) {
            context.log('No pgvector indexes found (pgvector may not be installed or no indexes created)', 'info');
        }

        return indexes;
    },
};
