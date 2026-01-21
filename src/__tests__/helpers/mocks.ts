/**
 * Shared test mocks and helpers for the selfhosted-supabase-mcp test suite.
 */

import { mock } from 'bun:test';
import type { SelfhostedSupabaseClient } from '../../client/index.js';
import type { ToolContext } from '../../tools/types.js';
import type { SqlExecutionResult, SqlSuccessResponse, SqlErrorResponse } from '../../types/index.js';

/**
 * Options for creating a mock SelfhostedSupabaseClient
 */
export interface MockClientOptions {
    pgAvailable?: boolean;
    serviceRoleAvailable?: boolean;
    rpcResult?: SqlExecutionResult;
    pgResult?: SqlExecutionResult;
    serviceRoleRpcResult?: SqlExecutionResult;
    supabaseUrl?: string;
    anonKey?: string;
    serviceRoleKey?: string;
    jwtSecret?: string;
    dbUrl?: string;
    supabaseClient?: MockSupabaseClient;
}

/**
 * Mock Supabase client type for auth operations
 */
export interface MockSupabaseClient {
    auth: {
        admin: {
            listUsers: ReturnType<typeof mock>;
            getUserById: ReturnType<typeof mock>;
            createUser: ReturnType<typeof mock>;
            updateUserById: ReturnType<typeof mock>;
            deleteUser: ReturnType<typeof mock>;
        };
    };
    rpc: ReturnType<typeof mock>;
}

/**
 * Creates a mock Supabase client with configurable auth admin methods
 */
export function createMockSupabaseClient(overrides?: Partial<MockSupabaseClient>): MockSupabaseClient {
    return {
        auth: {
            admin: {
                listUsers: mock(() => Promise.resolve({ data: { users: [] }, error: null })),
                getUserById: mock(() => Promise.resolve({ data: { user: null }, error: null })),
                createUser: mock(() => Promise.resolve({ data: { user: null }, error: null })),
                updateUserById: mock(() => Promise.resolve({ data: { user: null }, error: null })),
                deleteUser: mock(() => Promise.resolve({ data: null, error: null })),
                ...overrides?.auth?.admin,
            },
        },
        rpc: mock(() => Promise.resolve({ data: [], error: null })),
        ...overrides,
    };
}

/**
 * Creates a mock SelfhostedSupabaseClient for testing tools
 */
export function createMockClient(options: MockClientOptions = {}): SelfhostedSupabaseClient {
    const {
        pgAvailable = true,
        serviceRoleAvailable = true,
        rpcResult = [] as SqlSuccessResponse,
        pgResult = [] as SqlSuccessResponse,
        serviceRoleRpcResult = [] as SqlSuccessResponse,
        supabaseUrl = 'https://test.supabase.co',
        anonKey = 'test-anon-key',
        serviceRoleKey = 'test-service-role-key',
        jwtSecret = 'test-jwt-secret',
        dbUrl = 'postgresql://test:test@localhost:5432/test',
        supabaseClient = createMockSupabaseClient(),
    } = options;

    // Create a mock that satisfies the SelfhostedSupabaseClient interface
    const mockClient = {
        supabase: supabaseClient,

        executeSqlViaRpc: mock(async (_query: string, _readOnly?: boolean) => rpcResult),
        executeSqlWithPg: mock(async (_query: string) => pgResult),
        executeSqlViaServiceRoleRpc: mock(async (_query: string, _readOnly?: boolean) => serviceRoleRpcResult),
        executeTransactionWithPg: mock(async <T>(callback: (client: unknown) => Promise<T>) => {
            const mockPgClient = {
                query: mock(() => Promise.resolve({ rows: [] })),
            };
            return callback(mockPgClient);
        }),

        isPgAvailable: () => pgAvailable,
        isServiceRoleAvailable: () => serviceRoleAvailable,
        getSupabaseUrl: () => supabaseUrl,
        getAnonKey: () => anonKey,
        getServiceRoleKey: () => (serviceRoleKey ? serviceRoleKey : undefined),
        getJwtSecret: () => (jwtSecret ? jwtSecret : undefined),
        getDbUrl: () => (pgAvailable ? dbUrl : undefined),
    } as unknown as SelfhostedSupabaseClient;

    return mockClient;
}

