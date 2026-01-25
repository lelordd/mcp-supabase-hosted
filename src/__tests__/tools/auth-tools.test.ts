/**
 * Tests for authentication-related tools
 *
 * Tools tested:
 * - list_auth_users
 * - get_auth_user
 * - create_auth_user
 * - update_auth_user
 * - delete_auth_user
 */

import { describe, test, expect, mock } from 'bun:test';
import { listAuthUsersTool } from '../../tools/list_auth_users.js';
import { createAuthUserTool } from '../../tools/create_auth_user.js';
import { deleteAuthUserTool } from '../../tools/delete_auth_user.js';
import { updateAuthUserTool } from '../../tools/update_auth_user.js';
import {
    createMockClient,
    createMockContext,
    createSuccessResponse,
    createErrorResponse,
    testData,
} from '../helpers/mocks.js';

describe('listAuthUsersTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(listAuthUsersTool.name).toBe('list_auth_users');
        });

        test('has description', () => {
            expect(listAuthUsersTool.description).toContain('user');
        });

        test('has input and output schemas', () => {
            expect(listAuthUsersTool.inputSchema).toBeDefined();
            expect(listAuthUsersTool.outputSchema).toBeDefined();
        });
    });

    describe('input validation', () => {
        test('accepts empty input with defaults', () => {
            const result = listAuthUsersTool.inputSchema.safeParse({});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.limit).toBe(50);
                expect(result.data.offset).toBe(0);
            }
        });

        test('accepts custom limit and offset', () => {
            const result = listAuthUsersTool.inputSchema.safeParse({ limit: 10, offset: 20 });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.limit).toBe(10);
                expect(result.data.offset).toBe(20);
            }
        });

        test('rejects negative limit', () => {
            const result = listAuthUsersTool.inputSchema.safeParse({ limit: -1 });
            expect(result.success).toBe(false);
        });

        test('rejects negative offset', () => {
            const result = listAuthUsersTool.inputSchema.safeParse({ offset: -1 });
            expect(result.success).toBe(false);
        });
    });

    describe('execute', () => {
        test('returns list of users', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(testData.users),
            });
            const context = createMockContext(mockClient);

            const result = await listAuthUsersTool.execute({}, context);

            expect(result).toEqual(testData.users);
        });

        test('returns empty array when no users', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await listAuthUsersTool.execute({}, context);

            expect(result).toEqual([]);
        });

        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(listAuthUsersTool.execute({}, context)).rejects.toThrow(
                'Direct database connection'
            );
        });

        test('throws error on SQL failure', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('permission denied for table users', '42501'),
            });
            const context = createMockContext(mockClient);

            await expect(listAuthUsersTool.execute({}, context)).rejects.toThrow('SQL Error');
        });

        test('uses pg connection directly (not RPC)', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            await listAuthUsersTool.execute({}, context);

            expect(mockClient.executeSqlWithPg).toHaveBeenCalled();
            expect(mockClient.executeSqlViaRpc).not.toHaveBeenCalled();
        });
    });

    describe('output validation', () => {
        test('validates correct user structure', () => {
            const result = listAuthUsersTool.outputSchema.safeParse(testData.users);
            expect(result.success).toBe(true);
        });

        test('rejects invalid UUID for id', () => {
            const invalidUser = [{ ...testData.users[0], id: 'not-a-uuid' }];
            const result = listAuthUsersTool.outputSchema.safeParse(invalidUser);
            expect(result.success).toBe(false);
        });

        test('accepts null values for nullable fields', () => {
            const userWithNulls = [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                email: null,
                role: null,
                created_at: null,
                last_sign_in_at: null,
                raw_app_meta_data: null,
                raw_user_meta_data: null,
            }];
            const result = listAuthUsersTool.outputSchema.safeParse(userWithNulls);
            expect(result.success).toBe(true);
        });
    });
});

