import { Command } from 'commander';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { SelfhostedSupabaseClient } from './client/index.js';
import { HttpMcpServer } from './server/http-server.js';
import { listTablesTool } from './tools/list_tables.js';
import { listExtensionsTool } from './tools/list_extensions.js';
import { listMigrationsTool } from './tools/list_migrations.js';
import { applyMigrationTool } from './tools/apply_migration.js';
import { executeSqlTool } from './tools/execute_sql.js';
import { getDatabaseConnectionsTool } from './tools/get_database_connections.js';
import { getDatabaseStatsTool } from './tools/get_database_stats.js';
import { getProjectUrlTool } from './tools/get_project_url.js';
import { generateTypesTool } from './tools/generate_typescript_types.js';
import { rebuildHooksTool } from './tools/rebuild_hooks.js';
import { verifyJwtSecretTool } from './tools/verify_jwt_secret.js';
import { listAuthUsersTool } from './tools/list_auth_users.js';
import { getAuthUserTool } from './tools/get_auth_user.js';
import { deleteAuthUserTool } from './tools/delete_auth_user.js';
import { createAuthUserTool } from './tools/create_auth_user.js';
import { updateAuthUserTool } from './tools/update_auth_user.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { canAccessTool, type ToolContext, type ToolPrivilegeLevel, type UserContext } from './tools/types.js';
import listStorageBucketsTool from './tools/list_storage_buckets.js';
import listStorageObjectsTool from './tools/list_storage_objects.js';
import listRealtimePublicationsTool from './tools/list_realtime_publications.js';
import { listCronJobsTool } from './tools/list_cron_jobs.js';
import { listVectorIndexesTool } from './tools/list_vector_indexes.js';
import { listEdgeFunctionsTool } from './tools/list_edge_functions.js';
import { getEdgeFunctionDetailsTool } from './tools/get_edge_function_details.js';
import { getLogsTool } from './tools/get_logs.js';
import { getAdvisorsTool } from './tools/get_advisors.js';
import { getStorageConfigTool } from './tools/get_storage_config.js';
import { updateStorageConfigTool } from './tools/update_storage_config.js';
import { listTableColumnsTool } from './tools/list_table_columns.js';
import { listIndexesTool } from './tools/list_indexes.js';
import { listConstraintsTool } from './tools/list_constraints.js';
import { listForeignKeysTool } from './tools/list_foreign_keys.js';
import { listRlsPoliciesTool } from './tools/list_rls_policies.js';
import { listTriggersTool } from './tools/list_triggers.js';
import { listDatabaseFunctionsTool } from './tools/list_database_functions.js';
import { getFunctionDefinitionTool } from './tools/get_function_definition.js';
import { getTriggerDefinitionTool } from './tools/get_trigger_definition.js';
import { getRlsStatusTool } from './tools/get_rls_status.js';
import { listAvailableExtensionsTool } from './tools/list_available_extensions.js';
import { getCronJobHistoryTool } from './tools/get_cron_job_history.js';
import { listEdgeFunctionLogsTool } from './tools/list_edge_function_logs.js';
import { getIndexStatsTool } from './tools/get_index_stats.js';
import { getVectorIndexStatsTool } from './tools/get_vector_index_stats.js';
import { explainQueryTool } from './tools/explain_query.js';

// Node.js built-in modules
import * as fs from 'node:fs';
import * as path from 'node:path';

// Define the structure expected by MCP for tool definitions
interface McpToolSchema {
    name: string;
    description?: string;
    // inputSchema is the JSON Schema object for MCP capabilities
    inputSchema: object; 
}

