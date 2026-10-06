/**
 * Patricia Portfolio Snapshot
 *
 * Deterministic portfolio snapshot generation.
 * No LLM. Patricia reasoning will later turn this
 * into the concise Slack brief.
 *
 * Zero LLM calls.
 */

import type { SupabaseClient, PortfolioSnapshotData } from './types.js';
import { recordAction } from './operational-actions.js';

/**
 * Generate a deterministic portfolio snapshot from current durable state.
 * Returns the snapshot ID.
 */
export async function generatePortfolioSnapshot(
  supabase: SupabaseClient,
  snapshotType: 'WEEKLY' | 'DAILY' | 'ON_DEMAND' = 'WEEKLY'
): Promise<string> {
  const now = new Date();
  const idempotencyKey = `snapshot-${snapshotType}-${now.toISOString().slice(0, 10)}`;

  // Check if already generated today (idempotent)
  const { data: existing } = await supabase
    .from('patricia_portfolio_snapshots')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  // Gather portfolio data
  const snapshotData = await gatherPortfolioData(supabase, now);

  // Calculate summary counts
  const upcomingDeadlines7 = snapshotData.upcomingDeadlines.filter(d => d.days_remaining <= 7).length;
  const upcomingDeadlines14 = snapshotData.upcomingDeadlines.filter(d => d.days_remaining <= 14).length;
  const upcomingDeadlines30 = snapshotData.upcomingDeadlines.filter(d => d.days_remaining <= 30).length;

  const { data: snapshotRows, error } = await supabase
    .from('patricia_portfolio_snapshots')
    .upsert(
      {
        snapshot_type: snapshotType,
        snapshot_data: snapshotData,
        active_watches: snapshotData.watches.length,
        active_captures: snapshotData.captures.length,
        active_pursuits: snapshotData.pursuits.length,
        active_proposals: snapshotData.proposals.length,
        deadlines_next_7d: upcomingDeadlines7,
        deadlines_next_14d: upcomingDeadlines14,
        deadlines_next_30d: upcomingDeadlines30,
        overdue_commitments: snapshotData.overdueCommitments.length,
        blocked_work_items: snapshotData.blockedWork.length,
        at_risk_pursuits: snapshotData.atRiskItems.length,
        human_decisions_needed: snapshotData.humanDecisionsNeeded.length,
        recently_submitted: snapshotData.recentSubmissions.length,
        awards: snapshotData.awardsAndLosses.filter(a => a.event_type === 'AWARD').length,
        losses: snapshotData.awardsAndLosses.filter(a => a.event_type === 'LOSS').length,
        idempotency_key: idempotencyKey,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true }
    )
    .select('id');

  if (error && !error.message?.includes('duplicate') && !error.message?.includes('coerce')) {
    throw new Error(`[Patricia] Failed to create snapshot: ${error.message}`);
  }

  const snapshot = snapshotRows?.[0];

  if (snapshot) {
    await recordAction(supabase, {
      idempotencyKey: `action-${idempotencyKey}`,
      actionType: 'SNAPSHOT_CREATED',
      targetType: 'patricia_portfolio_snapshots',
      targetId: snapshot.id,
      evidence: { snapshotType },
      result: { snapshotId: snapshot.id },
    });
    return snapshot.id;
  }

  // Already existed — return existing ID
  const { data: existingSnap } = await supabase
    .from('patricia_portfolio_snapshots')
    .select('id')
    .eq('idempotency_key', idempotencyKey)
    .single();

  return existingSnap?.id || '';
}

