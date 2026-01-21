/**
 * HTTP Server for MCP using Streamable HTTP Transport.
 *
 * Implements the official MCP Streamable HTTP specification (2025-03-26).
 * Runs in stateless mode: each request creates a new transport instance.
 *
 * Security features:
 * - Configurable CORS (default: localhost only)
 * - Rate limiting
 * - Security headers
 * - Request timeouts
 * - Privilege-based tool access control
 */

import express, { type Express, type Request, type Response } from 'express';
import type { Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createAuthMiddleware, type AuthenticatedRequest } from './auth-middleware.js';
import type { UserContext } from '../tools/types.js';

export interface HttpMcpServerOptions {
    port: number;
    host: string;
    jwtSecret: string;
    corsOrigins?: string[];
    rateLimitWindowMs?: number;
    rateLimitMaxRequests?: number;
    requestTimeoutMs?: number;
}

/**
 * Factory function type that creates MCP servers with optional user context.
 * User context is provided for privilege-level enforcement in HTTP mode.
 */
export type McpServerFactory = (userContext?: UserContext) => Server;

export class HttpMcpServer {
    private app: Express;
    private httpServer: HttpServer | null = null;
    private readonly options: HttpMcpServerOptions;
    private readonly mcpServerFactory: McpServerFactory;
    private requestCounts: Map<string, { count: number; resetTime: number }> = new Map();
    private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
    private readonly CLEANUP_INTERVAL_MS = 60000; // Clean up expired entries every minute

    constructor(options: HttpMcpServerOptions, mcpServerFactory: McpServerFactory) {
        this.options = options;
        this.mcpServerFactory = mcpServerFactory;
        this.app = express();

        this.setupMiddleware();
        this.setupRoutes();

        // Start periodic cleanup of expired rate limit entries to prevent memory leak
        this.cleanupIntervalId = setInterval(
            () => this.cleanupExpiredRateLimitEntries(),
            this.CLEANUP_INTERVAL_MS
        );
    }

    /**
     * Cleans up expired rate limit entries to prevent unbounded memory growth.
     * Called periodically by the cleanup interval.
     */
    private cleanupExpiredRateLimitEntries(): void {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [key, record] of this.requestCounts.entries()) {
            if (now >= record.resetTime) {
                this.requestCounts.delete(key);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.error(`[HTTP] Rate limiter cleanup: removed ${cleanedCount} expired entries`);
        }
    }

    /**
     * Simple in-memory rate limiter.
     * Returns rate limit status and info for response headers.
     */
    private checkRateLimit(clientKey: string): {
        allowed: boolean;
        remaining: number;
        resetTime: number;
        limit: number;
    } {
        const windowMs = this.options.rateLimitWindowMs ?? 60000; // 1 minute default
        const maxRequests = this.options.rateLimitMaxRequests ?? 100; // 100 requests default
        const now = Date.now();

        let record = this.requestCounts.get(clientKey);

        if (!record || now >= record.resetTime) {
            // Start new window
            record = { count: 1, resetTime: now + windowMs };
            this.requestCounts.set(clientKey, record);
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetTime: record.resetTime,
                limit: maxRequests,
            };
        }

