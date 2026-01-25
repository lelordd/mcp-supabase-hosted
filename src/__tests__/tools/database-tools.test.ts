/**
 * Tests for database-related tools
 *
 * Tools tested:
 * - list_tables
 * - list_extensions
 * - get_database_connections
 * - get_database_stats
 * - list_migrations
 * - apply_migration
 */

import { describe, test, expect } from 'bun:test';
import { listTablesTool } from '../../tools/list_tables.js';
import { listExtensionsTool } from '../../tools/list_extensions.js';
import { getDatabaseConnectionsTool } from '../../tools/get_database_connections.js';
import { getDatabaseStatsTool } from '../../tools/get_database_stats.js';
import {
    createMockClient,
    createMockContext,
    createSuccessResponse,
    createErrorResponse,
    testData,
} from '../helpers/mocks.js';

describe('listTablesTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(listTablesTool.name).toBe('list_tables');
        });

        test('has description', () => {
            expect(listTablesTool.description).toBeDefined();
            expect(listTablesTool.description).toContain('table');
        });

        test('has input and output schemas', () => {
            expect(listTablesTool.inputSchema).toBeDefined();
            expect(listTablesTool.outputSchema).toBeDefined();
            expect(listTablesTool.mcpInputSchema).toBeDefined();
        });
    });

    describe('execute', () => {
        test('returns list of tables', async () => {
            const tables = [
                { schema: 'public', name: 'users', comment: 'User accounts' },
                { schema: 'public', name: 'posts', comment: null },
            ];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(tables),
            });
            const context = createMockContext(mockClient);

            const result = await listTablesTool.execute({}, context);

            expect(result).toEqual(tables);
        });

        test('returns empty array when no tables exist', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await listTablesTool.execute({}, context);

            expect(result).toEqual([]);
        });

        test('throws error on SQL failure', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('permission denied', '42501'),
            });
            const context = createMockContext(mockClient);

            await expect(listTablesTool.execute({}, context)).rejects.toThrow('SQL Error');
        });

        test('uses read-only mode for query via service role RPC', async () => {
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: true,
                serviceRoleRpcResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            await listTablesTool.execute({}, context);

            // When using service role RPC, should be called with readOnly=true
            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalledWith(
                expect.any(String),
                true
            );
        });
    });

    describe('output validation', () => {
        test('validates correct table structure', () => {
            const validOutput = [
                { schema: 'public', name: 'users', comment: 'User table' },
                { schema: 'public', name: 'posts', comment: null },
            ];
            const result = listTablesTool.outputSchema.safeParse(validOutput);
            expect(result.success).toBe(true);
        });

        test('rejects missing schema field', () => {
            const invalidOutput = [{ name: 'users', comment: null }];
            const result = listTablesTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });

        test('rejects missing name field', () => {
            const invalidOutput = [{ schema: 'public', comment: null }];
            const result = listTablesTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });
    });
});

describe('listExtensionsTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(listExtensionsTool.name).toBe('list_extensions');
        });

        test('has description', () => {
            expect(listExtensionsTool.description).toContain('extension');
        });
    });

    describe('execute', () => {
        test('returns list of extensions', async () => {
            const extensions = [
                { name: 'uuid-ossp', schema: 'extensions', version: '1.1', description: 'UUID functions' },
                { name: 'pgcrypto', schema: 'extensions', version: '1.3', description: null },
            ];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(extensions),
            });
            const context = createMockContext(mockClient);

            const result = await listExtensionsTool.execute({}, context);

            expect(result).toEqual(extensions);
        });

        test('returns empty array when no extensions installed', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await listExtensionsTool.execute({}, context);

            expect(result).toEqual([]);
        });

        test('throws error on SQL failure', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('access denied', '42501'),
            });
            const context = createMockContext(mockClient);

            await expect(listExtensionsTool.execute({}, context)).rejects.toThrow('SQL Error');
        });
    });

    describe('output validation', () => {
        test('validates correct extension structure', () => {
            const validOutput = [
                { name: 'uuid-ossp', schema: 'public', version: '1.1', description: 'UUID gen' },
            ];
            const result = listExtensionsTool.outputSchema.safeParse(validOutput);
            expect(result.success).toBe(true);
        });

        test('accepts null description', () => {
            const output = [
                { name: 'ext', schema: 'public', version: '1.0', description: null },
            ];
            const result = listExtensionsTool.outputSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        test('rejects missing required fields', () => {
            const invalidOutput = [{ name: 'ext' }];
            const result = listExtensionsTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });
    });
});

