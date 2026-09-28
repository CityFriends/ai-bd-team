/**
 * LLM Gateway Usage Reporting
 *
 * Deterministic cost reporting queries against the authoritative inference ledger.
 */

/** Spend summary for a given scope/period */
export interface SpendSummary {
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  reservedUsd: number;
  settledUsd: number;
  failedUsd: number;
  ambiguousUsd: number;
}

/** Breakdown entry */
export interface SpendBreakdown {
  key: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Get spend for a time period
 */
export async function getSpend(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  options: {
    sinceHoursAgo?: number;
    agentId?: string;
    workflowId?: string;
    opportunityId?: string;
    purpose?: string;
  } = {}
): Promise<SpendSummary> {
  const since = new Date(Date.now() - (options.sinceHoursAgo || 24) * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('ai_inference_ledger')
    .select('status, actual_cost_usd, reserved_cost_usd, actual_input_tokens, actual_output_tokens')
    .gte('created_at', since)
    .in('status', ['settled', 'reserved', 'in_progress', 'failed', 'ambiguous']);

  if (options.agentId) query = query.eq('agent_id', options.agentId);
  if (options.workflowId) query = query.eq('workflow_id', options.workflowId);
  if (options.opportunityId) query = query.eq('opportunity_id', options.opportunityId);
  if (options.purpose) query = query.eq('purpose', options.purpose);

  const { data, error } = await query;

  if (error || !data) {
    return {
      totalCostUsd: 0,
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      reservedUsd: 0,
      settledUsd: 0,
      failedUsd: 0,
      ambiguousUsd: 0,
    };
  }

  const summary: SpendSummary = {
    totalCostUsd: 0,
    totalCalls: data.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    reservedUsd: 0,
    settledUsd: 0,
    failedUsd: 0,
    ambiguousUsd: 0,
  };

  for (const row of data) {
    const cost =
      row.status === 'settled'
        ? Number(row.actual_cost_usd || 0)
        : Number(row.reserved_cost_usd || 0);

    summary.totalCostUsd += cost;
    summary.totalInputTokens += row.actual_input_tokens || 0;
    summary.totalOutputTokens += row.actual_output_tokens || 0;

    switch (row.status) {
      case 'settled':
        summary.settledUsd += Number(row.actual_cost_usd || 0);
        break;
      case 'reserved':
      case 'in_progress':
        summary.reservedUsd += Number(row.reserved_cost_usd || 0);
        break;
      case 'failed':
        summary.failedUsd += Number(row.reserved_cost_usd || 0);
        break;
      case 'ambiguous':
        summary.ambiguousUsd += Number(row.reserved_cost_usd || 0);
        break;
    }
  }

  return summary;
}

/**
 * Get spend breakdown by a dimension
 */
export async function getSpendBreakdown(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  dimension: 'agent_id' | 'purpose' | 'model' | 'task_type' | 'opportunity_id',
  sinceHoursAgo: number = 24
): Promise<SpendBreakdown[]> {
  const since = new Date(Date.now() - sinceHoursAgo * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('ai_inference_ledger')
    .select(
      `${dimension}, actual_cost_usd, reserved_cost_usd, actual_input_tokens, actual_output_tokens, status`
    )
    .gte('created_at', since)
    .in('status', ['settled', 'reserved', 'in_progress']);

  if (error || !data) return [];

  const buckets = new Map<string, SpendBreakdown>();

  for (const row of data) {
    const key = ((row as Record<string, unknown>)[dimension] as string) || 'unknown';
    const existing = buckets.get(key) || {
      key,
      calls: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    existing.calls++;
    existing.costUsd +=
      row.status === 'settled'
        ? Number(row.actual_cost_usd || 0)
        : Number(row.reserved_cost_usd || 0);
    existing.inputTokens += row.actual_input_tokens || 0;
    existing.outputTokens += row.actual_output_tokens || 0;

    buckets.set(key, existing);
  }

  return Array.from(buckets.values()).sort((a, b) => b.costUsd - a.costUsd);
}