        if (record.count >= maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetTime: record.resetTime,
                limit: maxRequests,
            };
        }

        record.count++;
        return {
            allowed: true,
            remaining: maxRequests - record.count,
            resetTime: record.resetTime,
            limit: maxRequests,
        };
    }

    /**
     * Get client identifier for rate limiting (IP address).
     */
    private getClientKey(req: Request): string {
        // Support for proxies (X-Forwarded-For)
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded === 'string') {
            return forwarded.split(',')[0].trim();
        }
        return req.ip || req.socket.remoteAddress || 'unknown';
    }

    /**
     * Check if origin is allowed by CORS configuration.
     */
    private isOriginAllowed(origin: string | undefined): boolean {
        // No origin header = same-origin or non-browser request (allow)
        if (!origin) {
            return true;
        }

        const allowedOrigins = this.options.corsOrigins ?? [
            `http://localhost:${this.options.port}`,
            `http://127.0.0.1:${this.options.port}`,
            `http://${this.options.host}:${this.options.port}`,
        ];

        // Check for explicit wildcard
        if (allowedOrigins.includes('*')) {
            return true;
        }

        // Check exact match
        if (allowedOrigins.includes(origin)) {
            return true;
        }

        // Check wildcard patterns (e.g., http://localhost:*)
        for (const allowed of allowedOrigins) {
            if (allowed.endsWith(':*')) {
                const baseUrl = allowed.slice(0, -2); // Remove ':*'
                if (origin.startsWith(baseUrl + ':')) {
                    return true;
                }
            }
        }

        return false;
    }

    private setupMiddleware(): void {
        // Security headers (first - before other middleware)
        this.app.use((_req, res, next) => {
            // Prevent XSS and clickjacking
            res.header('X-Content-Type-Options', 'nosniff');
            res.header('X-Frame-Options', 'DENY');
            res.header('X-XSS-Protection', '1; mode=block');

            // HTTPS enforcement hint (useful when behind proxy)
            res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

            // CSP for API responses
            res.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

            // Referrer policy
            res.header('Referrer-Policy', 'no-referrer');

            // Remove X-Powered-By
            res.removeHeader('X-Powered-By');

            next();
        });

        // Parse JSON bodies
        this.app.use(express.json());

        // Request timeout
        const timeoutMs = this.options.requestTimeoutMs ?? 30000;
        this.app.use((req, res, next) => {
            res.setTimeout(timeoutMs, () => {
                if (!res.headersSent) {
                    res.status(504).json({
                        error: 'Gateway Timeout',
                        message: `Request timed out after ${timeoutMs}ms`,
                    });
                }
            });
            next();
        });

        // Rate limiting (skip for health endpoint)
        this.app.use((req, res, next) => {
            // Skip rate limiting for health checks
            if (req.path === '/health') {
                next();
                return;
            }

            const clientKey = this.getClientKey(req);
            const { allowed, remaining, resetTime, limit } = this.checkRateLimit(clientKey);

            // Always add rate limit headers (standard practice)
            res.header('X-RateLimit-Limit', String(limit));
            res.header('X-RateLimit-Remaining', String(remaining));
            res.header('X-RateLimit-Reset', String(Math.ceil(resetTime / 1000)));

            if (!allowed) {
                const retryAfterSeconds = Math.max(1, Math.ceil((resetTime - Date.now()) / 1000));
                res.header('Retry-After', String(retryAfterSeconds));
                res.status(429).json({
                    error: 'Too Many Requests',
                    message: 'Rate limit exceeded. Please try again later.',
                    retryAfter: retryAfterSeconds,
                });
                return;
            }

            next();
        });

        // CORS with configurable origins (default: localhost only)
        this.app.use((req, res, next) => {
            const origin = req.headers.origin;

            if (!this.isOriginAllowed(origin)) {
                if (req.method === 'OPTIONS') {
                    res.sendStatus(403);
                    return;
                }
                res.status(403).json({
                    error: 'Forbidden',
                    message: 'Origin not allowed by CORS policy',
                });
                return;
            }

            // Set CORS headers
            // SECURITY: Only set origin if it was validated above by isOriginAllowed()
            // This prevents arbitrary user input from being reflected in the header
            if (origin && this.isOriginAllowed(origin)) {
                res.header('Access-Control-Allow-Origin', origin);
            } else if (!origin) {
                // For same-origin requests (no Origin header)
                res.header('Access-Control-Allow-Origin', '*');
            }

            res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id');
            res.header('Access-Control-Expose-Headers', 'Mcp-Session-Id');
            res.header('Access-Control-Allow-Credentials', 'true');

            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }

            next();
        });
    }

    private setupRoutes(): void {
        // Health check endpoint (no auth required, minimal info)
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'healthy' });
        });

        // Apply JWT authentication to /mcp routes
        const authMiddleware = createAuthMiddleware(this.options.jwtSecret);
        this.app.use('/mcp', authMiddleware);

        // POST /mcp - Handle MCP JSON-RPC requests (stateless mode)
        this.app.post('/mcp', (req: AuthenticatedRequest, res: Response) => {
            void (async () => {
                try {
                // Create a new transport and server for each request (stateless)
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined, // Stateless mode
                });

                // Extract user context for privilege-level enforcement
                const userContext: UserContext | undefined = req.user
                    ? {
                          userId: req.user.userId,
                          email: req.user.email,
                          role: req.user.role,
                      }
                    : undefined;

                const server = this.mcpServerFactory(userContext);

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
            })();
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
                // Set server-level timeouts
                if (this.httpServer) {
                    this.httpServer.timeout = this.options.requestTimeoutMs ?? 30000;
                    this.httpServer.keepAliveTimeout = 65000; // Slightly higher than common load balancer timeouts
                }

                console.error(`[HTTP] MCP Server listening on http://${this.options.host}:${this.options.port}`);
                console.error('[HTTP] Endpoints:');
                console.error(`       POST   http://${this.options.host}:${this.options.port}/mcp     - MCP requests (JWT required)`);
                console.error(`       GET    http://${this.options.host}:${this.options.port}/health  - Health check`);
                console.error('[HTTP] Security:');
                console.error(`       CORS origins: ${(this.options.corsOrigins ?? ['localhost']).join(', ')}`);
                console.error(`       Rate limit: ${this.options.rateLimitMaxRequests ?? 100} requests per ${(this.options.rateLimitWindowMs ?? 60000) / 1000}s`);
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        // Clear rate limit cleanup interval to prevent memory leak
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }

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