describe('getDatabaseConnectionsTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(getDatabaseConnectionsTool.name).toBe('get_database_connections');
        });

        test('has description about connections', () => {
            expect(getDatabaseConnectionsTool.description).toContain('connection');
        });
    });

    describe('execute', () => {
        test('returns list of connections', async () => {
            const connections = [
                {
                    pid: 12345,
                    datname: 'postgres',
                    usename: 'postgres',
                    application_name: 'psql',
                    client_addr: '127.0.0.1',
                    backend_start: '2024-01-01T00:00:00Z',
                    state: 'active',
                    query: 'SELECT 1',
                },
            ];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(connections),
            });
            const context = createMockContext(mockClient);

            const result = await getDatabaseConnectionsTool.execute({}, context);

            expect(result).toEqual(connections);
        });

        test('returns empty array when no connections', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await getDatabaseConnectionsTool.execute({}, context);

            expect(result).toEqual([]);
        });

        test('handles connections with null values', async () => {
            const connections = [
                {
                    pid: 1,
                    datname: null,
                    usename: null,
                    application_name: null,
                    client_addr: null,
                    backend_start: null,
                    state: null,
                    query: null,
                },
            ];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(connections),
            });
            const context = createMockContext(mockClient);

            const result = await getDatabaseConnectionsTool.execute({}, context);

            expect(result).toEqual(connections);
        });

        test('throws error on SQL failure', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('permission denied for pg_stat_activity', '42501'),
            });
            const context = createMockContext(mockClient);

            await expect(getDatabaseConnectionsTool.execute({}, context)).rejects.toThrow('SQL Error');
        });
    });

    describe('output validation', () => {
        test('requires pid to be a number', () => {
            const invalidOutput = [{ pid: 'not-a-number' }];
            const result = getDatabaseConnectionsTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });

        test('accepts complete connection object', () => {
            const validOutput = [
                {
                    pid: 123,
                    datname: 'db',
                    usename: 'user',
                    application_name: 'app',
                    client_addr: '127.0.0.1',
                    backend_start: '2024-01-01',
                    state: 'idle',
                    query: 'SELECT 1',
                },
            ];
            const result = getDatabaseConnectionsTool.outputSchema.safeParse(validOutput);
            expect(result.success).toBe(true);
        });
    });
});