describe('createAuthUserTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(createAuthUserTool.name).toBe('create_auth_user');
        });

        test('has warning in description', () => {
            expect(createAuthUserTool.description).toContain('WARNING');
        });
    });

    describe('input validation', () => {
        test('requires email', () => {
            const result = createAuthUserTool.inputSchema.safeParse({ password: 'password123' });
            expect(result.success).toBe(false);
        });

        test('requires password', () => {
            const result = createAuthUserTool.inputSchema.safeParse({ email: 'test@example.com' });
            expect(result.success).toBe(false);
        });

        test('validates email format', () => {
            const result = createAuthUserTool.inputSchema.safeParse({
                email: 'not-an-email',
                password: 'password123',
            });
            expect(result.success).toBe(false);
        });

        test('requires minimum password length', () => {
            const result = createAuthUserTool.inputSchema.safeParse({
                email: 'test@example.com',
                password: '12345', // 5 chars, needs 6
            });
            expect(result.success).toBe(false);
        });

        test('accepts valid input', () => {
            const result = createAuthUserTool.inputSchema.safeParse({
                email: 'test@example.com',
                password: 'password123',
            });
            expect(result.success).toBe(true);
        });

        test('accepts optional role and metadata', () => {
            const result = createAuthUserTool.inputSchema.safeParse({
                email: 'test@example.com',
                password: 'password123',
                role: 'admin',
                app_metadata: { custom: 'data' },
                user_metadata: { name: 'Test User' },
            });
            expect(result.success).toBe(true);
        });
    });

    describe('execute', () => {
        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(
                createAuthUserTool.execute(
                    { email: 'test@example.com', password: 'password123' },
                    context
                )
            ).rejects.toThrow('Direct database connection');
        });

        test('creates user via transaction', async () => {
            const createdUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                email: 'test@example.com',
                role: 'authenticated',
                created_at: '2024-01-01T00:00:00Z',
                last_sign_in_at: null,
                raw_app_meta_data: {},
                raw_user_meta_data: {},
            };

            const mockPgClient = {
                query: mock(async (sql: string, _params?: unknown[]) => {
                    // The crypt test SELECT query doesn't have INSERT
                    if (sql.includes('crypt') && sql.includes('SELECT') && !sql.includes('INSERT')) {
                        return { rows: [{ crypt: 'test' }] };
                    }
                    // The INSERT query that creates the user
                    return { rows: [createdUser] };
                }),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            const result = await createAuthUserTool.execute(
                { email: 'test@example.com', password: 'password123' },
                context
            );

            expect(result).toEqual(createdUser);
        });

        test('throws error when pgcrypto is not available', async () => {
            const mockPgClient = {
                query: mock(async (sql: string) => {
                    if (sql.includes('crypt')) {
                        throw new Error('function crypt does not exist');
                    }
                    return { rows: [] };
                }),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            await expect(
                createAuthUserTool.execute(
                    { email: 'test@example.com', password: 'password123' },
                    context
                )
            ).rejects.toThrow('pgcrypto');
        });

        test('handles unique violation error for duplicate email', async () => {
            const mockPgClient = {
                query: mock(async (sql: string) => {
                    if (sql.includes('crypt') && !sql.includes('INSERT')) {
                        return { rows: [{ crypt: 'test' }] };
                    }
                    const error = new Error('duplicate key value violates unique constraint');
                    (error as unknown as { code: string }).code = '23505';
                    throw error;
                }),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            await expect(
                createAuthUserTool.execute(
                    { email: 'test@example.com', password: 'password123' },
                    context
                )
            ).rejects.toThrow('already exists');
        });
    });
});

