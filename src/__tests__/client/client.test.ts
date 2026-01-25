/**
 * Tests for SelfhostedSupabaseClient
 *
 * These tests verify the core client functionality including:
 * - Client initialization and validation
 * - SQL execution via RPC
 * - SQL execution via direct pg connection
 * - Transaction handling
 * - Getter methods
 */

import { describe, test, expect, mock, beforeEach, spyOn } from 'bun:test';
import { SelfhostedSupabaseClient } from '../../client/index.js';
import type { SelfhostedSupabaseClientOptions } from '../../types/index.js';

// Mock the external dependencies
const mockSupabaseClient = {
    rpc: mock(() => Promise.resolve({ data: [], error: null })),
};

const mockCreateClient = mock(() => mockSupabaseClient);

// Mock @supabase/supabase-js
mock.module('@supabase/supabase-js', () => ({
    createClient: mockCreateClient,
}));

// Mock pg Pool
const mockPoolClient = {
    query: mock(() => Promise.resolve({ rows: [] })),
    release: mock(() => {}),
};

const mockPool = {
    connect: mock(() => Promise.resolve(mockPoolClient)),
    end: mock(() => Promise.resolve()),
    on: mock(() => {}),
};

const mockPoolConstructor = mock(() => mockPool);

mock.module('pg', () => ({
    Pool: mockPoolConstructor,
}));

