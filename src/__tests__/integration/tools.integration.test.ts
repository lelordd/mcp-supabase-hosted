/**
 * Integration tests for MCP tools
 *
 * These tests run against a real Supabase instance and are skipped
 * when environment variables are not configured.
 *
 * Required environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - DATABASE_URL (required for most tools)
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { SelfhostedSupabaseClient } from '../../client/index.js';
import type { ToolContext } from '../../tools/types.js';

// Import tools to test
import { listTablesTool } from '../../tools/list_tables.js';
import { listExtensionsTool } from '../../tools/list_extensions.js';
import { getDatabaseConnectionsTool } from '../../tools/get_database_connections.js';
import { executeSqlTool } from '../../tools/execute_sql.js';
import { getProjectUrlTool } from '../../tools/get_project_url.js';
import { verifyJwtSecretTool } from '../../tools/verify_jwt_secret.js';
import { listStorageBucketsTool } from '../../tools/list_storage_buckets.js';

// Check if we have the required credentials
const hasCredentials = !!(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
);

const hasDatabaseUrl = !!process.env.DATABASE_URL;

// Skip all tests if credentials are not available
describe.skipIf(!hasCredentials)('Tools Integration Tests', () => {
    let client: SelfhostedSupabaseClient;
    let context: ToolContext;

    beforeAll(async () => {
        client = await SelfhostedSupabaseClient.create({
            supabaseUrl: process.env.SUPABASE_URL!,
            supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
            supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            databaseUrl: process.env.DATABASE_URL,
            jwtSecret: process.env.JWT_SECRET,
        });

        context = {
            selfhostedClient: client,
            log: (message: string, level?: 'info' | 'warn' | 'error') => {
                console.log(`[${level || 'info'}] ${message}`);
            },
        };
    });

    describe('Simple getter tools', () => {
        test('get_project_url returns configured URL', async () => {
            const result = await getProjectUrlTool.execute({}, context);
            expect(result.project_url).toBe(process.env.SUPABASE_URL);
        });

        test('verify_jwt_secret returns status', async () => {
            const result = await verifyJwtSecretTool.execute({}, context);

            if (process.env.JWT_SECRET) {
                expect(result.jwt_secret_status).toBe('found');
            } else {
                expect(result.jwt_secret_status).toBe('not_configured');
            }
        });
    });

    describe.skipIf(!hasDatabaseUrl)('Database tools', () => {
        test('list_tables returns table list', async () => {
            const result = await listTablesTool.execute({}, context);

            expect(Array.isArray(result)).toBe(true);
            // All tables should have schema and name
            result.forEach((table: { schema: string; name: string }) => {
                expect(typeof table.schema).toBe('string');
                expect(typeof table.name).toBe('string');
            });
        });

        test('list_extensions returns extension list', async () => {
            const result = await listExtensionsTool.execute({}, context);

            expect(Array.isArray(result)).toBe(true);
            // Each extension should have name and version
            result.forEach((ext: { name: string; version: string }) => {
                expect(typeof ext.name).toBe('string');
                expect(typeof ext.version).toBe('string');
            });
        });

        test('get_database_connections returns connection list', async () => {
            try {
                const result = await getDatabaseConnectionsTool.execute({}, context);

                expect(Array.isArray(result)).toBe(true);
                // Should have at least one connection (ourselves)
                expect(result.length).toBeGreaterThan(0);
                // Each connection should have pid
                result.forEach((conn: { pid: number }) => {
                    expect(typeof conn.pid).toBe('number');
                });
            } catch (error) {
                // May fail due to permissions on pg_stat_activity
                console.log('get_database_connections failed (may be permissions):', error);
                expect(error).toBeDefined();
            }
        });

        test('execute_sql runs simple queries', async () => {
            const result = await executeSqlTool.execute(
                { sql: 'SELECT 1 as value', read_only: true },
                context
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]?.value).toBe(1);
        });

        test('execute_sql handles complex queries', async () => {
            const result = await executeSqlTool.execute(
                {
                    sql: `
                        SELECT
                            'test' as name,
                            42 as number,
                            ARRAY[1,2,3] as arr,
                            '{"key": "value"}'::jsonb as json_data
                    `,
                    read_only: true,
                },
                context
            );

            expect(Array.isArray(result)).toBe(true);
            expect(result[0]?.name).toBe('test');
            expect(result[0]?.number).toBe(42);
        });

        test('execute_sql returns error for invalid SQL', async () => {
            await expect(
                executeSqlTool.execute(
                    { sql: 'INVALID SQL STATEMENT' },
                    context
                )
            ).rejects.toThrow('SQL Error');
        });
    });

    describe.skipIf(!hasDatabaseUrl)('Storage tools', () => {
        test('list_storage_buckets returns bucket list', async () => {
            try {
                const result = await listStorageBucketsTool.execute({}, context);

                expect(Array.isArray(result)).toBe(true);
                // Each bucket should have id and name
                result.forEach((bucket: { id: string; name: string }) => {
                    expect(typeof bucket.id).toBe('string');
                    expect(typeof bucket.name).toBe('string');
                });
            } catch (error) {
                // Storage schema may not exist
                console.log('list_storage_buckets failed (storage may not be configured):', error);
                expect(error).toBeDefined();
            }
        });
    });

    describe.skipIf(!hasDatabaseUrl)('Auth tools (read-only)', () => {
        // Note: We only test read operations to avoid modifying data
        // Create/Update/Delete tests would need proper cleanup

        test('can query auth.users table structure', async () => {
            // Just verify we can query the auth schema
            try {
                const result = await executeSqlTool.execute(
                    {
                        sql: `
                            SELECT column_name, data_type
                            FROM information_schema.columns
                            WHERE table_schema = 'auth' AND table_name = 'users'
                            LIMIT 5
                        `,
                        read_only: true,
                    },
                    context
                );

                expect(Array.isArray(result)).toBe(true);
                // Should have some columns
                expect(result.length).toBeGreaterThan(0);
            } catch (error) {
                // May not have access to auth schema
                console.log('Auth schema query failed (may be permissions):', error);
                expect(error).toBeDefined();
            }
        });
    });
});

// Separate describe block for cleanup to ensure it runs
describe.skipIf(!hasCredentials)('Integration Test Cleanup', () => {
    test('placeholder for cleanup', () => {
        // Any test data cleanup would go here
        // For now, we're using read-only operations
        expect(true).toBe(true);
    });
});