// Base structure for our tool objects - For Reference
interface AppTool {
    name: string;
    description: string;
    inputSchema: z.ZodTypeAny; // Zod schema for parsing
    mcpInputSchema: object;    // Static JSON schema for MCP (Required)
    outputSchema: z.ZodTypeAny; // Zod schema for output (optional)
    privilegeLevel?: ToolPrivilegeLevel; // Privilege level for access control
    execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

// Main function
async function main() {
    const program = new Command();

    program
        .name('self-hosted-supabase-mcp')
        .description('MCP Server for self-hosted Supabase instances')
        .option('--url <url>', 'Supabase project URL', process.env.SUPABASE_URL)
        .option('--anon-key <key>', 'Supabase anonymous key', process.env.SUPABASE_ANON_KEY)
        .option('--service-key <key>', 'Supabase service role key (optional)', process.env.SUPABASE_SERVICE_ROLE_KEY)
        .option('--db-url <url>', 'Direct database connection string (optional, for pg fallback)', process.env.DATABASE_URL)
        .option('--jwt-secret <secret>', 'Supabase JWT secret (optional, needed for some tools)', process.env.SUPABASE_AUTH_JWT_SECRET)
        .option('--workspace-path <path>', 'Workspace root path (for file operations)', process.cwd())
        .option('--tools-config <path>', 'Path to a JSON file specifying which tools to enable (e.g., { "enabledTools": ["tool1", "tool2"] }). If omitted, all tools are enabled.')
        .option('--transport <type>', 'Transport mode: stdio or http (default: stdio)', 'stdio')
        .option('--port <number>', 'HTTP server port (default: 3000)', '3000')
        .option('--host <string>', 'HTTP server host (default: 127.0.0.1)', '127.0.0.1')
        .option('--cors-origins <origins>', 'Comma-separated list of allowed CORS origins (default: localhost only)')
        .option('--rate-limit-window <ms>', 'Rate limit window in milliseconds (default: 60000)', '60000')
        .option('--rate-limit-max <count>', 'Max requests per rate limit window (default: 100)', '100')
        .option('--request-timeout <ms>', 'Request timeout in milliseconds (default: 30000)', '30000')
        .parse(process.argv);

    const options = program.opts();

    if (!options.url) {
        console.error('Error: Supabase URL is required. Use --url or SUPABASE_URL.');
        throw new Error('Supabase URL is required.');
    }
    if (!options.anonKey) {
        console.error('Error: Supabase Anon Key is required. Use --anon-key or SUPABASE_ANON_KEY.');
        throw new Error('Supabase Anon Key is required.');
    }

    // Validate transport option
    const transport = options.transport as string;
    if (transport !== 'stdio' && transport !== 'http') {
        console.error('Error: Invalid transport. Must be "stdio" or "http".');
        throw new Error('Invalid transport mode.');
    }

    // HTTP mode requires JWT secret for authentication
    if (transport === 'http' && !options.jwtSecret) {
        console.error('Error: --jwt-secret is required for HTTP transport mode.');
        throw new Error('JWT secret is required for HTTP mode.');
    }

    console.error(`Initializing Self-Hosted Supabase MCP Server (transport: ${transport})...`);

    try {
        const selfhostedClient = await SelfhostedSupabaseClient.create({
            supabaseUrl: options.url,
            supabaseAnonKey: options.anonKey,
            supabaseServiceRoleKey: options.serviceKey,
            databaseUrl: options.dbUrl,
            jwtSecret: options.jwtSecret,
        });

        console.error('Supabase client initialized successfully.');

        const availableTools = {
            // Cast here assumes tools will implement AppTool structure
            [listTablesTool.name]: listTablesTool as AppTool,
            [listExtensionsTool.name]: listExtensionsTool as AppTool,
            [listMigrationsTool.name]: listMigrationsTool as AppTool,
            [applyMigrationTool.name]: applyMigrationTool as AppTool,
            [executeSqlTool.name]: executeSqlTool as AppTool,
            [getDatabaseConnectionsTool.name]: getDatabaseConnectionsTool as AppTool,
            [getDatabaseStatsTool.name]: getDatabaseStatsTool as AppTool,
            [getProjectUrlTool.name]: getProjectUrlTool as AppTool,
            [generateTypesTool.name]: generateTypesTool as AppTool,
            [rebuildHooksTool.name]: rebuildHooksTool as AppTool,
            [verifyJwtSecretTool.name]: verifyJwtSecretTool as AppTool,
            [listAuthUsersTool.name]: listAuthUsersTool as AppTool,
            [getAuthUserTool.name]: getAuthUserTool as AppTool,
            [deleteAuthUserTool.name]: deleteAuthUserTool as AppTool,
            [createAuthUserTool.name]: createAuthUserTool as AppTool,
            [updateAuthUserTool.name]: updateAuthUserTool as AppTool,
            [listStorageBucketsTool.name]: listStorageBucketsTool as AppTool,
            [listStorageObjectsTool.name]: listStorageObjectsTool as AppTool,
            [listRealtimePublicationsTool.name]: listRealtimePublicationsTool as AppTool,
            [listCronJobsTool.name]: listCronJobsTool as AppTool,
            [listVectorIndexesTool.name]: listVectorIndexesTool as AppTool,
            [listEdgeFunctionsTool.name]: listEdgeFunctionsTool as AppTool,
            [getEdgeFunctionDetailsTool.name]: getEdgeFunctionDetailsTool as AppTool,
            [getLogsTool.name]: getLogsTool as AppTool,
            [getAdvisorsTool.name]: getAdvisorsTool as AppTool,
            [getStorageConfigTool.name]: getStorageConfigTool as AppTool,
            [updateStorageConfigTool.name]: updateStorageConfigTool as AppTool,
            [listTableColumnsTool.name]: listTableColumnsTool as AppTool,
            [listIndexesTool.name]: listIndexesTool as AppTool,
            [listConstraintsTool.name]: listConstraintsTool as AppTool,
            [listForeignKeysTool.name]: listForeignKeysTool as AppTool,
            [listRlsPoliciesTool.name]: listRlsPoliciesTool as AppTool,
            [listTriggersTool.name]: listTriggersTool as AppTool,
            [listDatabaseFunctionsTool.name]: listDatabaseFunctionsTool as AppTool,
            [getFunctionDefinitionTool.name]: getFunctionDefinitionTool as AppTool,
            [getTriggerDefinitionTool.name]: getTriggerDefinitionTool as AppTool,
            [getRlsStatusTool.name]: getRlsStatusTool as AppTool,
            [listAvailableExtensionsTool.name]: listAvailableExtensionsTool as AppTool,
            [getCronJobHistoryTool.name]: getCronJobHistoryTool as AppTool,
            [listEdgeFunctionLogsTool.name]: listEdgeFunctionLogsTool as AppTool,
            [getIndexStatsTool.name]: getIndexStatsTool as AppTool,
            [getVectorIndexStatsTool.name]: getVectorIndexStatsTool as AppTool,
            [explainQueryTool.name]: explainQueryTool as AppTool,
        };

        // --- Tool Filtering Logic ---
        let registeredTools: Record<string, AppTool> = { ...availableTools }; // Start with all tools
        const toolsConfigPath = options.toolsConfig as string | undefined;
        let enabledToolNames: Set<string> | null = null; // Use Set for efficient lookup

        if (toolsConfigPath) {
            try {
                const resolvedPath = path.resolve(toolsConfigPath);
                console.error(`Attempting to load tool configuration from: ${resolvedPath}`);
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`Tool configuration file not found at ${resolvedPath}`);
                }
                const configFileContent = fs.readFileSync(resolvedPath, 'utf-8');
                const configJson = JSON.parse(configFileContent);

                if (!configJson || typeof configJson !== 'object' || !Array.isArray(configJson.enabledTools)) {
                     throw new Error('Invalid config file format. Expected { "enabledTools": ["tool1", ...] }.');
                }

                // Validate that enabledTools contains only strings
                const toolNames = configJson.enabledTools as unknown[];
                if (!toolNames.every((name): name is string => typeof name === 'string')) {
                    throw new Error('Invalid config file content. "enabledTools" must be an array of strings.');
                }

                enabledToolNames = new Set(toolNames.map(name => name.trim()).filter(name => name.length > 0));

            } catch (error: unknown) {
                console.error(`Error loading or parsing tool config file '${toolsConfigPath}':`, error instanceof Error ? error.message : String(error));
                console.error('Falling back to enabling all tools due to config error.');
                enabledToolNames = null; // Reset to null to signify fallback
            }
        }