async function gatherPortfolioData(
  supabase: SupabaseClient,
  now: Date
): Promise<PortfolioSnapshotData> {
  // Watches — opportunities not yet in capture
  const { data: watches } = await supabase
    .from('pipeline_opportunities')
    .select('source_id, title')
    .eq('pipeline_decision', 'watch')
    .limit(100);

  // Active captures
  const { data: captures } = await supabase
    .from('captures')
    .select('id, opportunity_id, status')
    .in('status', ['pending', 'initial_assessment', 'researching', 'recommendation_ready']);

  // Active pursuits
  const { data: pursuits } = await supabase
    .from('captures')
    .select('id, opportunity_id, status')
    .eq('status', 'pursuit_authorized');

  // Active proposals
  const { data: proposals } = await supabase
    .from('patricia_proposal_readiness')
    .select('proposal_workspace_id, stage')
    .neq('stage', 'SUBMITTED');

  // Upcoming deadlines
  const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: deadlines } = await supabase
    .from('patricia_commitments')
    .select('id, title, due_at')
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .gte('due_at', now.toISOString())
    .lte('due_at', futureDate)
    .order('due_at', { ascending: true });

  // Overdue commitments
  const { data: overdue } = await supabase
    .from('patricia_commitments')
    .select('id, title, due_at')
    .in('status', ['PENDING', 'IN_PROGRESS'])
    .lt('due_at', now.toISOString());

  // Blocked work
  const { data: blocked } = await supabase
    .from('patricia_dependencies')
    .select('commitment_id, depends_on_type, depends_on_id')
    .eq('status', 'BLOCKED');

  // AT_RISK escalations
  const { data: atRisk } = await supabase
    .from('patricia_escalations')
    .select('id, title, severity')
    .eq('status', 'OPEN')
    .eq('severity', 'AT_RISK');

  // Human decisions needed
  const { data: decisions } = await supabase
    .from('patricia_escalations')
    .select('id, title, decision_owner')
    .eq('status', 'OPEN')
    .eq('escalation_type', 'DECISION_REQUIRED');

  // Recent submissions (last 30 days)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: submissions } = await supabase
    .from('patricia_post_submission_events')
    .select('proposal_workspace_id, opportunity_id, created_at')
    .eq('event_type', 'SUBMITTED')
    .gte('created_at', thirtyDaysAgo);

  // Awards/losses
  const { data: outcomes } = await supabase
    .from('patricia_post_submission_events')
    .select('proposal_workspace_id, event_type, created_at')
    .in('event_type', ['AWARD', 'LOSS'])
    .gte('created_at', thirtyDaysAgo);

  // Build blocked work map
  const blockedMap = new Map<string, string[]>();
  for (const dep of (blocked || [])) {
    const existing = blockedMap.get(dep.commitment_id) || [];
    existing.push(`${dep.depends_on_type}:${dep.depends_on_id}`);
    blockedMap.set(dep.commitment_id, existing);
  }

  // Resolve blocked commitment titles
  const blockedCommitmentIds = Array.from(blockedMap.keys());
  const { data: blockedCommitments } = blockedCommitmentIds.length > 0
    ? await supabase
        .from('patricia_commitments')
        .select('id, title')
        .in('id', blockedCommitmentIds)
    : { data: [] };

  return {
    watches: (watches || []).map((w: { source_id: string; title: string }) => ({
      opportunity_id: w.source_id,
      title: w.title,
    })),
    captures: (captures || []).map((c: { id: string; opportunity_id: string; status: string }) => ({
      id: c.id,
      opportunity_id: c.opportunity_id,
      status: c.status,
    })),
    pursuits: (pursuits || []).map((p: { id: string; opportunity_id: string; status: string }) => ({
      capture_id: p.id,
      opportunity_id: p.opportunity_id,
      status: p.status,
    })),
    proposals: (proposals || []).map((p: { proposal_workspace_id: string; stage: string }) => ({
      workspace_id: p.proposal_workspace_id,
      stage: p.stage,
    })),
    upcomingDeadlines: (deadlines || []).map((d: { id: string; title: string; due_at: string }) => ({
      commitment_id: d.id,
      title: d.title,
      due_at: d.due_at,
      days_remaining: Math.max(0, Math.ceil((new Date(d.due_at).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))),
    })),
    overdueCommitments: (overdue || []).map((d: { id: string; title: string; due_at: string }) => ({
      commitment_id: d.id,
      title: d.title,
      due_at: d.due_at,
      days_overdue: Math.ceil((now.getTime() - new Date(d.due_at).getTime()) / (24 * 60 * 60 * 1000)),
    })),
    blockedWork: (blockedCommitments || []).map((c: { id: string; title: string }) => ({
      commitment_id: c.id,
      title: c.title,
      blocked_by: blockedMap.get(c.id) || [],
    })),
    atRiskItems: (atRisk || []).map((e: { id: string; title: string; severity: string }) => ({
      escalation_id: e.id,
      title: e.title,
      severity: e.severity,
    })),
    humanDecisionsNeeded: (decisions || []).map((e: { id: string; title: string; decision_owner: string | null }) => ({
      escalation_id: e.id,
      title: e.title,
      decision_owner: e.decision_owner,
    })),
    recentSubmissions: (submissions || []).map((s: { proposal_workspace_id: string; opportunity_id: string; created_at: string }) => ({
      workspace_id: s.proposal_workspace_id,
      opportunity_id: s.opportunity_id,
      submitted_at: s.created_at,
    })),
    awardsAndLosses: (outcomes || []).map((o: { proposal_workspace_id: string; event_type: string; created_at: string }) => ({
      workspace_id: o.proposal_workspace_id,
      event_type: o.event_type,
      created_at: o.created_at,
    })),
  };
}
