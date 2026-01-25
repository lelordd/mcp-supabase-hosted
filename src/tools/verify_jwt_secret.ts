import { z } from 'zod';
import type { SelfhostedSupabaseClient } from '../client/index.js';
import type { ToolContext, ToolPrivilegeLevel } from './types.js';

// Input schema (none needed)
const VerifyJwtInputSchema = z.object({});
type VerifyJwtInput = z.infer<typeof VerifyJwtInputSchema>;

// Output schema - SECURITY: Removed jwt_secret_preview to avoid leaking secret info
const VerifyJwtOutputSchema = z.object({
    jwt_secret_status: z.enum(['found', 'not_configured']).describe('Whether the JWT secret was provided to the server.'),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {},
    required: [],
};

// The tool definition
export const verifyJwtSecretTool = {
    name: 'verify_jwt_secret',
    description: 'Checks if the Supabase JWT secret is configured for this server.',
    privilegeLevel: 'regular' as ToolPrivilegeLevel,
    inputSchema: VerifyJwtInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: VerifyJwtOutputSchema,
    execute: async (input: VerifyJwtInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const secret = client.getJwtSecret();

        if (secret) {
            // SECURITY: Only return status, no preview of the secret
            return { jwt_secret_status: 'found' as const };
        }

        return { jwt_secret_status: 'not_configured' as const };
    },
};
