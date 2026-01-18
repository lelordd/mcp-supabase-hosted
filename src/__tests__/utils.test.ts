import { describe, test, expect } from 'bun:test';
import { z } from 'zod';
import { isSqlErrorResponse, handleSqlResponse } from '../tools/utils.js';
import type { SqlExecutionResult, SqlErrorResponse, SqlSuccessResponse } from '../types/index.js';

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
});