describe('getDatabaseStatsTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(getDatabaseStatsTool.name).toBe('get_database_stats');
        });

        test('has description about statistics', () => {
            expect(getDatabaseStatsTool.description).toContain('statistic');
        });
    });

    describe('execute', () => {
        test('returns combined database and bgwriter stats', async () => {
            const dbStats = [
                {
                    datname: 'postgres',
                    numbackends: 5,
                    xact_commit: '1000',
                    xact_rollback: '10',
                    blks_read: '500',
                    blks_hit: '9500',
                    tup_returned: '10000',
                    tup_fetched: '5000',
                    tup_inserted: '100',
                    tup_updated: '50',
                    tup_deleted: '10',
                    conflicts: '0',
                    temp_files: '0',
                    temp_bytes: '0',
                    deadlocks: '0',
                    checksum_failures: null,
                    checksum_last_failure: null,
                    blk_read_time: 1.5,
                    blk_write_time: 0.5,
                    stats_reset: '2024-01-01T00:00:00Z',
                },
            ];
            const bgWriterStats = [
                {
                    checkpoints_timed: '100',
                    checkpoints_req: '5',
                    checkpoint_write_time: 1000.0,
                    checkpoint_sync_time: 50.0,
                    buffers_checkpoint: '500',
                    buffers_clean: '100',
                    maxwritten_clean: '0',
                    buffers_backend: '50',
                    buffers_backend_fsync: '0',
                    buffers_alloc: '1000',
                    stats_reset: '2024-01-01T00:00:00Z',
                },
            ];

            // Mock client needs to return different results for the two queries
            let callCount = 0;
            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeSqlWithPg as ReturnType<typeof import('bun:test').mock>).mockImplementation(
                async () => {
                    callCount++;
                    return callCount === 1 ? dbStats : bgWriterStats;
                }
            );
            const context = createMockContext(mockClient);

            const result = await getDatabaseStatsTool.execute({}, context);

            expect(result).toHaveProperty('database_stats');
            expect(result).toHaveProperty('bgwriter_stats');
            expect(result.database_stats).toEqual(dbStats);
            expect(result.bgwriter_stats).toEqual(bgWriterStats);
        });

        test('throws error when database stats query fails', async () => {
            let callCount = 0;
            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeSqlWithPg as ReturnType<typeof import('bun:test').mock>).mockImplementation(
                async () => {
                    callCount++;
                    if (callCount === 1) {
                        return createErrorResponse('query failed', 'ERROR');
                    }
                    return [];
                }
            );
            const context = createMockContext(mockClient);

            await expect(getDatabaseStatsTool.execute({}, context)).rejects.toThrow('SQL Error');
        });

        test('throws error when bgwriter stats query fails', async () => {
            let callCount = 0;
            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeSqlWithPg as ReturnType<typeof import('bun:test').mock>).mockImplementation(
                async () => {
                    callCount++;
                    if (callCount === 2) {
                        return createErrorResponse('query failed', 'ERROR');
                    }
                    return [
                        {
                            datname: 'test',
                            numbackends: 1,
                            xact_commit: '0',
                            xact_rollback: '0',
                            blks_read: '0',
                            blks_hit: '0',
                            tup_returned: '0',
                            tup_fetched: '0',
                            tup_inserted: '0',
                            tup_updated: '0',
                            tup_deleted: '0',
                            conflicts: '0',
                            temp_files: '0',
                            temp_bytes: '0',
                            deadlocks: '0',
                            checksum_failures: null,
                            checksum_last_failure: null,
                            blk_read_time: 0,
                            blk_write_time: 0,
                            stats_reset: null,
                        },
                    ];
                }
            );
            const context = createMockContext(mockClient);

            await expect(getDatabaseStatsTool.execute({}, context)).rejects.toThrow('SQL Error');
        });
    });

    describe('output validation', () => {
        test('validates correct stats structure', () => {
            const validOutput = {
                database_stats: [
                    {
                        datname: 'test',
                        numbackends: 1,
                        xact_commit: '0',
                        xact_rollback: '0',
                        blks_read: '0',
                        blks_hit: '0',
                        tup_returned: '0',
                        tup_fetched: '0',
                        tup_inserted: '0',
                        tup_updated: '0',
                        tup_deleted: '0',
                        conflicts: '0',
                        temp_files: '0',
                        temp_bytes: '0',
                        deadlocks: '0',
                        checksum_failures: null,
                        checksum_last_failure: null,
                        blk_read_time: 0,
                        blk_write_time: 0,
                        stats_reset: null,
                    },
                ],
                bgwriter_stats: [
                    {
                        checkpoints_timed: '0',
                        checkpoints_req: '0',
                        checkpoint_write_time: 0,
                        checkpoint_sync_time: 0,
                        buffers_checkpoint: '0',
                        buffers_clean: '0',
                        maxwritten_clean: '0',
                        buffers_backend: '0',
                        buffers_backend_fsync: '0',
                        buffers_alloc: '0',
                        stats_reset: null,
                    },
                ],
            };
            const result = getDatabaseStatsTool.outputSchema.safeParse(validOutput);
            expect(result.success).toBe(true);
        });

        test('rejects missing database_stats', () => {
            const invalidOutput = { bgwriter_stats: [] };
            const result = getDatabaseStatsTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });

        test('rejects missing bgwriter_stats', () => {
            const invalidOutput = { database_stats: [] };
            const result = getDatabaseStatsTool.outputSchema.safeParse(invalidOutput);
            expect(result.success).toBe(false);
        });
    });
});
