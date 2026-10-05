/**
 * G2X Production Authentication Adapter
 *
 * Direct OAuth 2.1 transport — no govcon CLI dependency in production.
 *
 * Authentication model:
 * - Access tokens: 24-hour lifetime, Bearer type
 * - Refresh tokens: Rotated on each refresh (new one issued)
 * - Token endpoint: Clerk-hosted at g2x.com/__clerk/oauth/token
 * - Scopes: openid, offline_access
 *
 * Initial authorization requires interactive browser OAuth
 * (govcon login or manual flow). After that, the refresh token
 * maintains the session indefinitely.
 *
 * Railway deployment:
 * - Store refresh_token + client_id in Railway secrets
 * - On startup, refresh to get fresh access_token
 * - Auto-refresh before expiry (proactive, not reactive)
 * - On refresh failure: G2X_AUTH_REQUIRED, no retry storm
 *
 * Security invariants:
 * - Tokens NEVER logged, committed, or passed to agents
 * - Agents cannot access auth material
 * - Fail closed: no fallback to unauthenticated access
 * - G2X outage does NOT break SAM collection
 */

import { logger } from '../../lib/logger.js';

const log = logger.child({ service: 'G2XAuth' });

const TOKEN_REFRESH_MARGIN_MS = 60 * 60 * 1000; // Refresh 1 hour before expiry
const MAX_REFRESH_ATTEMPTS = 2;

// ============================================================
// Types
// ============================================================

export interface G2XCredentials {
  /** OAuth client ID from dynamic registration */
  clientId: string;
  /** Token endpoint URL */
  tokenEndpoint: string;
  /** Current refresh token (rotated on each refresh) */
  refreshToken: string;
}

export interface G2XSession {
  /** Current access token (NEVER log this) */
  accessToken: string;
  /** Token type (always 'bearer') */
  tokenType: string;
  /** Expiry timestamp (epoch ms) */
  expiresAt: number;
  /** Current refresh token (rotated on each refresh) */
  refreshToken: string;
  /** Scopes granted */
  scopes: string;
}

export type G2XAuthStatus =
  | { state: 'AUTHENTICATED'; session: G2XSession }
  | { state: 'G2X_AUTH_REQUIRED'; reason: string }
  | { state: 'G2X_UNAVAILABLE'; reason: string };

/** Callback to persist rotated refresh token */
export type TokenPersistCallback = (
  newRefreshToken: string,
  newAccessToken: string,
  expiresAt: number
) => Promise<void>;

// ============================================================
// Auth Adapter
// ============================================================

export class G2XAuthAdapter {
  private session: G2XSession | null = null;
  private credentials: G2XCredentials | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private onTokenRotated: TokenPersistCallback | null = null;
  private refreshInProgress: Promise<G2XAuthStatus> | null = null;

  /**
   * Initialize from environment variables.
   *
   * Required env vars (Railway secrets):
   * - G2X_REFRESH_TOKEN: OAuth refresh token
   * - G2X_CLIENT_ID: OAuth client ID
   * - G2X_TOKEN_ENDPOINT: Token endpoint URL (defaults to Clerk)
   *
   * Returns G2X_AUTH_REQUIRED if credentials are missing.
   */
  async initialize(onTokenRotated?: TokenPersistCallback): Promise<G2XAuthStatus> {
    this.onTokenRotated = onTokenRotated || null;

    const refreshToken = process.env.G2X_REFRESH_TOKEN;
    const clientId = process.env.G2X_CLIENT_ID;
    const tokenEndpoint = process.env.G2X_TOKEN_ENDPOINT || 'https://g2x.com/__clerk/oauth/token';

    if (!refreshToken || !clientId) {
      const missing = [];
      if (!refreshToken) missing.push('G2X_REFRESH_TOKEN');
      if (!clientId) missing.push('G2X_CLIENT_ID');
      log.warn({ missing }, 'G2X credentials not configured — G2X enrichment unavailable');
      return {
        state: 'G2X_AUTH_REQUIRED',
        reason:
          `Missing environment variables: ${missing.join(', ')}. ` +
          'Run govcon login on a machine with a browser, then copy the refresh_token and client_id to Railway secrets.',
      };
    }

    this.credentials = { clientId, tokenEndpoint, refreshToken };

    // Immediately refresh to get a fresh access token
    return this.refresh();
  }

  /**
   * Initialize from explicit credentials (for testing or migration).
   * Credentials are NOT logged.
   */
  async initializeFromCredentials(
    credentials: G2XCredentials,
    onTokenRotated?: TokenPersistCallback
  ): Promise<G2XAuthStatus> {
    this.onTokenRotated = onTokenRotated || null;
    this.credentials = { ...credentials };
    return this.refresh();
  }

  /**
   * Get current auth status.
   * Returns AUTHENTICATED with valid session, or failure state.
   */
  getStatus(): G2XAuthStatus {
    if (!this.session) {
      return {
        state: 'G2X_AUTH_REQUIRED',
        reason: 'No active session — call initialize() first',
      };
    }

    if (Date.now() >= this.session.expiresAt) {
      return {
        state: 'G2X_AUTH_REQUIRED',
        reason: 'Access token expired — refresh required',
      };
    }

    return { state: 'AUTHENTICATED', session: this.session };
  }

