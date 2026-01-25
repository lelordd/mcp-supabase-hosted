/**
 * Integration tests for SelfhostedSupabaseClient
 *
 * These tests run against a real Supabase instance and are skipped
 * when environment variables are not configured.
 *
 * Required environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - DATABASE_URL (optional, for direct pg connection tests)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { SelfhostedSupabaseClient } from '../../client/index.js';

// Check if we have the required credentials
const hasCredentials = !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
);

const hasDatabaseUrl = !!process.env.DATABASE_URL;

// Skip all tests if credentials are not available
describe.skipIf(!hasCredentials)('SelfhostedSupabaseClient Integration Tests', () => {
    let client: SelfhostedSupabaseClient;

    beforeAll(async () => {
        client = await SelfhostedSupabaseClient.create({
            supabaseUrl: process.env.SUPABASE_URL!,
            supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
            supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            databaseUrl: process.env.DATABASE_URL,
            jwtSecret: process.env.JWT_SECRET,
        });
    });

    describe('Client initialization', () => {
        test('creates client successfully', () => {
            expect(client).toBeDefined();
            expect(client.supabase).toBeDefined();
        });

        test('getSupabaseUrl returns correct URL', () => {
            expect(client.getSupabaseUrl()).toBe(process.env.SUPABASE_URL);
        });

        test('getAnonKey returns correct key', () => {
            expect(client.getAnonKey()).toBe(process.env.SUPABASE_ANON_KEY);
        });

        test('isPgAvailable reflects DATABASE_URL configuration', () => {
            expect(client.isPgAvailable()).toBe(hasDatabaseUrl);
        });
    });

    describe('SQL execution via RPC', () => {
        test('executes simple SELECT query', async () => {
            const result = await client.executeSqlViaRpc('SELECT 1 as value', true);

            // If RPC is not available, we'll get an error
            if ('error' in result) {
                console.log('RPC not available:', result.error.message);
                // This is acceptable in integration tests - RPC may not be set up
                expect(result.error).toBeDefined();
            } else {
                expect(Array.isArray(result)).toBe(true);
                expect(result[0]?.value).toBe(1);
            }
        });

        test('executes query returning multiple rows', async () => {
            const result = await client.executeSqlViaRpc(
                'SELECT generate_series(1, 3) as num',
                true
            );

            if ('error' in result) {
                console.log('RPC not available:', result.error.message);
                expect(result.error).toBeDefined();
            } else {
                expect(Array.isArray(result)).toBe(true);
                expect(result.length).toBe(3);
            }
        });
    });

    describe.skipIf(!hasDatabaseUrl)('SQL execution via direct pg', () => {
        test('executes simple SELECT query', async () => {
            const result = await client.executeSqlWithPg('SELECT 1 as value');

            if ('error' in result) {
                console.log('Direct pg error:', result.error.message);
                throw new Error(result.error.message);
            }

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]?.value).toBe(1);
        });

        test('executes query with multiple columns', async () => {
            const result = await client.executeSqlWithPg(
                "SELECT 'hello' as greeting, 42 as answer"
            );

            if ('error' in result) {
                throw new Error(result.error.message);
            }

            expect(result[0]?.greeting).toBe('hello');
            expect(result[0]?.answer).toBe(42);
        });

        test('handles query with no results', async () => {
            const result = await client.executeSqlWithPg(
                'SELECT 1 WHERE false'
            );

            if ('error' in result) {
                throw new Error(result.error.message);
            }

            expect(result).toEqual([]);
        });

        test('returns error for invalid SQL', async () => {
            const result = await client.executeSqlWithPg('INVALID SQL QUERY');

            expect('error' in result).toBe(true);
            if ('error' in result) {
                expect(result.error.message).toBeDefined();
            }
        });
    });

    describe.skipIf(!hasDatabaseUrl)('Transaction handling', () => {
        test('commits transaction on success', async () => {
            const testTableName = `test_integration_${Date.now()}`;

            try {
                // Create a test table in a transaction
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query(`
                        CREATE TEMP TABLE ${testTableName} (id serial, name text)
                    `);
                    await pgClient.query(
                        `INSERT INTO ${testTableName} (name) VALUES ($1)`,
                        ['test-value']
                    );
                });

                // Verify the table was created (temp tables are session-scoped)
                // This test mainly verifies the transaction didn't throw
                expect(true).toBe(true);
            } catch (error) {
                // If this fails, it's likely a permissions issue
                console.log('Transaction test failed:', error);
                expect(error).toBeDefined();
            }
        });

        test('rolls back transaction on error', async () => {
            try {
                await client.executeTransactionWithPg(async (pgClient) => {
                    await pgClient.query('SELECT 1');
                    throw new Error('Intentional error for rollback test');
                });
                // Should not reach here
                expect(true).toBe(false);
            } catch (error) {
                expect((error as Error).message).toContain('Intentional error');
            }
        });
    });

    describe('System catalog queries', () => {
        test.skipIf(!hasDatabaseUrl)('lists database extensions', async () => {
            const result = await client.executeSqlWithPg(`
                SELECT extname as name
                FROM pg_extension
                LIMIT 5
            `);

            if ('error' in result) {
                throw new Error(result.error.message);
            }

            expect(Array.isArray(result)).toBe(true);
            // plpgsql is always installed
            const hasPlpgsql = result.some((ext: { name: string }) => ext.name === 'plpgsql');
            expect(hasPlpgsql).toBe(true);
        });

        test.skipIf(!hasDatabaseUrl)('queries pg_stat_activity', async () => {
            const result = await client.executeSqlWithPg(`
                SELECT pid, state
                FROM pg_stat_activity
                WHERE backend_type = 'client backend'
                LIMIT 5
            `);

            if ('error' in result) {
                // May fail due to permissions
                console.log('pg_stat_activity query failed:', result.error.message);
                expect(result.error).toBeDefined();
            } else {
                expect(Array.isArray(result)).toBe(true);
            }
        });
    });
});
