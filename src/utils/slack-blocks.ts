/**
 * Slack Block Kit Utilities
 *
 * Creates interactive messages with buttons for one-click actions.
 * Uses Slack's Block Kit: https://api.slack.com/block-kit
 */

import type { KnownBlock, Button, ActionsBlock, SectionBlock, DividerBlock, ContextBlock } from '@slack/types';

export interface OpportunityBlocks {
  noticeId: string;
  title: string;
  agency?: string;
  naics?: string;
  setAside?: string;
  dueDate?: string;
  score: number;
  reasons: string[];
  redFlags?: string[];
  samUrl: string;
  opener?: string;
}

/**
 * Create a section block with markdown text
 */
export function section(text: string): SectionBlock {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text,
    },
  };
}

/**
 * Create a section with fields (two-column layout)
 */
export function sectionWithFields(fields: string[]): SectionBlock {
  return {
    type: 'section',
    fields: fields.map(f => ({
      type: 'mrkdwn',
      text: f,
    })),
  };
}

/**
 * Create a divider
 */
export function divider(): DividerBlock {
  return { type: 'divider' };
}

/**
 * Create a context block (small text, used for metadata)
 */
export function context(texts: string[]): ContextBlock {
  return {
    type: 'context',
    elements: texts.map(t => ({
      type: 'mrkdwn',
      text: t,
    })),
  };
}

/**
 * Create an action button
 */
export function button(
  text: string,
  actionId: string,
  value: string,
  style?: 'primary' | 'danger'
): Button {
  const btn: Button = {
    type: 'button',
    text: {
      type: 'plain_text',
      text,
      emoji: true,
    },
    action_id: actionId,
    value,
  };

  if (style) {
    btn.style = style;
  }

  return btn;
}

/**
 * Create an actions block with buttons
 */
export function actions(buttons: Button[], blockId?: string): ActionsBlock {
  const block: ActionsBlock = {
    type: 'actions',
    elements: buttons,
  };

  if (blockId) {
    block.block_id = blockId;
  }

  return block;
}

/**
 * Build opportunity post with interactive buttons
 */
export function buildOpportunityBlocks(opp: OpportunityBlocks): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Opener
  if (opp.opener) {
    blocks.push(section(opp.opener));
  }

  // Title as header
  blocks.push(section(`*${opp.title}*`));

  // Details in two columns
  const fields: string[] = [];
  if (opp.agency) fields.push(`*Agency:* ${opp.agency}`);
  if (opp.naics) fields.push(`*NAICS:* ${opp.naics}`);
  if (opp.setAside) fields.push(`*Set-Aside:* ${opp.setAside}`);
  if (opp.dueDate) fields.push(`*Due:* ${opp.dueDate}`);

  if (fields.length > 0) {
    blocks.push(sectionWithFields(fields));
  }

  // Score and reasons
  const reasonsText = opp.reasons.length > 0
    ? `*Fit Score: ${opp.score}/100*\n${opp.reasons.map(r => `• ${r}`).join('\n')}`
    : `*Fit Score: ${opp.score}/100*`;
  blocks.push(section(reasonsText));

  // Red flags if any
  if (opp.redFlags && opp.redFlags.length > 0) {
    blocks.push(section(`⚠️ *Concerns:*\n${opp.redFlags.map(r => `• ${r}`).join('\n')}`));
  }

  // Link
  blocks.push(section(`<${opp.samUrl}|View on SAM.gov>`));

  blocks.push(divider());

  // Action buttons
  const actionButtons: Button[] = [
    button('🚀 Pursue', 'opp_pursue', opp.noticeId, 'primary'),
    button('⏭️ Pass', 'opp_pass', opp.noticeId),
    button('🔍 Research', 'opp_research', opp.noticeId),
    button('📋 Add to Pipeline', 'opp_pipeline', opp.noticeId),
  ];

  blocks.push(actions(actionButtons, `opp_actions_${opp.noticeId}`));

  // Context with notice ID
  blocks.push(context([`Notice ID: ${opp.noticeId}`]));

  return blocks;
}

