/**
 * LLM Gateway Routing
 *
 * Task-type-based model routing. The control plane decides which
 * provider/model handles each request — not individual agents.
 *
 * Includes max_input_tokens to bound reservation calculations.
 */

import type { ModelRoute, TaskType, Provider } from './types.js';
import { RouteNotFoundError } from './errors.js';

/** Default routes — used only if DB routes haven't been loaded yet */
const DEFAULT_ROUTES: ModelRoute[] = [
  {
    taskType: 'classify',
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    maxOutputTokens: 256,
    maxInputTokens: 8000,
    maxCostUsd: 0.01,
    enabled: true,
  },
  {
    taskType: 'extract',
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    maxOutputTokens: 512,
    maxInputTokens: 8000,
    maxCostUsd: 0.02,
    enabled: true,
  },
  {
    taskType: 'summarize',
    provider: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    maxOutputTokens: 512,
    maxInputTokens: 16000,
    maxCostUsd: 0.02,
    enabled: true,
  },
  {
    taskType: 'research',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 2048,
    maxInputTokens: 16000,
    maxCostUsd: 0.1,
    enabled: true,
  },
  {
    taskType: 'reason',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 1024,
    maxInputTokens: 16000,
    maxCostUsd: 0.08,
    enabled: true,
  },
  {
    taskType: 'write',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 2048,
    maxInputTokens: 16000,
    maxCostUsd: 0.1,
    enabled: true,
  },
  {
    taskType: 'review',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxOutputTokens: 1024,
    maxInputTokens: 16000,
    maxCostUsd: 0.08,
    enabled: true,
  },
  {
    taskType: 'embed',
    provider: 'openai',
    model: 'text-embedding-3-small',
    maxOutputTokens: 0,
    maxInputTokens: 30000,
    maxCostUsd: 0.005,
    enabled: true,
  },
];

let routeCache: Map<TaskType, ModelRoute> = new Map();
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function initDefaults(): void {
  routeCache = new Map();
  for (const r of DEFAULT_ROUTES) {
    routeCache.set(r.taskType, r);
  }
}

initDefaults();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refreshRoutes(supabase: any): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('ai_model_routing')
      .select(
        'task_type, provider, model, max_output_tokens, max_input_tokens, max_cost_usd, enabled'
      );

    if (error || !data || data.length === 0) return;

    const newCache = new Map<TaskType, ModelRoute>();
    for (const row of data) {
      newCache.set(row.task_type as TaskType, {
        taskType: row.task_type as TaskType,
        provider: row.provider as Provider,
        model: row.model,
        maxOutputTokens: row.max_output_tokens,
        maxInputTokens: row.max_input_tokens || 16000,
        maxCostUsd: row.max_cost_usd ? Number(row.max_cost_usd) : null,
        enabled: row.enabled,
      });
    }

    routeCache = newCache;
    lastRefresh = Date.now();
  } catch {
    // Keep existing cache
  }
}

export function getRoute(taskType: TaskType): ModelRoute {
  const route = routeCache.get(taskType);
  if (!route || !route.enabled) throw new RouteNotFoundError(taskType);
  return route;
}

export function needsRefresh(): boolean {
  return Date.now() - lastRefresh > REFRESH_INTERVAL_MS;
}

export function _resetRoutingCache(): void {
  initDefaults();
  lastRefresh = 0;
}
