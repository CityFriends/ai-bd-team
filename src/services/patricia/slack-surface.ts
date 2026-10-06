/**
 * Patricia Slack Surface
 *
 * Slack payload generation/contracts. Production posting DISABLED.
 * Future surfaces:
 * - routine portfolio status → consolidated weekly brief
 * - AT_RISK → concise immediate escalation
 *
 * Zero LLM calls.
 */

import type { PortfolioSnapshot, PatriciaSlackPayload, SlackBlock } from './types.js';

/**
 * Generate portfolio brief Slack payload.
 * Production posting is disabled — this only builds the payload.
 */
export function generatePortfolioBriefPayload(
  snapshot: PortfolioSnapshot
): PatriciaSlackPayload {
  const lines: string[] = [];

  lines.push(`*📋 Weekly Portfolio Brief*`);
  lines.push('');

  // Summary counts
  const counts: string[] = [];
  if (snapshot.active_watches > 0) counts.push(`${snapshot.active_watches} watch`);
  if (snapshot.active_captures > 0) counts.push(`${snapshot.active_captures} capture`);
  if (snapshot.active_pursuits > 0) counts.push(`${snapshot.active_pursuits} pursuit`);
  if (snapshot.active_proposals > 0) counts.push(`${snapshot.active_proposals} proposal`);
  if (counts.length > 0) {
    lines.push(`*Pipeline:* ${counts.join(' · ')}`);
  } else {
    lines.push('*Pipeline:* No active items');
  }

  // Deadlines
  if (snapshot.deadlines_next_7d > 0) {
    lines.push(`*⏰ Deadlines (7d):* ${snapshot.deadlines_next_7d}`);
  }
  if (snapshot.deadlines_next_14d > snapshot.deadlines_next_7d) {
    lines.push(`*📅 Deadlines (14d):* ${snapshot.deadlines_next_14d}`);
  }

  // Overdue
  if (snapshot.overdue_commitments > 0) {
    lines.push(`*🔴 Overdue:* ${snapshot.overdue_commitments}`);
  }

  // Blocked
  if (snapshot.blocked_work_items > 0) {
    lines.push(`*🚫 Blocked:* ${snapshot.blocked_work_items}`);
  }

  // AT_RISK
  if (snapshot.at_risk_pursuits > 0) {
    lines.push(`*⚠️ At Risk:* ${snapshot.at_risk_pursuits}`);
  }

  // Human decisions
  if (snapshot.human_decisions_needed > 0) {
    lines.push(`*🙋 Decisions Needed:* ${snapshot.human_decisions_needed}`);
  }

  // Recent outcomes
  if (snapshot.recently_submitted > 0) {
    lines.push(`*📤 Recently Submitted:* ${snapshot.recently_submitted}`);
  }
  if (snapshot.awards > 0) {
    lines.push(`*🏆 Awards:* ${snapshot.awards}`);
  }
  if (snapshot.losses > 0) {
    lines.push(`*📉 Losses:* ${snapshot.losses}`);
  }

  const text = lines.join('\n');

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: '📋 Weekly Portfolio Brief' } },
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'patricia_brief_acknowledge',
          value: snapshot.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Pipeline' },
          action_id: 'patricia_view_pipeline',
          value: snapshot.id,
        },
      ],
    },
  ];

  return {
    type: 'PORTFOLIO_BRIEF',
    text,
    blocks,
    actions: [
      { action_id: 'patricia_brief_acknowledge', label: 'Acknowledge', value: snapshot.id },
      { action_id: 'patricia_view_pipeline', label: 'View Pipeline', value: snapshot.id },
    ],
  };
}

/**
 * Generate AT_RISK escalation Slack payload.
 * Production posting is disabled.
 */
export function generateAtRiskPayload(
  escalation: {
    id: string;
    title: string;
    description: string;
    severity: string;
    opportunity_id?: string | null;
    decision_owner?: string | null;
  }
): PatriciaSlackPayload {
  const text = [
    `*⚠️ AT RISK: ${escalation.title}*`,
    '',
    escalation.description,
    '',
    escalation.decision_owner ? `*Decision Owner:* ${escalation.decision_owner}` : '',
  ].filter(Boolean).join('\n');

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: `⚠️ ${escalation.title}` } },
    { type: 'section', text: { type: 'mrkdwn', text: escalation.description } },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'patricia_escalation_acknowledge',
          value: escalation.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View Pursuit' },
          action_id: 'patricia_view_pursuit',
          value: escalation.opportunity_id || escalation.id,
        },
      ],
    },
  ];

  return {
    type: 'AT_RISK_ESCALATION',
    text,
    blocks,
    actions: [
      { action_id: 'patricia_escalation_acknowledge', label: 'Acknowledge', value: escalation.id },
      { action_id: 'patricia_view_pursuit', label: 'View Pursuit', value: escalation.opportunity_id || escalation.id },
    ],
  };
}
