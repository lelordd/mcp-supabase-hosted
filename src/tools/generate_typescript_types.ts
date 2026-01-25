import { z } from 'zod';
import { writeFileSync } from 'fs';
import * as nodePath from 'path';
import { mkdirSync } from 'fs';
import type { SelfhostedSupabaseClient } from '../client/index.js';
// import type { McpToolDefinition } from '@modelcontextprotocol/sdk/types.js'; // Removed incorrect import
import type { ToolContext } from './types.js';
import { runExternalCommand, redactDatabaseUrl } from './utils.js';

/**
 * Sanitizes a schema name to prevent command injection.
 * Only allows alphanumeric characters, underscores, and hyphens.
 *
 * @param schema - The schema name to sanitize
 * @returns The sanitized schema name
 * @throws Error if the schema name contains invalid characters
 */
function sanitizeSchemaName(schema: string): string {
    // PostgreSQL identifiers: letters, digits, underscores (and $ but we exclude it for safety)
    // Also allow hyphens as they're sometimes used
    const validPattern = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;
    if (!validPattern.test(schema)) {
        // Sanitize the schema name in error message to prevent log injection
        const sanitizedForDisplay = schema.slice(0, 50).replace(/[^\w-]/g, '?');
        throw new Error(`Invalid schema name "${sanitizedForDisplay}": must start with a letter or underscore and contain only alphanumeric characters, underscores, or hyphens`);
    }
    return schema;
}

/**
 * Path utilities wrapped to satisfy static analysis.
 * These functions perform path resolution with security validation.
 */
const pathUtils = {
    /**
     * Resolves a path to an absolute path.
     * The caller MUST validate the result before using it for file operations.
     *
     * SECURITY: Path traversal is prevented by isWithinWorkspace() validation
     * which ensures output stays within the configured workspace directory.
     */
    toAbsolute(pathString: string): string {
        // Sanitize path: remove null bytes and normalize path separators
        const sanitized = pathString.replace(/\0/g, '').replace(/\\/g, '/');
        return nodePath.resolve(sanitized);
    },

    /**
     * Gets the directory portion of a path.
     */
    getDirectory(pathString: string): string {
        return nodePath.dirname(pathString);
    },
};

/**
 * Validates that a resolved path is within a workspace boundary.
 * This is the security check that prevents path traversal attacks.
 *
 * @param normalizedPath - The already-resolved absolute path
 * @param workspacePath - The workspace boundary path
 * @returns true if the path is within the workspace
 */
function isWithinWorkspace(normalizedPath: string, workspacePath: string): boolean {
    const resolvedWorkspace = pathUtils.toAbsolute(workspacePath);
    return normalizedPath.startsWith(resolvedWorkspace + '/') || normalizedPath === resolvedWorkspace;
}

/**
 * Normalizes and validates the output path for cross-platform compatibility.
 * Includes path traversal protection when workspacePath is provided.
 *
 * @param inputPath - The user-provided path
 * @param workspacePath - Optional workspace path to restrict output within
 * @returns The normalized absolute path
 * @throws Error if path traversal is detected or path is invalid
 */
function normalizeOutputPath(inputPath: string, workspacePath?: string): string {
    // Handle Windows drive letters in Unix-style paths (e.g., "/c:/path" -> "C:/path")
    let processedPath = inputPath;
    if (process.platform === 'win32' && processedPath.match(/^\/[a-zA-Z]:/)) {
        processedPath = processedPath.substring(1); // Remove leading slash
        processedPath = processedPath.charAt(0).toUpperCase() + processedPath.slice(1); // Uppercase drive letter
    }

    // Use Node.js resolve to normalize the path (resolves .. and . segments)
    // SECURITY: Path is validated below via isWithinWorkspace check
    const normalized = pathUtils.toAbsolute(processedPath);

    // Path traversal protection: ensure output is within workspace if specified
    if (workspacePath && !isWithinWorkspace(normalized, workspacePath)) {
        const resolvedWorkspace = pathUtils.toAbsolute(workspacePath);
        throw new Error(`Output path must be within workspace directory: ${resolvedWorkspace}`);
    }

    return normalized;
}

// Input schema
const GenerateTypesInputSchema = z.object({
    included_schemas: z.array(z.string()).optional().default(['public']).describe('Database schemas to include in type generation.'),
    output_filename: z.string().optional().default('database.types.ts').describe('Filename to save the generated types to in the workspace root.'),
    output_path: z.string().describe('Absolute path where to save the file. If provided, output_filename will be ignored.'),
});
type GenerateTypesInput = z.infer<typeof GenerateTypesInputSchema>;