/**
 * Build a simple confirmation message after button click
 */
export function buildConfirmationBlocks(
  action: 'pursue' | 'pass' | 'research' | 'pipeline',
  title: string,
  user: string
): KnownBlock[] {
  const actionText: Record<string, string> = {
    pursue: `✅ <@${user}> marked *${title}* for pursuit`,
    pass: `⏭️ <@${user}> passed on *${title}*`,
    research: `🔍 Requesting research on *${title}* - <@U0AC0SVD3MH> (David) will look into this`,
    pipeline: `📋 Added *${title}* to the pipeline`,
  };

  return [
    section(actionText[action] || `Action taken on ${title}`),
  ];
}

/**
 * Build pipeline status blocks
 */
export function buildPipelineBlocks(pipeline: {
  hot: Array<{ title: string; agency?: string; daysLeft?: number }>;
  active: Array<{ title: string; stage: string; owner?: string }>;
  watching: number;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  blocks.push(section('*📊 FFTC Pipeline Status*'));
  blocks.push(divider());

  // Hot opportunities
  if (pipeline.hot.length > 0) {
    let hotText = '*🔥 Hot (due soon)*\n';
    pipeline.hot.forEach(o => {
      hotText += `• ${o.title.slice(0, 40)}... (${o.agency || 'Unknown'}) - ${o.daysLeft} days left\n`;
    });
    blocks.push(section(hotText));
  } else {
    blocks.push(section('*🔥 Hot*\nNo urgent deadlines this week'));
  }

  // Active pursuits
  if (pipeline.active.length > 0) {
    let activeText = '*📋 Active Pursuits*\n';
    pipeline.active.forEach(o => {
      activeText += `• ${o.title.slice(0, 40)}... - ${o.stage}${o.owner ? ` (${o.owner})` : ''}\n`;
    });
    blocks.push(section(activeText));
  } else {
    blocks.push(section('*📋 Active Pursuits*\nNo active pursuits'));
  }

  // Watching count
  blocks.push(section(`*👀 Watching:* ${pipeline.watching} opportunities in backlog`));

  blocks.push(divider());

  // Quick action buttons
  blocks.push(actions([
    button('🔄 Refresh', 'pipeline_refresh', 'refresh'),
    button('📊 Full Report', 'pipeline_report', 'report'),
  ]));

  return blocks;
}

/**
 * Build decision request blocks (for James recommendations)
 */
export function buildDecisionBlocks(decision: {
  noticeId: string;
  title: string;
  recommendation: 'GO' | 'PASS' | 'NEEDS_INFO';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string[];
  dueDate?: string;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  const recEmoji = decision.recommendation === 'GO' ? '✅' :
                   decision.recommendation === 'PASS' ? '⛔' : '🤔';

  blocks.push(section(`*Decision Needed: ${decision.title}*`));
  blocks.push(divider());

  blocks.push(sectionWithFields([
    `*Recommendation:* ${recEmoji} ${decision.recommendation}`,
    `*Confidence:* ${decision.confidence}`,
  ]));

  if (decision.dueDate) {
    blocks.push(section(`*Response Due:* ${decision.dueDate}`));
  }

  const reasoningText = decision.reasoning.map(r => `• ${r}`).join('\n');
  blocks.push(section(`*Reasoning:*\n${reasoningText}`));

  blocks.push(divider());

  // Decision buttons
  const decisionButtons: Button[] = [
    button('✅ Approve (GO)', 'decision_go', decision.noticeId, 'primary'),
    button('⛔ Decline (PASS)', 'decision_pass', decision.noticeId, 'danger'),
    button('🤔 Need More Info', 'decision_info', decision.noticeId),
  ];

  blocks.push(actions(decisionButtons, `decision_${decision.noticeId}`));

  return blocks;
}
