/**
 * HTTP Server for MCP using Streamable HTTP Transport.
 *
 * Implements the official MCP Streamable HTTP specification (2025-03-26).
 * Runs in stateless mode: each request creates a new transport instance.
 */

import express, { type Express, type Request, type Response } from 'express';
import type { Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAuthMiddleware, type AuthenticatedRequest } from './auth-middleware.js';

export interface HttpMcpServerOptions {
    port: number;
    host: string;
    jwtSecret: string;
}

export class HttpMcpServer {
    private app: Express;
    private httpServer: HttpServer | null = null;
    private readonly options: HttpMcpServerOptions;
    private readonly mcpServerFactory: () => Server;

    constructor(options: HttpMcpServerOptions, mcpServerFactory: () => Server) {
        this.options = options;
        this.mcpServerFactory = mcpServerFactory;
        this.app = express();

        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware(): void {
        // Parse JSON bodies
        this.app.use(express.json());

        // CORS headers for cross-origin requests
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
            res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');

            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }

            next();
        });
    }

    private setupRoutes(): void {
        // Health check endpoint (no auth required)
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'healthy', transport: 'streamable-http' });
        });

        // Apply JWT authentication to /mcp routes
        const authMiddleware = createAuthMiddleware(this.options.jwtSecret);
        this.app.use('/mcp', authMiddleware);

        // POST /mcp - Handle MCP JSON-RPC requests (stateless mode)
        this.app.post('/mcp', async (req: AuthenticatedRequest, res: Response) => {
            try {
                // Create a new transport and server for each request (stateless)
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined, // Stateless mode
                });

                const server = this.mcpServerFactory();

                // Connect server to transport
                await server.connect(transport);

                // Handle the request
                await transport.handleRequest(req, res, req.body);

                // Clean up after request completes
                res.on('finish', () => {
                    transport.close().catch((err) => {
                        console.error('[HTTP] Error closing transport:', err);
                    });
                    server.close().catch((err) => {
                        console.error('[HTTP] Error closing server:', err);
                    });
                });
            } catch (error) {
                console.error('[HTTP] Error handling MCP request:', error);

                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: 'Internal server error',
                        },
                        id: null,
                    });
                }
            }
        });

        // GET /mcp - SSE stream for server-initiated messages
        // In stateless mode, we return 405 Method Not Allowed
        this.app.get('/mcp', (_req: Request, res: Response) => {
            res.status(405).json({
                error: 'Method Not Allowed',
                message: 'GET requests are not supported in stateless mode. Use POST for MCP requests.',
            });
        });

        // DELETE /mcp - Session termination
        // In stateless mode, we return 405 Method Not Allowed
        this.app.delete('/mcp', (_req: Request, res: Response) => {
            res.status(405).json({
                error: 'Method Not Allowed',
                message: 'Session termination is not supported in stateless mode.',
            });
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.httpServer = this.app.listen(this.options.port, this.options.host, () => {
                console.error(`[HTTP] MCP Server listening on http://${this.options.host}:${this.options.port}`);
                console.error('[HTTP] Endpoints:');
                console.error(`       POST   http://${this.options.host}:${this.options.port}/mcp     - MCP requests (JWT required)`);
                console.error(`       GET    http://${this.options.host}:${this.options.port}/health  - Health check`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.httpServer) {
                resolve();
                return;
            }

            this.httpServer.close((err) => {
                if (err) {
                    reject(err);
                } else {
                    console.error('[HTTP] Server stopped.');
                    resolve();
                }
            });
        });
    }
}
