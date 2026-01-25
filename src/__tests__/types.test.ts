import { describe, test, expect } from 'bun:test';
import type {
    SelfhostedSupabaseClientOptions,
    SqlSuccessResponse,
    SqlErrorResponse,
    SqlExecutionResult,
    AuthUser,
    StorageBucket,
    StorageObject,
} from '../types/index.js';

describe('Type Definitions', () => {
    describe('SelfhostedSupabaseClientOptions', () => {
        test('required fields are enforced at compile time', () => {
            const validOptions: SelfhostedSupabaseClientOptions = {
                supabaseUrl: 'http://localhost:54321',
                supabaseAnonKey: 'test-anon-key',
            };
            expect(validOptions.supabaseUrl).toBe('http://localhost:54321');
            expect(validOptions.supabaseAnonKey).toBe('test-anon-key');
        });

        test('optional fields can be provided', () => {
            const fullOptions: SelfhostedSupabaseClientOptions = {
                supabaseUrl: 'http://localhost:54321',
                supabaseAnonKey: 'test-anon-key',
                supabaseServiceRoleKey: 'service-key',
                databaseUrl: 'postgresql://localhost:5432/db',
                jwtSecret: 'secret',
            };
            expect(fullOptions.supabaseServiceRoleKey).toBe('service-key');
            expect(fullOptions.databaseUrl).toBe('postgresql://localhost:5432/db');
            expect(fullOptions.jwtSecret).toBe('secret');
        });
    });

    describe('SqlExecutionResult', () => {
        test('SqlSuccessResponse is array of records', () => {
            const success: SqlSuccessResponse = [
                { id: 1, name: 'test' },
                { id: 2, name: 'test2' },
            ];
            expect(Array.isArray(success)).toBe(true);
            expect(success.length).toBe(2);
        });

        test('SqlErrorResponse has error object', () => {
            const error: SqlErrorResponse = {
                error: {
                    message: 'Test error',
                    code: 'TEST001',
                    details: 'Some details',
                    hint: 'Try this',
                },
            };
            expect(error.error.message).toBe('Test error');
            expect(error.error.code).toBe('TEST001');
        });

        test('SqlExecutionResult can be either type', () => {
            const successResult: SqlExecutionResult = [{ id: 1 }];
            const errorResult: SqlExecutionResult = {
                error: { message: 'error' },
            };

            // Type narrowing
            if ('error' in errorResult) {
                expect(errorResult.error.message).toBe('error');
            }
            if (Array.isArray(successResult)) {
                expect(successResult[0].id).toBe(1);
            }
        });
    });

    describe('AuthUser', () => {
        test('can create valid AuthUser object', () => {
            const user: AuthUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                email: 'test@example.com',
                role: 'authenticated',
                created_at: '2024-01-01T00:00:00Z',
                last_sign_in_at: '2024-01-02T00:00:00Z',
                raw_app_meta_data: { provider: 'email' },
                raw_user_meta_data: { name: 'Test User' },
            };
            expect(user.id).toBe('123e4567-e89b-12d3-a456-426614174000');
            expect(user.email).toBe('test@example.com');
        });

        test('nullable fields can be null', () => {
            const user: AuthUser = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                email: null,
                role: null,
                created_at: null,
                last_sign_in_at: null,
                raw_app_meta_data: null,
                raw_user_meta_data: null,
            };
            expect(user.email).toBeNull();
            expect(user.role).toBeNull();
        });
    });

    describe('StorageBucket', () => {
        test('can create valid StorageBucket object', () => {
            const bucket: StorageBucket = {
                id: 'avatars',
                name: 'avatars',
                owner: '123e4567-e89b-12d3-a456-426614174000',
                public: true,
                avif_autodetection: false,
                file_size_limit: 5242880,
                allowed_mime_types: ['image/png', 'image/jpeg'],
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };
            expect(bucket.id).toBe('avatars');
            expect(bucket.public).toBe(true);
        });

        test('nullable fields can be null', () => {
            const bucket: StorageBucket = {
                id: 'documents',
                name: 'documents',
                owner: null,
                public: false,
                avif_autodetection: false,
                file_size_limit: null,
                allowed_mime_types: null,
                created_at: null,
                updated_at: null,
            };
            expect(bucket.owner).toBeNull();
            expect(bucket.file_size_limit).toBeNull();
        });
    });

    describe('StorageObject', () => {
        test('can create valid StorageObject object', () => {
            const obj: StorageObject = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: 'image.png',
                bucket_id: 'avatars',
                owner: '123e4567-e89b-12d3-a456-426614174001',
                version: '1',
                mimetype: 'image/png',
                size: 1024,
                metadata: { contentType: 'image/png' },
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
                last_accessed_at: '2024-01-02T00:00:00Z',
            };
            expect(obj.name).toBe('image.png');
            expect(obj.size).toBe(1024);
        });

        test('nullable fields can be null', () => {
            const obj: StorageObject = {
                id: '123e4567-e89b-12d3-a456-426614174000',
                name: null,
                bucket_id: 'documents',
                owner: null,
                version: null,
                mimetype: null,
                size: null,
                metadata: null,
                created_at: null,
                updated_at: null,
                last_accessed_at: null,
            };
            expect(obj.name).toBeNull();
            expect(obj.size).toBeNull();
        });
    });
});