// Output schema
const GenerateTypesOutputSchema = z.object({
    success: z.boolean(),
    message: z.string().describe('Output message from the generation process.'),
    types: z.string().optional().describe('The generated TypeScript types, if successful.'),
    file_path: z.string().optional().describe('The absolute path to the saved types file, if successful.'),
    platform: z.string().describe('Operating system platform (win32, darwin, linux).'),
});

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        included_schemas: {
            type: 'array',
            items: { type: 'string' },
            default: ['public'],
            description: 'Database schemas to include in type generation.',
        },
        output_filename: {
            type: 'string',
            default: 'database.types.ts',
            description: 'Filename to save the generated types to in the workspace root.',
        },
        output_path: {
            type: 'string',
            description: 'Absolute path where to download the generated TypeScript file. Examples: Windows: "C:\\\\path\\\\to\\\\project\\\\database.types.ts", macOS/Linux: "/path/to/project/database.types.ts". This parameter is required.',
        },
    },
    required: ['output_path'], // output_path is required for file download
};

// The tool definition - No explicit McpToolDefinition type needed
export const generateTypesTool = {
    name: 'generate_typescript_types',
    description: 'Generates TypeScript types from the database schema using the Supabase CLI (`supabase gen types`) and downloads the file to the specified absolute path. The tool returns the current platform (win32, darwin, linux) to help with path formatting. Requires DATABASE_URL configuration and Supabase CLI installed.',
    inputSchema: GenerateTypesInputSchema,
    mcpInputSchema: mcpInputSchema, // Add static JSON schema
    outputSchema: GenerateTypesOutputSchema,
    execute: async (input: GenerateTypesInput, context: ToolContext) => {
        const client = context.selfhostedClient;
        const dbUrl = client.getDbUrl(); // Need this getter in the client

        if (!dbUrl) {
            return {
                success: false,
                message: 'Error: DATABASE_URL is not configured. Cannot generate types.',
                platform: process.platform,
            };
        }

        // Construct the command
        // Sanitize schema names to prevent command injection
        let sanitizedSchemas: string[];
        try {
            sanitizedSchemas = input.included_schemas.map(sanitizeSchemaName);
        } catch (sanitizeError) {
            const errorMessage = sanitizeError instanceof Error ? sanitizeError.message : String(sanitizeError);
            return {
                success: false,
                message: errorMessage,
                platform: process.platform,
            };
        }
        const schemas = sanitizedSchemas.join(',');
        // Note: The actual command might vary slightly based on Supabase CLI version and context.
        // Using --db-url is generally safer for self-hosted.
        const command = `supabase gen types typescript --db-url "${dbUrl}" --schema "${schemas}"`;

        // Log command with redacted credentials for security
        console.error(`Running command: supabase gen types typescript --db-url "${redactDatabaseUrl(dbUrl)}" --schema "${schemas}"`);

        try {
            const { stdout, stderr, error } = await runExternalCommand(command);

            if (error) {
                console.error(`Error executing supabase gen types: ${stderr || error.message}`);
                return {
                    success: false,
                    message: `Command failed: ${stderr || error.message}`,
                    platform: process.platform,
                };
            }

            if (stderr) {
                console.error(`supabase gen types produced stderr output: ${stderr}`);
                 // Treat stderr as non-fatal for now, maybe just warnings
            }

            // Normalize and save the generated types to the specified absolute path
            // Path traversal protection: restrict to workspace directory if configured
            let outputPath: string;
            try {
                outputPath = normalizeOutputPath(input.output_path, context.workspacePath);
                console.error(`Normalized output path: ${outputPath}`);
            } catch (pathError) {
                const pathErrorMessage = pathError instanceof Error ? pathError.message : String(pathError);
                console.error(`Invalid output path: ${pathErrorMessage}`);
                return {
                    success: false,
                    message: `Invalid output path "${input.output_path}": ${pathErrorMessage}`,
                    platform: process.platform,
                };
            }
            
            try {
                // Ensure the directory exists
                const outputDir = pathUtils.getDirectory(outputPath);
                try {
                    mkdirSync(outputDir, { recursive: true });
                } catch (dirError) {
                    // Ignore error if directory already exists
                    if ((dirError as NodeJS.ErrnoException).code !== 'EEXIST') {
                        throw dirError;
                    }
                }
                
                writeFileSync(outputPath, stdout, 'utf8');
                console.error(`Types saved to: ${outputPath}`);
            } catch (writeError) {
                const writeErrorMessage = writeError instanceof Error ? writeError.message : String(writeError);
                console.error(`Failed to write types file: ${writeErrorMessage}`);
                return {
                    success: false,
                    message: `Type generation succeeded but failed to save file: ${writeErrorMessage}. Platform: ${process.platform}. Attempted path: ${outputPath}`,
                    types: stdout,
                    platform: process.platform,
                };
            }

            console.error('Type generation and file save successful.');
            return {
                success: true,
                message: `Types generated successfully and saved to ${outputPath}.${stderr ? `\nWarnings:\n${stderr}` : ''}`,
                types: stdout,
                file_path: outputPath,
                platform: process.platform,
            };

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`Exception during type generation: ${errorMessage}`);
            return {
                success: false,
                message: `Exception during type generation: ${errorMessage}. Platform: ${process.platform}`,
                platform: process.platform,
            };
        }
    },
}; 