/**
 * Creates a mock ToolContext for testing tool execute functions
 */
export function createMockContext(client?: SelfhostedSupabaseClient): ToolContext {
    return {
        selfhostedClient: client ?? createMockClient(),
        log: mock((_message: string, _level?: 'info' | 'warn' | 'error') => {}),
        workspacePath: '/test/workspace',
    };
}

/**
 * Creates a SQL success response
 */
export function createSuccessResponse(rows: Record<string, unknown>[]): SqlSuccessResponse {
    return rows;
}

/**
 * Creates a SQL error response
 */
export function createErrorResponse(
    message: string,
    code?: string,
    details?: string,
    hint?: string
): SqlErrorResponse {
    return {
        error: {
            message,
            code,
            details,
            hint,
        },
    };
}

/**
 * Sample test data for various entity types
 */
export const testData = {
    users: [
        {
            id: '550e8400-e29b-41d4-a716-446655440001',
            email: 'test1@example.com',
            role: 'authenticated',
            created_at: '2024-01-01T00:00:00Z',
            last_sign_in_at: '2024-01-15T12:00:00Z',
            raw_app_meta_data: { provider: 'email' },
            raw_user_meta_data: { name: 'Test User 1' },
        },
        {
            id: '550e8400-e29b-41d4-a716-446655440002',
            email: 'test2@example.com',
            role: 'authenticated',
            created_at: '2024-01-02T00:00:00Z',
            last_sign_in_at: null,
            raw_app_meta_data: {},
            raw_user_meta_data: {},
        },
    ],

    tables: [
        {
            table_schema: 'public',
            table_name: 'users',
            table_type: 'BASE TABLE',
            is_insertable_into: 'YES',
        },
        {
            table_schema: 'public',
            table_name: 'posts',
            table_type: 'BASE TABLE',
            is_insertable_into: 'YES',
        },
    ],

    extensions: [
        { name: 'plpgsql', installed_version: '1.0', comment: 'PL/pgSQL procedural language' },
        { name: 'uuid-ossp', installed_version: '1.1', comment: 'generate universally unique identifiers' },
    ],

    buckets: [
        {
            id: 'bucket-1',
            name: 'avatars',
            owner: null,
            public: true,
            avif_autodetection: false,
            file_size_limit: 5242880,
            allowed_mime_types: ['image/png', 'image/jpeg'],
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
        },
    ],

    storageObjects: [
        {
            id: '550e8400-e29b-41d4-a716-446655440003',
            name: 'avatar.png',
            bucket_id: 'avatars',
            owner: '550e8400-e29b-41d4-a716-446655440001',
            version: null,
            mimetype: 'image/png',
            size: 1024,
            metadata: { mimetype: 'image/png', size: 1024 },
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            last_accessed_at: null,
        },
    ],

    migrations: [
        {
            version: '20240101000000',
            name: 'initial_schema',
            executed_at: '2024-01-01T00:00:00Z',
        },
    ],

    connections: [
        {
            pid: 12345,
            usename: 'postgres',
            datname: 'postgres',
            client_addr: '127.0.0.1',
            state: 'active',
            query: 'SELECT 1',
            backend_start: '2024-01-01T00:00:00Z',
        },
    ],
};

/**
 * Helper to create Express-like request/response mocks for middleware testing
 */
export function createMockExpressReqRes() {
    const req = {
        headers: {} as Record<string, string>,
        user: undefined as unknown,
    };

    const res = {
        statusCode: 200,
        jsonBody: null as unknown,
        status: mock(function(this: typeof res, code: number) {
            this.statusCode = code;
            return this;
        }),
        json: mock(function(this: typeof res, body: unknown) {
            this.jsonBody = body;
            return this;
        }),
    };

    const next = mock(() => {});

    return { req, res, next };
}