  /**
   * Get a valid access token for making API calls.
   * Auto-refreshes if token is expired or near expiry.
   * Returns null if auth is unavailable (fail closed).
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.credentials) {
      return null;
    }

    // Check if we need to refresh
    if (!this.session || Date.now() >= this.session.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      const result = await this.refresh();
      if (result.state !== 'AUTHENTICATED') {
        return null;
      }
    }

    return this.session?.accessToken || null;
  }

  /**
   * Get authorization headers for G2X API calls.
   * Returns null if auth is unavailable.
   */
  async getAuthHeaders(): Promise<Record<string, string> | null> {
    const token = await this.getAccessToken();
    if (!token) return null;

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
  }

  /**
   * Refresh the access token using the refresh token.
   * Handles token rotation (new refresh token on each refresh).
   *
   * Fail-closed:
   * - Max 2 refresh attempts
   * - No infinite retry loop
   * - Returns structured failure on auth expiry
   */
  async refresh(): Promise<G2XAuthStatus> {
    // Deduplicate concurrent refresh calls
    if (this.refreshInProgress) {
      return this.refreshInProgress;
    }

    this.refreshInProgress = this.doRefresh();
    try {
      return await this.refreshInProgress;
    } finally {
      this.refreshInProgress = null;
    }
  }

  /**
   * Stop the auto-refresh timer and clear session.
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.session = null;
    this.credentials = null;
    log.info('G2X auth adapter destroyed');
  }

  /**
   * Check if G2X auth is available (non-blocking).
   */
  isAvailable(): boolean {
    return this.session !== null && Date.now() < this.session.expiresAt;
  }

  // ============================================================
  // Internal
  // ============================================================

  private async doRefresh(): Promise<G2XAuthStatus> {
    if (!this.credentials) {
      return {
        state: 'G2X_AUTH_REQUIRED',
        reason: 'No credentials configured',
      };
    }

    for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt++) {
      try {
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.credentials.refreshToken,
          client_id: this.credentials.clientId,
        });

        const response = await fetch(this.credentials.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const error = (body as Record<string, string>).error || 'unknown';
          const desc = (body as Record<string, string>).error_description || '';

          // Non-retryable auth errors
          if (response.status === 400 || response.status === 401 || error === 'invalid_grant') {
            log.error(
              {
                status: response.status,
                error,
                // NEVER log token values
              },
              'G2X refresh token invalid or revoked — reauthorization required'
            );
            this.session = null;
            return {
              state: 'G2X_AUTH_REQUIRED',
              reason:
                `Refresh token invalid (${error}): ${desc}. ` +
                'Run govcon login to reauthorize, then update G2X_REFRESH_TOKEN in Railway.',
            };
          }

          // Transient server error — retry
          if (attempt < MAX_REFRESH_ATTEMPTS - 1) {
            log.warn({ status: response.status, attempt }, 'G2X token refresh failed, retrying');
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }

          return {
            state: 'G2X_UNAVAILABLE',
            reason: `Token refresh failed after ${MAX_REFRESH_ATTEMPTS} attempts (HTTP ${response.status})`,
          };
        }

        const tokenData = (await response.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
          token_type: string;
          scope: string;
        };

        const expiresAt = Date.now() + tokenData.expires_in * 1000;

        this.session = {
          accessToken: tokenData.access_token,
          tokenType: tokenData.token_type,
          expiresAt,
          refreshToken: tokenData.refresh_token,
          scopes: tokenData.scope,
        };

        // Update credentials with rotated refresh token
        this.credentials.refreshToken = tokenData.refresh_token;

        // Persist rotated tokens (for Railway restart resilience)
        if (this.onTokenRotated) {
          try {
            await this.onTokenRotated(tokenData.refresh_token, tokenData.access_token, expiresAt);
          } catch (persistError) {
            log.error(
              {
                error: persistError instanceof Error ? persistError.message : String(persistError),
              },
              'Failed to persist rotated G2X tokens — session valid but restart may require reauth'
            );
          }
        }

        // Schedule proactive refresh
        this.scheduleRefresh(tokenData.expires_in);

        log.info(
          {
            expiresIn: tokenData.expires_in,
            scopes: tokenData.scope,
            // NEVER log tokens
          },
          'G2X access token refreshed'
        );

        return { state: 'AUTHENTICATED', session: this.session };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt < MAX_REFRESH_ATTEMPTS - 1) {
          log.warn({ error: message, attempt }, 'G2X token refresh network error, retrying');
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        log.error({ error: message }, 'G2X token refresh failed — network error');
        return {
          state: 'G2X_UNAVAILABLE',
          reason: `Network error during token refresh: ${message}`,
        };
      }
    }

    // Should not reach here
    return {
      state: 'G2X_UNAVAILABLE',
      reason: 'Refresh exhausted',
    };
  }

  private scheduleRefresh(expiresInSeconds: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 1 hour before expiry
    const refreshInMs = Math.max(
      expiresInSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS,
      60_000 // At least 1 minute
    );

    this.refreshTimer = setTimeout(() => {
      log.info('Proactive G2X token refresh triggered');
      this.refresh().catch((err) => {
        log.error(
          { error: err instanceof Error ? err.message : String(err) },
          'Proactive G2X token refresh failed'
        );
      });
    }, refreshInMs);

    // Don't let the timer prevent process exit
    if (this.refreshTimer.unref) {
      this.refreshTimer.unref();
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let authAdapter: G2XAuthAdapter | null = null;

/**
 * Get the global G2X auth adapter singleton.
 * Initialize on first call.
 */
export function getG2XAuth(): G2XAuthAdapter {
  if (!authAdapter) {
    authAdapter = new G2XAuthAdapter();
  }
  return authAdapter;
}

/**
 * Reset the singleton (for testing).
 */
export function _resetG2XAuth(): void {
  if (authAdapter) {
    authAdapter.destroy();
    authAdapter = null;
  }
}
