import { z } from 'zod';
import { executeSqlWithFallback, isSqlErrorResponse } from './utils.js';
import type { ToolContext } from './types.js';

// Advisor types
const AdvisorTypeSchema = z.enum(['security', 'performance']);
type AdvisorType = z.infer<typeof AdvisorTypeSchema>;

// Schema for advisor issue output
const AdvisorIssueSchema = z.object({
    code: z.string(),
    name: z.string(),
    level: z.enum(['warning', 'error', 'info']),
    description: z.string(),
    detail: z.string().nullable(),
    remediation: z.string().nullable(),
    affected_object: z.string().nullable(),
});
const GetAdvisorsOutputSchema = z.object({
    issues: z.array(AdvisorIssueSchema),
    type: AdvisorTypeSchema,
    total_count: z.number(),
});
type GetAdvisorsOutput = z.infer<typeof GetAdvisorsOutputSchema>;

// Input schema
const GetAdvisorsInputSchema = z.object({
    type: AdvisorTypeSchema.describe('The type of advisors to retrieve (security or performance)'),
});
type GetAdvisorsInput = z.infer<typeof GetAdvisorsInputSchema>;

// Static JSON Schema for MCP capabilities
const mcpInputSchema = {
    type: 'object',
    properties: {
        type: {
            type: 'string',
            enum: ['security', 'performance'],
            description: 'The type of advisors to retrieve (security or performance)',
        },
    },
    required: ['type'],
};

// SQL queries for security checks (ported from Supabase Splinter)
const securityChecks = {
    // 0013 - RLS disabled in public schema
    rls_disabled_in_public: `
        SELECT
            '0013' as code,
            'rls_disabled_in_public' as name,
            'warning' as level,
            'Tables in the public schema without Row Level Security enabled' as description,
            format('Table: %I.%I', n.nspname, c.relname) as detail,
            'Enable RLS with: ALTER TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ENABLE ROW LEVEL SECURITY;' as remediation,
            format('%I.%I', n.nspname, c.relname) as affected_object
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
            AND n.nspname = 'public'
            AND NOT c.relrowsecurity
            AND c.relname NOT LIKE 'pg_%'
            AND c.relname NOT LIKE '_pg_%'
    `,

    // 0007 - Policy exists but RLS disabled
    policy_exists_rls_disabled: `
        SELECT
            '0007' as code,
            'policy_exists_rls_disabled' as name,
            'warning' as level,
            'Tables with RLS policies defined but RLS is disabled' as description,
            format('Table: %I.%I has policies but RLS is disabled', n.nspname, c.relname) as detail,
            'Enable RLS with: ALTER TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || ' ENABLE ROW LEVEL SECURITY;' as remediation,
            format('%I.%I', n.nspname, c.relname) as affected_object
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
            AND NOT c.relrowsecurity
            AND EXISTS (
                SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid
            )
    `,

    // 0008 - RLS enabled but no policy
    rls_enabled_no_policy: `
        SELECT
            '0008' as code,
            'rls_enabled_no_policy' as name,
            'error' as level,
            'Tables with RLS enabled but no policies defined (blocks all access)' as description,
            format('Table: %I.%I has RLS enabled but no policies', n.nspname, c.relname) as detail,
            'Add a policy or disable RLS if not needed' as remediation,
            format('%I.%I', n.nspname, c.relname) as affected_object
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
            AND c.relrowsecurity
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid
            )
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    `,

    // 0002 - Auth users exposed via view
    auth_users_exposed: `
        SELECT
            '0002' as code,
            'auth_users_exposed' as name,
            'error' as level,
            'Views exposing auth.users data' as description,
            format('View: %I.%I may expose auth.users', n.nspname, c.relname) as detail,
            'Review and restrict the view definition or add proper RLS' as remediation,
            format('%I.%I', n.nspname, c.relname) as affected_object
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_depend d ON d.objid = c.oid
        JOIN pg_catalog.pg_class dep_c ON dep_c.oid = d.refobjid
        JOIN pg_catalog.pg_namespace dep_n ON dep_n.oid = dep_c.relnamespace
        WHERE c.relkind IN ('v', 'm')
            AND n.nspname = 'public'
            AND dep_n.nspname = 'auth'
            AND dep_c.relname = 'users'
    `,
};

