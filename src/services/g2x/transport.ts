/**
 * G2X Production MCP Transport
 *
 * Direct HTTP JSON-RPC transport to G2X MCP research endpoint.
 * Uses G2XAuthAdapter for automatic token management.
 *
 * No govcon CLI dependency — suitable for Railway deployment.
 *
 * Critical invariant: G2X outage does NOT break SAM collection.
 * Returns structured G2X_AUTH_REQUIRED or G2X_UNAVAILABLE on failure.
 */

import { logger } from '../../lib/logger.js';
import { G2XAuthAdapter, getG2XAuth } from './auth.js';
import type {
  G2XFailure,
  MCPToolCallRequest,
  MCPToolCallResponse,
  MCPToolDefinition,
} from './types.js';

const log = logger.child({ service: 'G2XTransport' });

const G2X_RESEARCH_ENDPOINT = 'https://mcp.g2x.com/mcp/research';

/**
 * Make an authenticated JSON-RPC call to G2X MCP.
 * Returns structured failure on auth/network errors.
 * Never throws — always returns a result or failure.
 */
async function mcpCall(
  method: string,
  params: Record<string, unknown> | undefined,
  auth: G2XAuthAdapter,
  endpoint: string = G2X_RESEARCH_ENDPOINT
): Promise<Record<string, unknown> | G2XFailure> {
  const headers = await auth.getAuthHeaders();
  if (!headers) {
    return {
      type: 'AUTHENTICATION_FAILURE',
      message: 'G2X authentication unavailable — enrichment skipped',
    };
  }

  const startTime = Date.now();

  try {
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
      id: Date.now(),
    };
    if (params) body.params = params;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const latencyMs = Date.now() - startTime;

    if (response.status === 401) {
      // Token may have been revoked — try one refresh
      log.warn('G2X 401 — attempting token refresh');
      const refreshResult = await auth.refresh();
      if (refreshResult.state !== 'AUTHENTICATED') {
        return {
          type: 'AUTHENTICATION_FAILURE',
          message: `G2X reauthorization required: ${refreshResult.reason}`,
          httpStatus: 401,
        };
      }

      // Retry with new token
      const retryHeaders = await auth.getAuthHeaders();
      if (!retryHeaders) {
        return {
          type: 'AUTHENTICATION_FAILURE',
          message: 'G2X authentication failed after refresh',
          httpStatus: 401,
        };
      }

      const retryResponse = await fetch(endpoint, {
        method: 'POST',
        headers: retryHeaders,
        body: JSON.stringify(body),
      });

      if (!retryResponse.ok) {
        return classifyHttpFailure(retryResponse.status, method);
      }

      const retryData = (await retryResponse.json()) as {
        result?: Record<string, unknown>;
        error?: { code: number; message: string };
      };

      if (retryData.error) {
        return {
          type: 'PROVIDER_UNAVAILABLE',
          message: `MCP error: ${retryData.error.message}`,
          httpStatus: retryResponse.status,
        };
      }

      return retryData.result || {};
    }

    if (!response.ok) {
      const failure = classifyHttpFailure(response.status, method);
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
          failure.retryAfterSeconds = parseInt(retryAfter, 10) || 60;
        }
      }
      log.error({ status: response.status, method, latencyMs }, 'G2X call failed');
      return failure;
    }

    const data = (await response.json()) as {
      result?: Record<string, unknown>;
      error?: { code: number; message: string };
    };

    if (data.error) {
      return {
        type: 'PROVIDER_UNAVAILABLE',
        message: `MCP error: ${data.error.message}`,
        httpStatus: response.status,
      };
    }

    log.info({ method, latencyMs }, 'G2X call succeeded');
    return data.result || {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message, method }, 'G2X network error');
    return {
      type: 'PROVIDER_UNAVAILABLE',
      message: `Network error: ${message}`,
    };
  }
}

/**
 * Discover tools via tools/list using direct HTTP.
 */
export async function discoverToolsDirect(
  auth: G2XAuthAdapter,
  endpoint: string = G2X_RESEARCH_ENDPOINT
): Promise<{ tools: MCPToolDefinition[] } | G2XFailure> {
  const result = await mcpCall('tools/list', undefined, auth, endpoint);

  if ('type' in result && 'message' in result) {
    return result as G2XFailure;
  }

  const tools = (result as { tools?: MCPToolDefinition[] }).tools || [];
  return { tools };
}

/**
 * Call an MCP tool via direct HTTP.
 */
export async function callToolDirect(
  auth: G2XAuthAdapter,
  request: MCPToolCallRequest,
  endpoint: string = G2X_RESEARCH_ENDPOINT
): Promise<MCPToolCallResponse | G2XFailure> {
  const result = await mcpCall(
    'tools/call',
    { name: request.name, arguments: request.arguments },
    auth,
    endpoint
  );

  if ('type' in result && 'message' in result) {
    return result as G2XFailure;
  }

  // MCP tool call results have content array
  return result as unknown as MCPToolCallResponse;
}

/**
 * Check if G2X is available without making a data call.
 * Uses the auth adapter's token state.
 */
export function isG2XAvailable(): boolean {
  return getG2XAuth().isAvailable();
}

// ============================================================
// HTTP Failure Classification
// ============================================================

function classifyHttpFailure(status: number, method: string): G2XFailure {
  if (status === 401) {
    return {
      type: 'AUTHENTICATION_FAILURE',
      message: `Authentication failed (401) for ${method}`,
      httpStatus: status,
    };
  }
  if (status === 403) {
    return {
      type: 'AUTHORIZATION_FAILURE',
      message: `Authorization denied (403) for ${method}`,
      httpStatus: status,
    };
  }
  if (status === 429) {
    return {
      type: 'RATE_LIMITED',
      message: `Rate limited (429) for ${method}`,
      httpStatus: status,
    };
  }
  if (status === 400 || status === 422) {
    return {
      type: 'MALFORMED_REQUEST',
      message: `Bad request (${status}) for ${method}`,
      httpStatus: status,
    };
  }
  if (status >= 500) {
    return {
      type: 'PROVIDER_UNAVAILABLE',
      message: `Server error (${status}) for ${method}`,
      httpStatus: status,
    };
  }
  return {
    type: 'PROVIDER_UNAVAILABLE',
    message: `HTTP ${status} for ${method}`,
    httpStatus: status,
  };
}
