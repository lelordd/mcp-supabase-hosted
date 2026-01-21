import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { isSqlErrorResponse, handleSqlResponse, executeSqlWithFallback, runExternalCommand } from '../tools/utils.js';
import type { SqlExecutionResult, SqlErrorResponse, SqlSuccessResponse } from '../types/index.js';
import { createMockClient, createSuccessResponse, createErrorResponse } from './helpers/mocks.js';

describe('utils', () => {
    describe('isSqlErrorResponse', () => {
        test('returns true for error response', () => {
            const errorResult: SqlErrorResponse = {
                error: {
                    message: 'Test error',
                    code: 'TEST001',
                },
            };
            expect(isSqlErrorResponse(errorResult)).toBe(true);
        });

        test('returns false for success response', () => {
            const successResult: SqlSuccessResponse = [
                { id: 1, name: 'test' },
            ];
            expect(isSqlErrorResponse(successResult)).toBe(false);
        });

        test('returns false for empty array (valid success)', () => {
            const emptyResult: SqlSuccessResponse = [];
            expect(isSqlErrorResponse(emptyResult)).toBe(false);
        });
    });

    describe('handleSqlResponse', () => {
        const testSchema = z.array(
            z.object({
                id: z.number(),
                name: z.string(),
            })
        );

        test('returns parsed data for valid success response', () => {
            const successResult: SqlSuccessResponse = [
                { id: 1, name: 'test' },
                { id: 2, name: 'test2' },
            ];
            const result = handleSqlResponse(successResult, testSchema);
            expect(result).toEqual([
                { id: 1, name: 'test' },
                { id: 2, name: 'test2' },
            ]);
        });

        test('throws error for SQL error response', () => {
            const errorResult: SqlErrorResponse = {
                error: {
                    message: 'Database error',
                    code: 'DB001',
                },
            };
            expect(() => handleSqlResponse(errorResult, testSchema)).toThrow(
                'SQL Error (DB001): Database error'
            );
        });

        test('throws error for schema validation failure', () => {
            const invalidData: SqlSuccessResponse = [
                { id: 'not-a-number', name: 'test' } as unknown as Record<string, unknown>,
            ];
            expect(() => handleSqlResponse(invalidData, testSchema)).toThrow(
                'Schema validation failed'
            );
        });

        test('handles empty array with array schema', () => {
            const emptyResult: SqlSuccessResponse = [];
            const result = handleSqlResponse(emptyResult, testSchema);
            expect(result).toEqual([]);
        });

        test('error message includes path for nested validation errors', () => {
            const nestedSchema = z.array(
                z.object({
                    user: z.object({
                        email: z.string().email('Invalid email'),
                    }),
                })
            );
            const invalidData: SqlSuccessResponse = [
                { user: { email: 'not-an-email' } },
            ];
            expect(() => handleSqlResponse(invalidData, nestedSchema)).toThrow(
                /user\.email/
            );
        });
    });

    describe('executeSqlWithFallback', () => {
        test('uses direct pg connection when available', async () => {
            const expectedRows = [{ id: 1, name: 'test' }];
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: createSuccessResponse(expectedRows),
                rpcResult: createSuccessResponse([{ id: 2, name: 'rpc' }]),
            });

            const result = await executeSqlWithFallback(mockClient, 'SELECT * FROM users');

            expect(result).toEqual(expectedRows);
            expect(mockClient.executeSqlWithPg).toHaveBeenCalledTimes(1);
            expect(mockClient.executeSqlViaRpc).not.toHaveBeenCalled();
        });

        test('falls back to service role RPC when pg is not available', async () => {
            const expectedRows = [{ id: 1, name: 'service-role-result' }];
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: true,
                serviceRoleRpcResult: createSuccessResponse(expectedRows),
            });

            const result = await executeSqlWithFallback(mockClient, 'SELECT * FROM users', true);

            expect(result).toEqual(expectedRows);
            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalledTimes(1);
            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalledWith('SELECT * FROM users', true);
        });

        test('propagates error from pg connection', async () => {
            const errorResponse = createErrorResponse('Connection failed', 'CONN_ERR');
            const mockClient = createMockClient({
                pgAvailable: true,
                pgResult: errorResponse,
            });

            const result = await executeSqlWithFallback(mockClient, 'SELECT 1');

            expect(result).toEqual(errorResponse);
        });

        test('propagates error from service role RPC fallback', async () => {
            const errorResponse = createErrorResponse('RPC failed', 'RPC_ERR');
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: true,
                serviceRoleRpcResult: errorResponse,
            });

            const result = await executeSqlWithFallback(mockClient, 'SELECT 1');

            expect(result).toEqual(errorResponse);
        });

        test('defaults readOnly to true when using service role RPC', async () => {
            const mockClient = createMockClient({ pgAvailable: false, serviceRoleAvailable: true });

            await executeSqlWithFallback(mockClient, 'SELECT 1');

            expect(mockClient.executeSqlViaServiceRoleRpc).toHaveBeenCalledWith('SELECT 1', true);
        });

        test('returns error when neither pg nor service role is available', async () => {
            const mockClient = createMockClient({
                pgAvailable: false,
                serviceRoleAvailable: false,
            });

            const result = await executeSqlWithFallback(mockClient, 'SELECT 1');

            expect(result).toHaveProperty('error');
            expect((result as any).error.code).toBe('MCP_CONFIG_ERROR');
        });
    });

    describe('runExternalCommand', () => {
        test('executes command and returns stdout', async () => {
            const result = await runExternalCommand('echo "hello world"');

            expect(result.stdout.trim()).toBe('hello world');
            expect(result.stderr).toBe('');
            expect(result.error).toBeNull();
        });

        test('returns empty stdout for command with no output', async () => {
            const result = await runExternalCommand('true');

            expect(result.stdout).toBe('');
            expect(result.stderr).toBe('');
            expect(result.error).toBeNull();
        });

        test('captures stderr and error for failing command', async () => {
            const result = await runExternalCommand('ls /nonexistent-directory-12345');

            expect(result.error).not.toBeNull();
            expect(result.stderr.length).toBeGreaterThan(0);
        });

        test('returns error for non-existent command', async () => {
            const result = await runExternalCommand('nonexistent-command-12345');

            expect(result.error).not.toBeNull();
        });

        test('handles command with exit code', async () => {
            const result = await runExternalCommand('exit 1');

            expect(result.error).not.toBeNull();
        });
    });
});
