/**
 * Test setup file for Bun test runner.
 * This file is preloaded before all tests run.
 */

// Global test setup - mock environment variables
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