        if (enabledToolNames !== null) { // Check if we successfully got names from config
            console.error(`Whitelisting tools based on config: ${Array.from(enabledToolNames).join(', ')}`);

            registeredTools = {}; // Reset and add only whitelisted tools
            for (const toolName in availableTools) {
                if (enabledToolNames.has(toolName)) {
                    registeredTools[toolName] = availableTools[toolName];
                } else {
                    console.error(`Tool ${toolName} disabled (not in config whitelist).`);
                }
            }

            // Check if any tools specified in the config were not found in availableTools
            // Use Object.hasOwn to prevent prototype pollution / object injection attacks
            for (const requestedName of enabledToolNames) {
                if (!Object.hasOwn(availableTools, requestedName)) {
                    console.warn(`Warning: Tool "${requestedName}" specified in config file not found.`);
                }
            }
        } else {
            console.error("No valid --tools-config specified or error loading config, enabling all available tools.");
            // registeredTools already defaults to all tools, so no action needed here
        }
        // --- End Tool Filtering Logic ---

        // Prepare capabilities for the Server constructor
        const capabilitiesTools: Record<string, McpToolSchema> = {};
        // Use the potentially filtered 'registeredTools' map
        for (const tool of Object.values(registeredTools)) {
            capabilitiesTools[tool.name] = {
                name: tool.name,
                description: tool.description || 'Tool description missing',
                inputSchema: tool.mcpInputSchema,
            };
        }

