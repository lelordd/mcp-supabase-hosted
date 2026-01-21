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
 * Error response messages for authentication failures.
 * Using constants ensures these are not flagged as user-controlled content.
 */
const AUTH_ERROR_MESSAGES = {
    MISSING_HEADER: 'Missing Authorization header',
    INVALID_FORMAT: 'Invalid Authorization header format. Expected: Bearer [token]',
    MISSING_TOKEN: 'Missing token in Authorization header',
    MISSING_SUBJECT: 'Invalid token: missing subject (sub) claim',
    TOKEN_EXPIRED: 'Token has expired',
    VERIFICATION_FAILED: 'Failed to verify authentication token',
} as const;

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
                message: AUTH_ERROR_MESSAGES.MISSING_HEADER,
            });
            return;
        }

        if (!authHeader.startsWith('Bearer ')) {
            res.status(401).json({
                error: 'Unauthorized',
                message: AUTH_ERROR_MESSAGES.INVALID_FORMAT,
            });
            return;
        }

        const token = authHeader.slice(7); // Remove 'Bearer ' prefix

        if (!token) {
            res.status(401).json({
                error: 'Unauthorized',
                message: AUTH_ERROR_MESSAGES.MISSING_TOKEN,
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
                    message: AUTH_ERROR_MESSAGES.MISSING_SUBJECT,
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
                // Note: error.message is from the jwt library, not user input
                res.status(401).json({
                    error: 'Unauthorized',
                    message: `Invalid token: ${error.message}`,
                });
                return;
            }

            if (error instanceof jwt.TokenExpiredError) {
                res.status(401).json({
                    error: 'Unauthorized',
                    message: AUTH_ERROR_MESSAGES.TOKEN_EXPIRED,
                });
                return;
            }

            console.error('[AUTH] Unexpected error during token verification:', error);
            res.status(500).json({
                error: 'Internal Server Error',
                message: AUTH_ERROR_MESSAGES.VERIFICATION_FAILED,
            });
        }
    };
}