// SQL queries for performance checks (ported from Supabase Splinter)
const performanceChecks = {
    // 0001 - Unindexed foreign keys
    unindexed_foreign_keys: `
        SELECT
            '0001' as code,
            'unindexed_foreign_keys' as name,
            'warning' as level,
            'Foreign keys without covering indexes can impact performance' as description,
            format('FK on %I.%I (%s) lacks an index', cn.nspname, c.conrelid::regclass::text,
                array_to_string(ARRAY(
                    SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, i)
                    JOIN pg_attribute a ON a.attnum = u.attnum AND a.attrelid = c.conrelid
                    ORDER BY u.i
                ), ', ')) as detail,
            'Create an index on the foreign key columns' as remediation,
            c.conrelid::regclass::text as affected_object
        FROM pg_catalog.pg_constraint c
        JOIN pg_catalog.pg_namespace cn ON cn.oid = c.connamespace
        WHERE c.contype = 'f'
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_index i
                WHERE i.indrelid = c.conrelid
                    AND c.conkey <@ i.indkey::int2[]
            )
            AND cn.nspname NOT IN ('pg_catalog', 'information_schema')
    `,

    // 0004 - Missing primary keys
    missing_primary_keys: `
        SELECT
            '0004' as code,
            'missing_primary_key' as name,
            'warning' as level,
            'Tables without primary keys are inefficient at scale' as description,
            format('Table: %I.%I has no primary key', n.nspname, c.relname) as detail,
            'Add a primary key to the table' as remediation,
            format('%I.%I', n.nspname, c.relname) as affected_object
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
            AND NOT EXISTS (
                SELECT 1 FROM pg_catalog.pg_constraint con
                WHERE con.conrelid = c.oid AND con.contype = 'p'
            )
            AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'cron', 'extensions', 'graphql', 'graphql_public', 'realtime', 'storage', 'supabase_functions', 'supabase_migrations', 'vault', 'pgsodium', 'pgsodium_masks', 'auth', 'net', '_realtime')
    `,

    // 0005 - Unused indexes
    unused_indexes: `
        SELECT
            '0005' as code,
            'unused_index' as name,
            'info' as level,
            'Indexes with zero scans that may be candidates for removal' as description,
            format('Index: %I.%I on %I.%I has had 0 scans', sn.nspname, i.relname, tn.nspname, t.relname) as detail,
            'Consider dropping the index if it is not needed' as remediation,
            format('%I.%I', sn.nspname, i.relname) as affected_object
        FROM pg_catalog.pg_stat_user_indexes s
        JOIN pg_catalog.pg_index ix ON ix.indexrelid = s.indexrelid
        JOIN pg_catalog.pg_class i ON i.oid = s.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = s.relid
        JOIN pg_catalog.pg_namespace sn ON sn.oid = i.relnamespace
        JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
        WHERE s.idx_scan = 0
            AND NOT ix.indisunique
            AND NOT ix.indisprimary
            AND sn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    `,

    // 0009 - Duplicate indexes
    duplicate_indexes: `
        SELECT
            '0009' as code,
            'duplicate_index' as name,
            'warning' as level,
            'Duplicate indexes waste storage and slow writes' as description,
            format('Indexes %I and %I on %I.%I have identical definitions',
                i1.relname, i2.relname, tn.nspname, t.relname) as detail,
            'Consider dropping one of the duplicate indexes' as remediation,
            format('%I.%I', sn.nspname, i1.relname) as affected_object
        FROM pg_catalog.pg_index x1
        JOIN pg_catalog.pg_index x2 ON x1.indrelid = x2.indrelid AND x1.indexrelid < x2.indexrelid
        JOIN pg_catalog.pg_class i1 ON i1.oid = x1.indexrelid
        JOIN pg_catalog.pg_class i2 ON i2.oid = x2.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = x1.indrelid
        JOIN pg_catalog.pg_namespace sn ON sn.oid = i1.relnamespace
        JOIN pg_catalog.pg_namespace tn ON tn.oid = t.relnamespace
        WHERE x1.indkey = x2.indkey
            AND x1.indclass = x2.indclass
            AND x1.indoption = x2.indoption
            AND sn.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    `,
};

// Tool definition
export const getAdvisorsTool = {
    name: 'get_advisors',
    description: 'Gets security or performance advisory notices for the database. Based on Supabase Splinter linting rules. Helps identify issues like missing RLS policies, unindexed foreign keys, and other common problems.',
    inputSchema: GetAdvisorsInputSchema,
    mcpInputSchema: mcpInputSchema,
    outputSchema: GetAdvisorsOutputSchema,
    execute: async (input: GetAdvisorsInput, context: ToolContext): Promise<GetAdvisorsOutput> => {
        const client = context.selfhostedClient;
        const { type } = input;

        const checks = type === 'security' ? securityChecks : performanceChecks;
        const allIssues: z.infer<typeof AdvisorIssueSchema>[] = [];

        for (const [checkName, sql] of Object.entries(checks)) {
            try {
                const result = await executeSqlWithFallback(client, sql, true);

                if (isSqlErrorResponse(result)) {
                    context.log(`Error running ${checkName}: ${result.error.message}`, 'warn');
                    continue;
                }

                if (Array.isArray(result)) {
                    for (const row of result) {
                        allIssues.push({
                            code: String(row.code || ''),
                            name: String(row.name || checkName),
                            level: (row.level as 'warning' | 'error' | 'info' | undefined) ?? 'warning',
                            description: String(row.description || ''),
                            detail: row.detail ? String(row.detail) : null,
                            remediation: row.remediation ? String(row.remediation) : null,
                            affected_object: row.affected_object ? String(row.affected_object) : null,
                        });
                    }
                }
            } catch (error) {
                context.log(`Failed to run ${checkName}: ${error}`, 'warn');
            }
        }

        // Sort by level (error first, then warning, then info)
        const levelOrder = { error: 0, warning: 1, info: 2 };
        allIssues.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

        return {
            issues: allIssues,
            type,
            total_count: allIssues.length,
        };
    },
};
