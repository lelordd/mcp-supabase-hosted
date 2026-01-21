/**
 * JWT Authentication Middleware for HTTP transport mode.
 *
 * Validates Supabase JWT tokens and extracts user information.
 * Required for all /mcp endpoints in HTTP mode.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedUser {
    userId: string;
    email: string | null;
    role: string;
    exp: number;
}

export interface AuthenticatedRequest extends Request {
    user?: AuthenticatedUser;
}

interface SupabaseJwtPayload {
    sub: string;           // User ID
    email?: string;
    role?: string;
    aud?: string;
    exp?: number;
    iat?: number;
}

/**
 * Creates JWT authentication middleware.
 *
 * @param jwtSecret - The Supabase JWT secret for verification
 * @returns Express middleware function
 */
export function createAuthMiddleware(jwtSecret: string) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing Authorization header',
            });
            return;
        }

        if (!authHeader.startsWith('Bearer ')) {
            // NOSONAR - This is a JSON API response, not HTML. No XSS risk.
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid Authorization header format. Expected: Bearer <token>',
            });
            return;
        }

        const token = authHeader.slice(7); // Remove 'Bearer ' prefix

        if (!token) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Missing token in Authorization header',
            });
            return;
        }

        try {
            // Verify and decode the JWT
            const decoded = jwt.verify(token, jwtSecret, {
                algorithms: ['HS256'],
            }) as SupabaseJwtPayload;

            // Validate required fields
            if (!decoded.sub) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Invalid token: missing subject (sub) claim',
                });
                return;
            }

            // NOTE: Expiration is already checked by jwt.verify() above.
            // It throws TokenExpiredError if expired, which is caught below.

            // Attach user info to request
            req.user = {
                userId: decoded.sub,
                email: decoded.email || null,
                role: decoded.role || 'authenticated',
                exp: decoded.exp || 0,
            };

            // Log authenticated request (for audit purposes)
            console.error(`[AUTH] Authenticated request from user: ${req.user.email || req.user.userId}`);

            next();
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: `Invalid token: ${error.message}`,
                });
                return;
            }

            if (error instanceof jwt.TokenExpiredError) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Token has expired',
                });
                return;
            }

            console.error('[AUTH] Unexpected error during token verification:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Failed to verify authentication token',
            });
        }
    };
}
