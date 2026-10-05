/**
 * G2X MCP Transport Layer
 *
 * Thin fetch-based transport to the G2X research MCP endpoint.
 * Handles OAuth token management and tools/list discovery.
 *
 * Authentication architecture is determined during real connection,
 * not pre-assumed as a static bearer token. If interactive human
 * authorization is required, the client reports this and halts.
 *
 * Tokens are NEVER logged, committed, persisted in evidence,
 * or passed to agents.
 */

import { createHash } from 'crypto';
import { logger } from '../../lib/logger.js';
import type {
  G2XAuthState,
  G2XFailure,
  MCPToolCallRequest,
  MCPToolCallResponse,
  MCPToolDefinition,
  MCPToolsListResponse,
  ToolInventoryEntry,
} from './types.js';

const log = logger.child({ service: 'G2XMCPClient' });

const G2X_RESEARCH_ENDPOINT = 'https://mcp.g2x.com/mcp/research';
const INTEGRATION_VERSION = '0.1.0-commissioning';

// ============================================================
// Auth Management
// ============================================================

/**
 * Resolve G2X authentication state.
 *
 * During commissioning, attempts to use environment-provided credentials.
 * Does NOT assume static bearer token — observes actual OAuth behavior.
 * If interactive authorization is needed, returns that signal.
 */
export function resolveAuthState(): G2XAuthState | G2XFailure {
  // Phase 1: Check for commissioning token in environment
  const token = process.env.G2X_OAUTH_TOKEN;
  const tokenType = process.env.G2X_TOKEN_TYPE || 'Bearer';

  if (!token) {
    log.warn('G2X_OAUTH_TOKEN not set — cannot authenticate');
    return {
      type: 'AUTHENTICATION_FAILURE',
      message:
        'G2X_OAUTH_TOKEN not set. If interactive OAuth authorization is required, ' +
        'a human must complete the authorization flow.',
    };
  }

  // Record scopes if provided (will be verified against actual server response)
  const scopes = process.env.G2X_OAUTH_SCOPES
    ? process.env.G2X_OAUTH_SCOPES.split(',').map((s) => s.trim())
    : [];

  const expiresAt = process.env.G2X_TOKEN_EXPIRES_AT || null;

  // Check if token appears expired
  if (expiresAt) {
    const expiryDate = new Date(expiresAt);
    if (expiryDate <= new Date()) {
      log.warn({ expiresAt }, 'G2X token appears expired');
      return {
        type: 'AUTHENTICATION_FAILURE',
        message: `G2X token expired at ${expiresAt}. Refresh or re-authorization required.`,
      };
    }
  }

  log.info(
    {
      tokenType,
      scopeCount: scopes.length,
      hasExpiry: !!expiresAt,
      // NEVER log the token itself
    },
    'G2X auth state resolved from environment'
  );

  return {
    accessToken: token,
    tokenType,
    expiresAt,
    refreshToken: process.env.G2X_REFRESH_TOKEN || null,
    scopes,
    interactiveAuthRequired: false,
  };
}

/**
 * Type guard: is the auth result a failure?
 */
export function isAuthFailure(result: G2XAuthState | G2XFailure): result is G2XFailure {
  return 'type' in result && !('accessToken' in result);
}

// ============================================================
// Schema Hashing
// ============================================================

/**
 * Compute a stable SHA-256 hash of a canonicalized input schema.
 * Used for schema change detection across discoveries.
 */
export function computeSchemaHash(schema: Record<string, unknown>): string {
  const canonical = JSON.stringify(sortDeep(schema));
  return createHash('sha256').update(canonical).digest('hex');
}

