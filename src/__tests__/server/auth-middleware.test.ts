/**
 * Tests for JWT Authentication Middleware
 *
 * These tests verify the JWT authentication middleware for HTTP transport mode:
 * - Missing/invalid authorization headers
 * - Token validation (signature, expiration, claims)
 * - User info extraction
 * - Error responses
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import jwt from 'jsonwebtoken';
import { createAuthMiddleware, type AuthenticatedRequest } from '../../server/auth-middleware.js';
import type { Response, NextFunction } from 'express';

describe('createAuthMiddleware', () => {
    // codacy:disable-line:hardcoded-credentials -- Test fixture, not a real secret
    // nosec: hardcoded test credential for unit testing only
    const JWT_SECRET = 'test-jwt-secret-key-for-testing'; // NOSONAR
    const middleware = createAuthMiddleware(JWT_SECRET);

    // Helper to create mock request/response/next
    function createMocks() {
        const req = {
            headers: {} as Record<string, string>,
            user: undefined,
        } as AuthenticatedRequest;

        const res = {
            statusCode: 200,
            body: null as unknown,
            status: mock(function (this: typeof res, code: number) {
                this.statusCode = code;
                return this;
            }),
            json: mock(function (this: typeof res, body: unknown) {
                this.body = body;
                return this;
            }),
        } as unknown as Response;

        const next = mock(() => {}) as NextFunction;

        return { req, res, next };
    }

    // Helper to create valid JWT tokens
    function createToken(payload: Record<string, unknown>, options?: jwt.SignOptions) {
        return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', ...options });
    }

    describe('Authorization header validation', () => {
        test('returns 401 when Authorization header is missing', () => {
            const { req, res, next } = createMocks();

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unauthorized',
                message: 'Missing Authorization header',
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('returns 401 when Authorization header does not start with Bearer', () => {
            const { req, res, next } = createMocks();
            req.headers.authorization = 'Basic dXNlcjpwYXNz';

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unauthorized',
                message: 'Invalid Authorization header format. Expected: Bearer [token]',
            });
            expect(next).not.toHaveBeenCalled();
        });

        test('returns 401 when token is empty after Bearer prefix', () => {
            const { req, res, next } = createMocks();
            req.headers.authorization = 'Bearer ';

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Unauthorized',
                message: 'Missing token in Authorization header',
            });
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Token signature validation', () => {
        test('returns 401 for token with invalid signature', () => {
            const { req, res, next } = createMocks();
            // Create token with wrong secret
            // codacy:disable-line:hardcoded-credentials -- Test fixture for signature mismatch
            const invalidToken = jwt.sign({ sub: 'user-123' }, 'wrong-secret', { // NOSONAR
                algorithm: 'HS256',
            });
            req.headers.authorization = `Bearer ${invalidToken}`;

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect((res as { body: { error: string } }).body.error).toBe('Unauthorized');
            expect((res as { body: { message: string } }).body.message).toContain('Invalid token');
            expect(next).not.toHaveBeenCalled();
        });

        test('returns 401 for malformed token', () => {
            const { req, res, next } = createMocks();
            req.headers.authorization = 'Bearer not.a.valid.jwt.token';

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect((res as { body: { error: string } }).body.error).toBe('Unauthorized');
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Token expiration validation', () => {
        test('returns 401 for expired token', () => {
            const { req, res, next } = createMocks();
            // Create token that expired 1 hour ago
            const expiredToken = createToken(
                { sub: 'user-123' },
                { expiresIn: '-1h' }
            );
            req.headers.authorization = `Bearer ${expiredToken}`;

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect((res as { body: { message: string } }).body.message).toContain('expired');
            expect(next).not.toHaveBeenCalled();
        });

        test('accepts token that has not expired', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken(
                { sub: 'user-123' },
                { expiresIn: '1h' }
            );
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });
    });

    describe('Token claims validation', () => {
        test('returns 401 when sub claim is missing', () => {
            const { req, res, next } = createMocks();
            // Create token without sub claim
            const tokenWithoutSub = createToken({ email: 'test@example.com' });
            req.headers.authorization = `Bearer ${tokenWithoutSub}`;

            middleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect((res as { body: { message: string } }).body.message).toContain('missing subject');
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('Successful authentication', () => {
        test('calls next() for valid token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken({ sub: 'user-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.json).not.toHaveBeenCalled();
        });

        test('sets req.user with userId from sub claim', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken({ sub: 'user-abc-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user).toBeDefined();
            expect(req.user?.userId).toBe('user-abc-123');
        });

        test('sets req.user.email from token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken(
                { sub: 'user-123', email: 'test@example.com' },
                { expiresIn: '1h' }
            );
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user?.email).toBe('test@example.com');
        });

        test('sets req.user.email to null when not in token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken({ sub: 'user-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user?.email).toBeNull();
        });

        test('sets req.user.role from token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken(
                { sub: 'user-123', role: 'admin' },
                { expiresIn: '1h' }
            );
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user?.role).toBe('admin');
        });

        test('defaults req.user.role to authenticated when not in token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken({ sub: 'user-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user?.role).toBe('authenticated');
        });

        test('sets req.user.exp from token', () => {
            const { req, res, next } = createMocks();
            const validToken = createToken({ sub: 'user-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${validToken}`;

            middleware(req, res, next);

            expect(req.user?.exp).toBeGreaterThan(0);
            // Should expire in about 1 hour
            const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
            expect(req.user?.exp).toBeGreaterThan(oneHourFromNow - 60); // Allow 60s tolerance
            expect(req.user?.exp).toBeLessThan(oneHourFromNow + 60);
        });

        test('extracts all fields from complete Supabase-style token', () => {
            const { req, res, next } = createMocks();
            const supabaseToken = createToken(
                {
                    sub: 'uuid-user-id',
                    email: 'user@example.com',
                    role: 'authenticated',
                    aud: 'authenticated',
                    iat: Math.floor(Date.now() / 1000),
                },
                { expiresIn: '1h' }
            );
            req.headers.authorization = `Bearer ${supabaseToken}`;

            middleware(req, res, next);

            expect(req.user).toEqual({
                userId: 'uuid-user-id',
                email: 'user@example.com',
                role: 'authenticated',
                exp: expect.any(Number),
            });
        });
    });

    describe('Different JWT secrets', () => {
        test('middleware with different secret rejects tokens from another secret', () => {
            const anotherMiddleware = createAuthMiddleware('different-secret');
            const { req, res, next } = createMocks();
            const token = createToken({ sub: 'user-123' }, { expiresIn: '1h' });
            req.headers.authorization = `Bearer ${token}`;

            anotherMiddleware(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(next).not.toHaveBeenCalled();
        });
    });
});