describe('deleteAuthUserTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(deleteAuthUserTool.name).toBe('delete_auth_user');
        });

        test('has description', () => {
            expect(deleteAuthUserTool.description).toContain('Delete');
        });
    });

    describe('input validation', () => {
        test('requires user_id', () => {
            const result = deleteAuthUserTool.inputSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        test('validates user_id is UUID', () => {
            const result = deleteAuthUserTool.inputSchema.safeParse({ user_id: 'not-a-uuid' });
            expect(result.success).toBe(false);
        });

        test('accepts valid UUID', () => {
            const result = deleteAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
            });
            expect(result.success).toBe(true);
        });
    });

    describe('execute', () => {
        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(
                deleteAuthUserTool.execute(
                    { user_id: '123e4567-e89b-12d3-a456-426614174000' },
                    context
                )
            ).rejects.toThrow('Direct database connection');
        });

        test('returns success when user is deleted', async () => {
            const mockPgClient = {
                query: mock(async () => ({ rowCount: 1 })),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            const result = await deleteAuthUserTool.execute(
                { user_id: '123e4567-e89b-12d3-a456-426614174000' },
                context
            );

            expect(result.success).toBe(true);
            expect(result.message).toContain('Successfully deleted');
        });

        test('returns failure when user is not found', async () => {
            const mockPgClient = {
                query: mock(async () => ({ rowCount: 0 })),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            const result = await deleteAuthUserTool.execute(
                { user_id: '123e4567-e89b-12d3-a456-426614174000' },
                context
            );

            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        });

        test('throws error on database failure', async () => {
            const mockPgClient = {
                query: mock(async () => {
                    throw new Error('Database error');
                }),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            await expect(
                deleteAuthUserTool.execute(
                    { user_id: '123e4567-e89b-12d3-a456-426614174000' },
                    context
                )
            ).rejects.toThrow('Failed to delete user');
        });
    });

    describe('output validation', () => {
        test('validates success response', () => {
            const result = deleteAuthUserTool.outputSchema.safeParse({
                success: true,
                message: 'User deleted',
            });
            expect(result.success).toBe(true);
        });

        test('validates failure response', () => {
            const result = deleteAuthUserTool.outputSchema.safeParse({
                success: false,
                message: 'User not found',
            });
            expect(result.success).toBe(true);
        });
    });
});

describe('updateAuthUserTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(updateAuthUserTool.name).toBe('update_auth_user');
        });

        test('has warning in description', () => {
            expect(updateAuthUserTool.description).toContain('WARNING');
        });
    });

    describe('input validation', () => {
        test('requires user_id', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({ email: 'new@example.com' });
            expect(result.success).toBe(false);
        });

        test('validates user_id is UUID', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: 'not-a-uuid',
                email: 'new@example.com',
            });
            expect(result.success).toBe(false);
        });

        test('requires at least one field to update', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
            });
            expect(result.success).toBe(false);
        });

        test('accepts email update', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                email: 'new@example.com',
            });
            expect(result.success).toBe(true);
        });

        test('accepts password update', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                password: 'newpassword123',
            });
            expect(result.success).toBe(true);
        });

        test('accepts role update', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                role: 'admin',
            });
            expect(result.success).toBe(true);
        });

        test('accepts metadata updates', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                user_metadata: { name: 'New Name' },
            });
            expect(result.success).toBe(true);
        });

        test('validates minimum password length', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                password: '12345',
            });
            expect(result.success).toBe(false);
        });

        test('validates email format', () => {
            const result = updateAuthUserTool.inputSchema.safeParse({
                user_id: '123e4567-e89b-12d3-a456-426614174000',
                email: 'not-an-email',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('execute', () => {
        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(
                updateAuthUserTool.execute(
                    {
                        user_id: '123e4567-e89b-12d3-a456-426614174000',
                        email: 'new@example.com',
                    },
                    context
                )
            ).rejects.toThrow('Direct database connection');
        });

        test('updates user via transaction', async () => {
            const updatedUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                email: 'new@example.com',
                role: 'authenticated',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-02T00:00:00Z',
                last_sign_in_at: null,
                raw_app_meta_data: {},
                raw_user_meta_data: {},
            };

            const mockPgClient = {
                query: mock(async () => ({ rows: [updatedUser] })),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            const result = await updateAuthUserTool.execute(
                {
                    user_id: '123e4567-e89b-12d3-a456-426614174000',
                    email: 'new@example.com',
                },
                context
            );

            expect(result).toEqual(updatedUser);
        });

        test('throws error when user is not found', async () => {
            const mockPgClient = {
                query: mock(async () => ({ rows: [] })),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            await expect(
                updateAuthUserTool.execute(
                    {
                        user_id: '123e4567-e89b-12d3-a456-426614174000',
                        email: 'new@example.com',
                    },
                    context
                )
            ).rejects.toThrow('not found');
        });

        test('checks pgcrypto when updating password', async () => {
            const mockPgClient = {
                query: mock(async (sql: string) => {
                    if (sql.includes('crypt') && sql.includes('SELECT')) {
                        throw new Error('function crypt does not exist');
                    }
                    return { rows: [] };
                }),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            await expect(
                updateAuthUserTool.execute(
                    {
                        user_id: '123e4567-e89b-12d3-a456-426614174000',
                        password: 'newpassword123',
                    },
                    context
                )
            ).rejects.toThrow('pgcrypto');
        });
    });
});
