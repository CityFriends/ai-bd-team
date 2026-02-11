/**
 * Test setup and mocking utilities for database module tests
 */
import { vi } from 'vitest';

// Mock Supabase query builder - chainable methods that return themselves
export function createMockQueryBuilder(data: unknown = null, error: unknown = null) {
  const builder: Record<string, unknown> = {};

  // All chainable methods return the builder
  const chainableMethods = [
    'from',
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'not',
    'is',
    'order',
    'limit',
    'range',
    'match',
    'filter',
    'or',
    'and',
  ];

  chainableMethods.forEach((method) => {
    builder[method] = vi.fn().mockReturnValue(builder);
  });

  // Terminal method that returns the result
  builder.single = vi.fn().mockResolvedValue({ data, error });

  // For queries that return arrays
  builder.then = vi.fn().mockImplementation((resolve) => {
    resolve({ data: Array.isArray(data) ? data : data ? [data] : [], error });
  });

  return builder;
}

// Create a mock Supabase client
export function createMockSupabaseClient(
  defaultData: unknown = null,
  defaultError: unknown = null
) {
  const queryBuilder = createMockQueryBuilder(defaultData, defaultError);

  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    rpc: vi.fn().mockResolvedValue({ data: defaultData, error: defaultError }),
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
    // Expose the query builder for assertions
    _queryBuilder: queryBuilder,
  };
}

// Helper to create a mock that returns specific data for specific tables
export function createTableMockSupabaseClient(
  tableData: Record<string, { data?: unknown; error?: unknown }>
) {
  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      const tableConfig = tableData[table] || { data: null, error: null };
      return createMockQueryBuilder(tableConfig.data, tableConfig.error);
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return client;
}

// Sample test data factories
export const testData = {
  opportunity: (overrides = {}) => ({
    id: 'opp-123',
    sam_id: 'SAM-456',
    title: 'Test Opportunity',
    agency: 'Test Agency',
    status: 'new',
    score: 75,
    due_date: '2024-12-31',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),

  queueItem: (overrides = {}) => ({
    id: 'queue-123',
    agent: 'maya',
    action: 'scan',
    status: 'pending',
    scheduled_for: '2024-01-01T10:00:00Z',
    payload: {},
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),

  workflow: (overrides = {}) => ({
    id: 'workflow-123',
    notice_id: 'notice-456',
    title: 'Test Workflow',
    stage: 'found',
    agent_responsible: 'maya',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),

  userProfile: (overrides = {}) => ({
    id: 'user-123',
    slack_user_id: 'U12345',
    user_name: 'testuser',
    display_name: 'Test User',
    role: 'BD Manager',
    communication_style: 'balanced',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),

  thread: (overrides = {}) => ({
    id: 'thread-123',
    slack_thread_ts: '1234567890.123456',
    channel_id: 'C12345',
    topic: 'Test Thread',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),

  threadSummary: (overrides = {}) => ({
    id: 'summary-123',
    thread_ts: '1234567890.123456',
    channel_id: 'C12345',
    summary: 'Test summary of the thread',
    message_count: 5,
    participants: ['U12345', 'U67890'],
    key_topics: ['opportunity', 'research'],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }),
};
