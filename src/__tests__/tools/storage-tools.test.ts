/**
 * Tests for storage-related tools
 *
 * Tools tested:
 * - list_storage_buckets
 * - list_storage_objects
 * - get_storage_config
 * - update_storage_config
 */

import { describe, test, expect, mock } from 'bun:test';
import { listStorageBucketsTool } from '../../tools/list_storage_buckets.js';
import { listStorageObjectsTool } from '../../tools/list_storage_objects.js';
import {
    createMockClient,
    createMockContext,
    createSuccessResponse,
    createErrorResponse,
    testData,
} from '../helpers/mocks.js';

describe('listStorageBucketsTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(listStorageBucketsTool.name).toBe('list_storage_buckets');
        });

        test('has description', () => {
            expect(listStorageBucketsTool.description).toContain('bucket');
        });

        test('has input and output schemas', () => {
            expect(listStorageBucketsTool.inputSchema).toBeDefined();
            expect(listStorageBucketsTool.outputSchema).toBeDefined();
        });
    });

    describe('input validation', () => {
        test('accepts empty input', () => {
            const result = listStorageBucketsTool.inputSchema.safeParse({});
            expect(result.success).toBe(true);
        });
    });

    describe('execute', () => {
        test('returns list of buckets', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(testData.buckets),
            });
            const context = createMockContext(mockClient);

            const result = await listStorageBucketsTool.execute({}, context);

            expect(result).toEqual(testData.buckets);
        });

        test('returns empty array when no buckets', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await listStorageBucketsTool.execute({}, context);

            expect(result).toEqual([]);
        });

        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(listStorageBucketsTool.execute({}, context)).rejects.toThrow(
                'Direct database connection'
            );
        });

        test('throws error on SQL failure', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('relation "storage.buckets" does not exist', '42P01'),
            });
            const context = createMockContext(mockClient);

            await expect(listStorageBucketsTool.execute({}, context)).rejects.toThrow('SQL Error');
        });

        test('uses pg connection directly', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            await listStorageBucketsTool.execute({}, context);

            expect(mockClient.executeSqlWithPg).toHaveBeenCalled();
        });
    });

    describe('output validation', () => {
        test('validates correct bucket structure', () => {
            const result = listStorageBucketsTool.outputSchema.safeParse(testData.buckets);
            expect(result.success).toBe(true);
        });

        test('accepts buckets with all nullable fields as null', () => {
            const bucketWithNulls = [{
                id: 'test-id',
                name: 'test-bucket',
                owner: null,
                public: false,
                avif_autodetection: false,
                file_size_limit: null,
                allowed_mime_types: null,
                created_at: null,
                updated_at: null,
            }];
            const result = listStorageBucketsTool.outputSchema.safeParse(bucketWithNulls);
            expect(result.success).toBe(true);
        });

        test('rejects bucket without required id', () => {
            const invalid = [{ name: 'test' }];
            const result = listStorageBucketsTool.outputSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        test('rejects bucket with invalid public type', () => {
            const invalid = [{
                id: 'test',
                name: 'test',
                owner: null,
                public: 'yes', // should be boolean
                avif_autodetection: false,
                file_size_limit: null,
                allowed_mime_types: null,
                created_at: null,
                updated_at: null,
            }];
            const result = listStorageBucketsTool.outputSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });
});

describe('listStorageObjectsTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(listStorageObjectsTool.name).toBe('list_storage_objects');
        });

        test('has description', () => {
            expect(listStorageObjectsTool.description).toContain('object');
        });
    });

    describe('input validation', () => {
        test('requires bucket_id', () => {
            const result = listStorageObjectsTool.inputSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        test('accepts bucket_id only', () => {
            const result = listStorageObjectsTool.inputSchema.safeParse({ bucket_id: 'test-bucket' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.limit).toBe(100);
                expect(result.data.offset).toBe(0);
            }
        });

        test('accepts all parameters', () => {
            const result = listStorageObjectsTool.inputSchema.safeParse({
                bucket_id: 'test-bucket',
                limit: 50,
                offset: 10,
                prefix: 'public/',
            });
            expect(result.success).toBe(true);
        });

        test('rejects negative limit', () => {
            const result = listStorageObjectsTool.inputSchema.safeParse({
                bucket_id: 'test',
                limit: -1,
            });
            expect(result.success).toBe(false);
        });

        test('rejects negative offset', () => {
            const result = listStorageObjectsTool.inputSchema.safeParse({
                bucket_id: 'test',
                offset: -1,
            });
            expect(result.success).toBe(false);
        });
    });

    describe('execute', () => {
        test('returns list of objects', async () => {
            const mockPgClient = {
                query: mock(async () => ({ rows: testData.storageObjects })),
            };

            const mockClient = createMockClient({ pgAvailable: true });
            (mockClient.executeTransactionWithPg as ReturnType<typeof mock>).mockImplementation(
                async (callback: (client: unknown) => Promise<unknown>) => {
                    return callback(mockPgClient);
                }
            );
            const context = createMockContext(mockClient);

            const result = await listStorageObjectsTool.execute(
                { bucket_id: 'avatars' },
                context
            );

            expect(result.length).toBe(testData.storageObjects.length);
        });

        test('returns empty array when no objects', async () => {
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

            const result = await listStorageObjectsTool.execute(
                { bucket_id: 'empty-bucket' },
                context
            );

            expect(result).toEqual([]);
        });

        test('throws error when pg is not available', async () => {
            const mockClient = createMockClient({ pgAvailable: false });
            const context = createMockContext(mockClient);

            await expect(
                listStorageObjectsTool.execute({ bucket_id: 'test' }, context)
            ).rejects.toThrow('Direct database connection');
        });

        test('uses transaction for parameterized query', async () => {
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

            await listStorageObjectsTool.execute({ bucket_id: 'test' }, context);

            expect(mockClient.executeTransactionWithPg).toHaveBeenCalled();
        });

        test('applies prefix filter in query', async () => {
            let executedSql = '';
            let executedParams: unknown[] = [];

            const mockPgClient = {
                query: mock(async (sql: string, params: unknown[]) => {
                    executedSql = sql;
                    executedParams = params;
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

            await listStorageObjectsTool.execute(
                { bucket_id: 'test', prefix: 'images/' },
                context
            );

            expect(executedSql).toContain('LIKE');
            expect(executedParams).toContain('images/%');
        });
    });

    describe('output validation', () => {
        test('validates correct object structure', () => {
            const validObjects = [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'file.txt',
                bucket_id: 'test',
                owner: '123e4567-e89b-12d3-a456-426614174001',
                version: null,
                mimetype: 'text/plain',
                size: 1024,
                metadata: { mimetype: 'text/plain', size: 1024 },
                created_at: '2024-01-01',
                updated_at: null,
                last_accessed_at: null,
            }];
            const result = listStorageObjectsTool.outputSchema.safeParse(validObjects);
            expect(result.success).toBe(true);
        });

        test('transforms string size to number', () => {
            const objectWithStringSize = [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'file.txt',
                bucket_id: 'test',
                owner: null,
                version: null,
                mimetype: null,
                size: '1024', // string
                metadata: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
            }];
            const result = listStorageObjectsTool.outputSchema.safeParse(objectWithStringSize);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data[0].size).toBe(1024);
            }
        });

        test('handles null size', () => {
            const objectWithNullSize = [{
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: null,
                bucket_id: 'test',
                owner: null,
                version: null,
                mimetype: null,
                size: null,
                metadata: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
            }];
            const result = listStorageObjectsTool.outputSchema.safeParse(objectWithNullSize);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data[0].size).toBeNull();
            }
        });

        test('rejects invalid UUID for id', () => {
            const invalid = [{
                id: 'not-a-uuid',
                name: 'file.txt',
                bucket_id: 'test',
                owner: null,
                version: null,
                mimetype: null,
                size: null,
                metadata: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
            }];
            const result = listStorageObjectsTool.outputSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });
});