function sortDeep(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortDeep);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortDeep((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

// ============================================================
// MCP Transport
// ============================================================

/**
 * Call the MCP tools/list endpoint to discover available tools.
 * Returns raw tool definitions — classification is done separately.
 */
export async function discoverTools(
  auth: G2XAuthState,
  endpoint: string = G2X_RESEARCH_ENDPOINT
): Promise<{ tools: MCPToolDefinition[] } | G2XFailure> {
  const url = `${endpoint}`;

  log.info({ endpoint }, 'Discovering G2X tools via tools/list');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `${auth.tokenType} ${auth.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    if (!response.ok) {
      const failure = classifyHttpFailure(response.status, 'tools/list');
      log.error({ status: response.status, tool: 'tools/list' }, 'tools/list discovery failed');
      return failure;
    }

    const body = (await response.json()) as {
      result?: MCPToolsListResponse;
      error?: { code: number; message: string };
    };

    if (body.error) {
      log.error({ error: body.error }, 'MCP error in tools/list response');
      return {
        type: 'PROVIDER_UNAVAILABLE',
        message: `MCP error: ${body.error.message}`,
        httpStatus: response.status,
      };
    }

    const tools = body.result?.tools || [];
    log.info({ toolCount: tools.length }, 'G2X tools discovered');

    return { tools };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Network error during tools/list discovery');
    return {
      type: 'PROVIDER_UNAVAILABLE',
      message: `Network error during discovery: ${message}`,
    };
  }
}

/**
 * Build tool inventory entries from discovered tools.
 * Records full schema snapshots for audit — classification
 * is applied separately by the allowlist module.
 */
export function buildToolInventory(
  tools: MCPToolDefinition[],
  endpoint: string = G2X_RESEARCH_ENDPOINT
): ToolInventoryEntry[] {
  const now = new Date().toISOString();

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    inputSchemaHash: computeSchemaHash(tool.inputSchema),
    // Default: DENIED_UNKNOWN until local policy classifies
    classification: 'DENIED_UNKNOWN' as const,
    classificationReason: 'Awaiting local authorization policy review',
    discoveredAt: now,
    endpoint,
    integrationVersion: INTEGRATION_VERSION,
  }));
}

/**
 * Call a specific MCP tool.
 * Caller is responsible for allowlist enforcement before calling this.
 */
export async function callTool(
  auth: G2XAuthState,
  request: MCPToolCallRequest,
  endpoint: string = G2X_RESEARCH_ENDPOINT
): Promise<MCPToolCallResponse | G2XFailure> {
  const startTime = Date.now();

  log.info({ tool: request.name, endpoint }, 'Calling G2X MCP tool');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `${auth.tokenType} ${auth.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: request.name,
          arguments: request.arguments,
        },
        id: Date.now(),
      }),
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      const failure = classifyHttpFailure(response.status, request.name);
      log.error({ status: response.status, tool: request.name, latencyMs }, 'G2X tool call failed');

      // Extract Retry-After for 429
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          failure.retryAfterSeconds = parseInt(retryAfter, 10) || 60;
        }
      }

      return failure;
    }

    const body = (await response.json()) as {
      result?: MCPToolCallResponse;
      error?: { code: number; message: string };
    };

    if (body.error) {
      log.error(
        { error: body.error, tool: request.name, latencyMs },
        'MCP error in tool call response'
      );
      return {
        type: 'PROVIDER_UNAVAILABLE',
        message: `MCP tool error: ${body.error.message}`,
        httpStatus: response.status,
        toolName: request.name,
      };
    }

    if (!body.result) {
      return {
        type: 'PROVIDER_UNAVAILABLE',
        message: 'Empty result from MCP tool call',
        httpStatus: response.status,
        toolName: request.name,
      };
    }

    log.info(
      {
        tool: request.name,
        latencyMs,
        contentParts: body.result.content?.length || 0,
        isError: body.result.isError || false,
      },
      'G2X tool call completed'
    );

    return body.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latencyMs = Date.now() - startTime;
    log.error({ error: message, tool: request.name, latencyMs }, 'Network error during tool call');
    return {
      type: 'PROVIDER_UNAVAILABLE',
      message: `Network error calling ${request.name}: ${message}`,
      toolName: request.name,
    };
  }
}

// ============================================================
// HTTP Failure Classification
// ============================================================

function classifyHttpFailure(status: number, toolName: string): G2XFailure {
  if (status === 401) {
    return {
      type: 'AUTHENTICATION_FAILURE',
      message: `Authentication failed (401) calling ${toolName}`,
      httpStatus: status,
      toolName,
    };
  }
  if (status === 403) {
    return {
      type: 'AUTHORIZATION_FAILURE',
      message: `Authorization denied (403) calling ${toolName}`,
      httpStatus: status,
      toolName,
    };
  }
  if (status === 429) {
    return {
      type: 'RATE_LIMITED',
      message: `Rate limited (429) calling ${toolName}`,
      httpStatus: status,
      toolName,
    };
  }
  if (status === 400 || status === 422) {
    return {
      type: 'MALFORMED_REQUEST',
      message: `Bad request (${status}) calling ${toolName}`,
      httpStatus: status,
      toolName,
    };
  }
  if (status >= 500) {
    return {
      type: 'PROVIDER_UNAVAILABLE',
      message: `Server error (${status}) calling ${toolName}`,
      httpStatus: status,
      toolName,
    };
  }
  return {
    type: 'PROVIDER_UNAVAILABLE',
    message: `HTTP ${status} calling ${toolName}`,
    httpStatus: status,
    toolName,
  };
}

/**
 * Check if a G2X failure is retryable (transient).
 */
export function isRetryableFailure(failure: G2XFailure): boolean {
  return failure.type === 'RATE_LIMITED' || failure.type === 'PROVIDER_UNAVAILABLE';
}
