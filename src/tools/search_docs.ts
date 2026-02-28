import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';

const SUPABASE_DOCS_GRAPHQL_URL = 'https://supabase.com/docs/api/graphql';

// Input schema
const SearchDocsInputSchema = z.object({
    graphql_query: z.string().describe('GraphQL query string'),
});
type SearchDocsInput = z.infer<typeof SearchDocsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        graphql_query: {
            type: 'string',
            description: 'GraphQL query string. You should default to calling this even if you think you already know the answer, since the documentation is always being updated.',
        },
    },
    required: ['graphql_query'],
};

// Output schema
const SearchDocsOutputSchema = z.object({
    result: z.unknown().describe('GraphQL query result'),
});

export const searchDocsTool = {
    name: 'search_docs',
    description: 'Search the Supabase documentation using GraphQL. Must be a valid GraphQL query.',
    privilegeLevel: 'read' as ToolPrivilegeLevel,
    inputSchema: SearchDocsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: SearchDocsOutputSchema,

    execute: async (input: SearchDocsInput, context: ToolContext) => {
        const { graphql_query } = input;

        try {
            const url = new URL(SUPABASE_DOCS_GRAPHQL_URL);
            url.searchParams.set('query', graphql_query);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch Supabase docs: HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.errors) {
                const errorMessages = data.errors.map((e: any) => e.message).join(', ');
                throw new Error(`GraphQL error: ${errorMessages}`);
            }

            return { result: data.data };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to search docs: ${errorMessage}`);
        }
    },
};
