/**
 * Tests for execute_sql tool
 *
 * Tests the SQL execution tool that allows arbitrary SQL queries.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { executeSqlTool } from '../../tools/execute_sql.js';
import {
    createMockClient,
    createMockContext,
    createSuccessResponse,
    createErrorResponse,
} from '../helpers/mocks.js';

describe('executeSqlTool', () => {
    describe('metadata', () => {
        test('has correct name', () => {
            expect(executeSqlTool.name).toBe('execute_sql');
        });

        test('has description', () => {
            expect(executeSqlTool.description).toBeDefined();
            expect(executeSqlTool.description.length).toBeGreaterThan(0);
        });

        test('has input schema', () => {
            expect(executeSqlTool.inputSchema).toBeDefined();
        });

        test('has MCP input schema', () => {
            expect(executeSqlTool.mcpInputSchema).toBeDefined();
            expect(executeSqlTool.mcpInputSchema.type).toBe('object');
            expect(executeSqlTool.mcpInputSchema.properties.sql).toBeDefined();
        });

        test('has output schema', () => {
            expect(executeSqlTool.outputSchema).toBeDefined();
        });
    });

    describe('input validation', () => {
        test('validates sql is required', () => {
            const result = executeSqlTool.inputSchema.safeParse({});
            expect(result.success).toBe(false);
        });

        test('validates sql must be string', () => {
            const result = executeSqlTool.inputSchema.safeParse({ sql: 123 });
            expect(result.success).toBe(false);
        });

        test('accepts valid sql string', () => {
            const result = executeSqlTool.inputSchema.safeParse({ sql: 'SELECT 1' });
            expect(result.success).toBe(true);
        });

        test('read_only defaults to false', () => {
            const result = executeSqlTool.inputSchema.safeParse({ sql: 'SELECT 1' });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.read_only).toBe(false);
            }
        });

        test('accepts read_only boolean', () => {
            const result = executeSqlTool.inputSchema.safeParse({
                sql: 'SELECT 1',
                read_only: true,
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.read_only).toBe(true);
            }
        });
    });

    describe('execute', () => {
        test('returns results for successful query', async () => {
            const expectedRows = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(expectedRows),
            });
            const context = createMockContext(mockClient);

            const result = await executeSqlTool.execute({ sql: 'SELECT * FROM users' }, context);

            expect(result).toEqual(expectedRows);
        });

        test('returns empty array for query with no results', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await executeSqlTool.execute(
                { sql: 'SELECT * FROM users WHERE 1=0' },
                context
            );

            expect(result).toEqual([]);
        });

        test('throws error for SQL error response', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createErrorResponse('syntax error at position 1', '42601'),
            });
            const context = createMockContext(mockClient);

            await expect(
                executeSqlTool.execute({ sql: 'INVALID SQL' }, context)
            ).rejects.toThrow('SQL Error (42601): syntax error at position 1');
        });

        test('uses pg connection when available', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([{ result: 1 }]),
            });
            const context = createMockContext(mockClient);

            await executeSqlTool.execute({ sql: 'SELECT 1 as result' }, context);

            expect(mockClient.executeSqlWithPg).toHaveBeenCalled();
            expect(mockClient.executeSqlViaRpc).not.toHaveBeenCalled();
        });

        test('falls back to service role RPC when pg is not available', async () => {
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: true,
                serviceRoleRpcResult: createSuccessResponse([{ result: 1 }]),
            });
            const context = createMockContext(mockClient);

            await executeSqlTool.execute({ sql: 'SELECT 1 as result' }, context);

            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalled();
        });

        test('passes read_only flag to service role RPC', async () => {
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: true,
                serviceRoleRpcResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            await executeSqlTool.execute(
                { sql: 'SELECT 1', read_only: true },
                context
            );

            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalledWith('SELECT 1', true);
        });

        test('throws error when neither pg nor service role is available', async () => {
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: false,
            });
            const context = createMockContext(mockClient);

            await expect(
                executeSqlTool.execute({ sql: 'SELECT 1' }, context)
            ).rejects.toThrow('execute_sql requires either a direct database connection');
        });

        test('handles complex query results', async () => {
            const complexResult = [
                {
                    id: 1,
                    created_at: '2024-01-01T00:00:00Z',
                    metadata: { key: 'value' },
                    tags: ['a', 'b', 'c'],
                },
            ];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(complexResult),
            });
            const context = createMockContext(mockClient);

            const result = await executeSqlTool.execute(
                { sql: 'SELECT * FROM complex_table' },
                context
            );

            expect(result).toEqual(complexResult);
        });

        test('handles INSERT returning result', async () => {
            const insertResult = [{ id: 42 }];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(insertResult),
            });
            const context = createMockContext(mockClient);

            const result = await executeSqlTool.execute(
                { sql: "INSERT INTO users (name) VALUES ('test') RETURNING id" },
                context
            );

            expect(result).toEqual(insertResult);
        });

        test('handles UPDATE with no rows affected', async () => {
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse([]),
            });
            const context = createMockContext(mockClient);

            const result = await executeSqlTool.execute(
                { sql: "UPDATE users SET name = 'test' WHERE id = -1" },
                context
            );

            expect(result).toEqual([]);
        });
    });

    describe('output validation', () => {
        test('output schema accepts array of objects', () => {
            const result = executeSqlTool.outputSchema.safeParse([
                { id: 1, name: 'test' },
            ]);
            expect(result.success).toBe(true);
        });

        test('output schema accepts empty array', () => {
            const result = executeSqlTool.outputSchema.safeParse([]);
            expect(result.success).toBe(true);
        });

        test('output schema accepts array with any structure', () => {
            const result = executeSqlTool.outputSchema.safeParse([
                { complex: { nested: { data: [1, 2, 3] } } },
            ]);
            expect(result.success).toBe(true);
        });
    });
});
