import { z } from 'zod';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';
import { handleSqlResponse, executeSqlWithFallback } from './utils.js';

// Output schema for available extensions
const ListAvailableExtensionsOutputSchema = z.array(z.object({
    name: z.string(),
    default_version: z.string(),
    installed_version: z.string().nullable(),
    is_installed: z.boolean(),
    comment: z.string().nullable(),
}));

// Input schema
const ListAvailableExtensionsInputSchema = z.object({
    show_installed: z.boolean().optional().default(true).describe('Include already installed extensions.'),
    name_pattern: z.string().optional().describe('Filter by extension name pattern (SQL LIKE).'),
});
type ListAvailableExtensionsInput = z.infer<typeof ListAvailableExtensionsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        show_installed: {
            type: 'boolean',
            default: true,
            description: 'Include already installed extensions.',
        },
        name_pattern: {
            type: 'string',
            description: 'Filter by extension name pattern (SQL LIKE).',
        },
    },
    required: [],
};

// Safe pattern for LIKE expressions - allow wildcards but escape dangerous chars
const likePattern = /^[a-zA-Z0-9_$%\-]+$/;

export const listAvailableExtensionsTool = {
    name: 'list_available_extensions',
    description: 'Lists all PostgreSQL extensions available for installation, including those already installed.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: ListAvailableExtensionsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: ListAvailableExtensionsOutputSchema,

    execute: async (input: ListAvailableExtensionsInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const { show_installed, name_pattern } = input;

        // Validate name pattern if provided
        if (name_pattern && !likePattern.test(name_pattern)) {
            throw new Error(`Invalid name pattern: ${name_pattern}. Use only alphanumeric, underscore, hyphen, dollar sign, and % wildcard.`);
        }

        // Build WHERE conditions
        const conditions: string[] = [];

        if (!show_installed) {
            conditions.push('installed_version IS NULL');
        }
        if (name_pattern) {
            conditions.push(`name LIKE '${name_pattern}'`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
            SELECT
                name,
                default_version,
                installed_version,
                installed_version IS NOT NULL AS is_installed,
                comment
            FROM pg_available_extensions
            ${whereClause}
            ORDER BY name
        `;

        const result = await executeSqlWithFallback(client, sql, true);
        return handleSqlResponse(result, ListAvailableExtensionsOutputSchema);
    },
};