        const capabilities = { tools: capabilitiesTools };

        // Factory function to create a configured MCP server instance
        // This is needed for HTTP mode where each request may need a fresh server
        // In HTTP mode, userContext is provided for privilege-level enforcement
        const createMcpServer = (userContext?: UserContext): Server => {
            const server = new Server(
                {
                    name: 'self-hosted-supabase-mcp',
                    version: '1.3.0',
                },
                {
                    capabilities,
                },
            );

            // The ListTools handler should return the array matching McpToolSchema structure
            server.setRequestHandler(ListToolsRequestSchema, async () => ({
                tools: Object.values(capabilities.tools),
            }));

            server.setRequestHandler(CallToolRequestSchema, async (request) => {
                const toolName = request.params.name;

                // SECURITY: Use Object.hasOwn to prevent prototype pollution / object injection
                // Look up the tool in the filtered 'registeredTools' map
                if (!Object.hasOwn(registeredTools, toolName)) {
                    // Check if it existed originally but was filtered out
                    if (Object.hasOwn(availableTools, toolName)) {
                        throw new McpError(ErrorCode.MethodNotFound, `Tool "${toolName}" is available but not enabled by the current server configuration.`);
                    }
                    // If the tool wasn't in the original list either, it's unknown
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
                }

                // Safe: Object.hasOwn check above validates toolName exists as own property
                const tool = registeredTools[toolName]; // NOSONAR - validated via Object.hasOwn

                // SECURITY: Check privilege level in HTTP mode
                // In stdio mode (no userContext), all tools are accessible (trusted local process)
                if (userContext) {
                    const toolPrivilegeLevel = tool.privilegeLevel ?? 'regular';
                    if (!canAccessTool(userContext.role, toolPrivilegeLevel)) {
                        console.error(`[SECURITY] Access denied: User ${userContext.email || userContext.userId} (role: ${userContext.role}) attempted to access ${toolName} (requires: ${toolPrivilegeLevel})`);
                        throw new McpError(
                            ErrorCode.InvalidRequest,
                            `Access denied: Tool '${toolName}' requires '${toolPrivilegeLevel}' privilege. ` +
                            `Your role '${userContext.role}' does not have sufficient permissions.`
                        );
                    }
                }

                try {
                    if (typeof tool.execute !== 'function') {
                        throw new Error(`Tool ${toolName} does not have an execute method.`);
                    }

                    // Validate and parse arguments using Zod schema
                    const parsedArgs = (tool.inputSchema as z.ZodTypeAny).parse(
                        request.params.arguments
                    ) as Record<string, unknown>;

                    // Create the context object using the imported type
                    const context: ToolContext = {
                        selfhostedClient,
                        workspacePath: options.workspacePath as string,
                        user: userContext, // Pass user context for audit logging
                        log: (message, level = 'info') => {
                            // Simple logger using console.error (consistent with existing logs)
                            console.error(`[${level.toUpperCase()}] ${message}`);
                        }
                    };

                    // Call the tool's execute method with validated arguments
                    const result = await tool.execute(parsedArgs, context);

                    return {
                        content: [
                            {
                                type: 'text',
                                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
                            },
                        ],
                    };
                } catch (error: unknown) {
                     console.error(`Error executing tool ${toolName}:`, error);
                     let errorMessage = `Error executing tool ${toolName}: `;
                     if (error instanceof z.ZodError) {
                         errorMessage += `Input validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
                     } else if (error instanceof Error) {
                         errorMessage += error.message;
                     } else {
                         errorMessage += String(error);
                     }
                     return {
                        content: [{ type: 'text', text: errorMessage }],
                        isError: true,
                     };
                }
            });

            return server;
        };

        // Start the appropriate transport
        if (transport === 'http') {
            console.error('Starting MCP Server in HTTP mode...');

            // Parse CORS origins if provided
            const corsOrigins = options.corsOrigins
                ? (options.corsOrigins as string).split(',').map(o => o.trim()).filter(o => o.length > 0)
                : undefined;

            const httpServer = new HttpMcpServer(
                {
                    port: parseInt(options.port as string, 10),
                    host: options.host as string,
                    jwtSecret: options.jwtSecret as string,
                    corsOrigins,
                    rateLimitWindowMs: parseInt(options.rateLimitWindow as string, 10),
                    rateLimitMaxRequests: parseInt(options.rateLimitMax as string, 10),
                    requestTimeoutMs: parseInt(options.requestTimeout as string, 10),
                },
                createMcpServer
            );

            await httpServer.start();

            // Handle graceful shutdown
            // Use void to properly handle async handlers in process.on callbacks
            process.on('SIGINT', () => {
                void (async () => {
                    console.error('Shutting down...');
                    await httpServer.stop();
                    process.exit(0);
                })();
            });

            process.on('SIGTERM', () => {
                void (async () => {
                    console.error('Shutting down...');
                    await httpServer.stop();
                    process.exit(0);
                })();
            });
        } else {
            // WARNING: Stdio mode has NO authentication - all tools accessible
            console.error('Starting MCP Server in stdio mode...');
            console.error('');
            console.error('================================================================================');
            console.error('WARNING: Stdio mode has NO authentication. All tools (including privileged');
            console.error('         tools) are accessible. Only use stdio mode with trusted local clients.');
            console.error('         For remote access, use HTTP mode with JWT authentication.');
            console.error('================================================================================');
            console.error('');
            const server = createMcpServer();
            const stdioTransport = new StdioServerTransport();
            await server.connect(stdioTransport);
            console.error('MCP Server connected to stdio.');
        }

    } catch (error) {
        console.error('Failed to initialize or start the MCP server:', error);
        throw error; // Rethrow to ensure the process exits non-zero if init fails
    }
}

main().catch((error) => {
    console.error('Unhandled error in main function:', error);
    process.exit(1); // Exit with error code
});