describe('SelfhostedSupabaseClient', () => {
    const validOptions: SelfhostedSupabaseClientOptions = {
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'test-anon-key',
        supabaseServiceRoleKey: 'test-service-role-key',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/postgres',
        jwtSecret: 'test-jwt-secret',
    };

    beforeEach(() => {
        // Reset all mocks
        mockCreateClient.mockClear();
        mockSupabaseClient.rpc.mockClear();
        mockPool.connect.mockClear();
        mockPool.end.mockClear();
        mockPoolClient.query.mockClear();
        mockPoolClient.release.mockClear();

        // Reset to default successful behavior
        mockSupabaseClient.rpc.mockImplementation(() =>
            Promise.resolve({ data: [], error: null })
        );
        mockPoolClient.query.mockImplementation(() =>
            Promise.resolve({ rows: [] })
        );
    });

    describe('create() factory method', () => {
        test('creates client with valid options', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);

            expect(client).toBeDefined();
            expect(mockCreateClient).toHaveBeenCalledWith(
                validOptions.supabaseUrl,
                validOptions.supabaseAnonKey,
                undefined
            );
        });

        test('throws error when supabaseUrl is missing', async () => {
            const invalidOptions = {
                ...validOptions,
                supabaseUrl: '',
            };

            await expect(SelfhostedSupabaseClient.create(invalidOptions)).rejects.toThrow();
        });

        test('throws error when supabaseAnonKey is missing', async () => {
            const invalidOptions = {
                ...validOptions,
                supabaseAnonKey: '',
            };

            await expect(SelfhostedSupabaseClient.create(invalidOptions)).rejects.toThrow();
        });
    });

    describe('getters', () => {
        test('getSupabaseUrl returns configured URL', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.getSupabaseUrl()).toBe(validOptions.supabaseUrl);
        });

        test('getAnonKey returns configured anon key', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.getAnonKey()).toBe(validOptions.supabaseAnonKey);
        });

        test('getServiceRoleKey returns configured service role key', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.getServiceRoleKey()).toBe(validOptions.supabaseServiceRoleKey);
        });

        test('getServiceRoleKey returns undefined when not configured', async () => {
            const optionsWithoutServiceKey = {
                supabaseUrl: validOptions.supabaseUrl,
                supabaseAnonKey: validOptions.supabaseAnonKey,
            };
            const client = await SelfhostedSupabaseClient.create(optionsWithoutServiceKey);
            expect(client.getServiceRoleKey()).toBeUndefined();
        });

        test('getJwtSecret returns configured JWT secret', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.getJwtSecret()).toBe(validOptions.jwtSecret);
        });

        test('getDbUrl returns configured database URL', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.getDbUrl()).toBe(validOptions.databaseUrl);
        });

        test('isPgAvailable returns true when databaseUrl is configured', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.isPgAvailable()).toBe(true);
        });

        test('isPgAvailable returns false when databaseUrl is not configured', async () => {
            const optionsWithoutDb = {
                supabaseUrl: validOptions.supabaseUrl,
                supabaseAnonKey: validOptions.supabaseAnonKey,
            };
            const client = await SelfhostedSupabaseClient.create(optionsWithoutDb);
            expect(client.isPgAvailable()).toBe(false);
        });
    });

    describe('executeSqlViaRpc', () => {
        test('returns success response for valid query', async () => {
            const expectedData = [{ id: 1, name: 'test' }];
            mockSupabaseClient.rpc.mockImplementation(() =>
                Promise.resolve({ data: expectedData, error: null })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlViaRpc('SELECT * FROM users');

            expect(result).toEqual(expectedData);
            expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('execute_sql', {
                query: 'SELECT * FROM users',
                read_only: false,
            });
        });

        test('passes read_only parameter correctly', async () => {
            mockSupabaseClient.rpc.mockImplementation(() =>
                Promise.resolve({ data: [], error: null })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            await client.executeSqlViaRpc('SELECT 1', true);

            expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('execute_sql', {
                query: 'SELECT 1',
                read_only: true,
            });
        });

        test('returns error response when RPC fails', async () => {
            // First call succeeds (initialization check), second call fails
            let callCount = 0;
            mockSupabaseClient.rpc.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // Initialization check succeeds
                    return Promise.resolve({ data: [], error: null });
                }
                // Actual query fails
                return Promise.resolve({
                    data: null,
                    error: {
                        message: 'Query failed',
                        code: 'P0001',
                        details: 'Some details',
                        hint: 'Try something else',
                    },
                });
            });

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlViaRpc('INVALID SQL');

            expect(result).toHaveProperty('error');
            expect((result as { error: { message: string } }).error.message).toBe('Query failed');
            expect((result as { error: { code: string } }).error.code).toBe('P0001');
        });

        test('returns error when RPC function does not exist', async () => {
            // First call during initialization - function doesn't exist
            mockSupabaseClient.rpc.mockImplementation(() =>
                Promise.resolve({
                    data: null,
                    error: { message: 'Function not found', code: '42883' },
                })
            );

            const client = await SelfhostedSupabaseClient.create({
                ...validOptions,
                supabaseServiceRoleKey: undefined,
                databaseUrl: undefined,
            });

            const result = await client.executeSqlViaRpc('SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as { error: { message: string } }).error.message).toContain(
                'execute_sql RPC function not found'
            );
        });

        test('handles unexpected response format', async () => {
            // First call succeeds (initialization), second returns bad format
            let callCount = 0;
            mockSupabaseClient.rpc.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ data: [], error: null });
                }
                return Promise.resolve({ data: 'not an array', error: null });
            });

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlViaRpc('SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as { error: { code: string } }).error.code).toBe('MCP_RPC_FORMAT_ERROR');
        });

        test('handles RPC exceptions during query', async () => {
            // First call succeeds (initialization), second throws
            let callCount = 0;
            mockSupabaseClient.rpc.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({ data: [], error: null });
                }
                return Promise.reject(new Error('Network error'));
            });

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlViaRpc('SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as { error: { code: string } }).error.code).toBe('MCP_RPC_EXCEPTION');
            expect((result as { error: { message: string } }).error.message).toContain('Network error');
        });
    });

    describe('executeSqlWithPg', () => {
        test('returns success response for valid query', async () => {
            const expectedRows = [{ id: 1, name: 'test' }];
            mockPoolClient.query.mockImplementation(() =>
                Promise.resolve({ rows: expectedRows })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlWithPg('SELECT * FROM users');

            expect(result).toEqual(expectedRows);
        });

        test('returns error when databaseUrl is not configured', async () => {
            const optionsWithoutDb = {
                supabaseUrl: validOptions.supabaseUrl,
                supabaseAnonKey: validOptions.supabaseAnonKey,
            };

            const client = await SelfhostedSupabaseClient.create(optionsWithoutDb);
            const result = await client.executeSqlWithPg('SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as { error: { message: string } }).error.message).toContain(
                'DATABASE_URL is not configured'
            );
        });

        test('handles database errors', async () => {
            const dbError = new Error('Connection refused') as Error & { code: string };
            dbError.code = 'ECONNREFUSED';
            mockPoolClient.query.mockImplementation(() => Promise.reject(dbError));

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeSqlWithPg('SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as { error: { message: string } }).error.message).toContain(
                'Connection refused'
            );
            expect((result as { error: { code: string } }).error.code).toBe('ECONNREFUSED');
        });

        test('releases client after successful query', async () => {
            mockPoolClient.query.mockImplementation(() =>
                Promise.resolve({ rows: [] })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            await client.executeSqlWithPg('SELECT 1');

            expect(mockPoolClient.release).toHaveBeenCalled();
        });

        test('releases client after failed query', async () => {
            mockPoolClient.query.mockImplementation(() =>
                Promise.reject(new Error('Query failed'))
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            await client.executeSqlWithPg('SELECT 1');

            expect(mockPoolClient.release).toHaveBeenCalled();
        });
    });

    describe('executeTransactionWithPg', () => {
        test('commits transaction on success', async () => {
            const expectedResult = { success: true };
            mockPoolClient.query.mockImplementation(() =>
                Promise.resolve({ rows: [] })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            const result = await client.executeTransactionWithPg(async (pgClient) => {
                await pgClient.query('INSERT INTO users (name) VALUES ($1)', ['test']);
                return expectedResult;
            });

            expect(result).toEqual(expectedResult);
            // Check that BEGIN was called
            expect(mockPoolClient.query).toHaveBeenCalledWith('BEGIN');
            // Check that COMMIT was called
            expect(mockPoolClient.query).toHaveBeenCalledWith('COMMIT');
        });

        test('rolls back transaction on failure', async () => {
            let beginCalled = false;
            mockPoolClient.query.mockImplementation((query: string) => {
                if (query === 'BEGIN') {
                    beginCalled = true;
                    return Promise.resolve({ rows: [] });
                }
                if (query === 'ROLLBACK') {
                    return Promise.resolve({ rows: [] });
                }
                if (query === 'COMMIT') {
                    return Promise.resolve({ rows: [] });
                }
                // Fail on the actual operation
                return Promise.reject(new Error('Insert failed'));
            });

            const client = await SelfhostedSupabaseClient.create(validOptions);

            await expect(
                client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query('INSERT INTO users (name) VALUES ($1)', ['test']);
                })
            ).rejects.toThrow('Insert failed');

            expect(beginCalled).toBe(true);
            expect(mockPoolClient.query).toHaveBeenCalledWith('ROLLBACK');
        });

        test('throws error when databaseUrl is not configured', async () => {
            const optionsWithoutDb = {
                supabaseUrl: validOptions.supabaseUrl,
                supabaseAnonKey: validOptions.supabaseAnonKey,
            };

            const client = await SelfhostedSupabaseClient.create(optionsWithoutDb);

            await expect(
                client.executeTransactionWithPg(async () => {})
            ).rejects.toThrow('DATABASE_URL is not configured');
        });

        test('releases client after transaction', async () => {
            mockPoolClient.query.mockImplementation(() =>
                Promise.resolve({ rows: [] })
            );

            const client = await SelfhostedSupabaseClient.create(validOptions);
            await client.executeTransactionWithPg(async () => {});

            expect(mockPoolClient.release).toHaveBeenCalled();
        });

        test('releases client after failed transaction', async () => {
            mockPoolClient.query.mockImplementation((query: string) => {
                if (query === 'BEGIN' || query === 'ROLLBACK') {
                    return Promise.resolve({ rows: [] });
                }
                return Promise.reject(new Error('Failed'));
            });

            const client = await SelfhostedSupabaseClient.create(validOptions);

            try {
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query('FAIL');
                });
            } catch {
                // Expected to throw
            }

            expect(mockPoolClient.release).toHaveBeenCalled();
        });
    });

    describe('supabase client access', () => {
        test('exposes supabase client instance', async () => {
            const client = await SelfhostedSupabaseClient.create(validOptions);
            expect(client.supabase).toBeDefined();
            expect(client.supabase).toBe(mockSupabaseClient);
        });
    });
});
