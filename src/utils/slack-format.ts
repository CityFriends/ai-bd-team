/**
 * Slack Formatting Utilities
 *
 * Slack uses "mrkdwn" (not standard markdown) for formatting.
 * This utility ensures consistent, clean formatting across all agent posts.
 *
 * Slack mrkdwn syntax:
 * - Bold: *text*
 * - Italic: _text_
 * - Strikethrough: ~text~
 * - Code: `code` or ```code block```
 * - Links: <url|display text>
 * - User mention: <@USER_ID>
 * - Channel mention: <#CHANNEL_ID>
 * - Bullet: • or - at line start
 * - Numbered list: 1. at line start
 * - Blockquote: > at line start
 */

export interface SlackSection {
  header?: string;
  content: string | string[];
  type?: 'bullets' | 'numbered' | 'plain';
}

export interface SlackPost {
  opener?: string;
  sections: SlackSection[];
  footer?: string;
  link?: { url: string; label?: string };
}

/**
 * Format text as bold
 */
export function bold(text: string): string {
  return `*${text}*`;
}

/**
 * Format text as italic
 */
export function italic(text: string): string {
  return `_${text}_`;
}

/**
 * Format text as code
 */
export function code(text: string): string {
  return `\`${text}\``;
}

/**
 * Format multi-line text as code block
 */
export function codeBlock(text: string): string {
  return `\`\`\`${text}\`\`\``;
}

/**
 * Format as a link with optional display text
 */
export function link(url: string, displayText?: string): string {
  if (displayText) {
    return `<${url}|${displayText}>`;
  }
  return url;
}

/**
 * Format as a user mention
 */
export function mention(userId: string): string {
  return `<@${userId}>`;
}

/**
 * Format as a channel mention
 */
export function channel(channelId: string): string {
  return `<#${channelId}>`;
}

/**
 * Format a list of items as bullets
 */
export function bullets(items: string[]): string {
  return items.map(item => `• ${item}`).join('\n');
}

/**
 * Format a list of items as numbered list
 */
export function numbered(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/**
 * Format as blockquote
 */
export function blockquote(text: string): string {
  return text.split('\n').map(line => `> ${line}`).join('\n');
}

/**
 * Format a section with optional header
 */
export function section(header: string | null, content: string | string[], type: 'bullets' | 'numbered' | 'plain' = 'plain'): string {
  const parts: string[] = [];

  if (header) {
    parts.push(bold(header));
  }

  if (Array.isArray(content)) {
    if (type === 'bullets') {
      parts.push(bullets(content));
    } else if (type === 'numbered') {
      parts.push(numbered(content));
    } else {
      parts.push(content.join('\n'));
    }
  } else {
    parts.push(content);
  }

  return parts.join('\n');
}

/**
 * Format a key-value pair inline
 */
export function keyValue(key: string, value: string): string {
  return `${bold(key)}: ${value}`;
}

/**
 * Format multiple key-value pairs as a list
 */
export function keyValueList(pairs: Array<{ key: string; value: string }>): string {
  return pairs.map(p => `• ${bold(p.key)}: ${p.value}`).join('\n');
}

/**
 * Build a complete Slack post from structured data
 */
export function buildPost(post: SlackPost): string {
  const parts: string[] = [];

  if (post.opener) {
    parts.push(post.opener);
    parts.push(''); // Empty line after opener
  }

  for (const sec of post.sections) {
    const content = Array.isArray(sec.content) ? sec.content : [sec.content];

    if (sec.header) {
      parts.push(bold(sec.header));
    }

    if (sec.type === 'bullets') {
      parts.push(bullets(content));
    } else if (sec.type === 'numbered') {
      parts.push(numbered(content));
    } else {
      parts.push(content.join('\n'));
    }

    parts.push(''); // Empty line between sections
  }

  if (post.footer) {
    parts.push(italic(post.footer));
    parts.push('');
  }

  if (post.link) {
    if (post.link.label) {
      parts.push(link(post.link.url, post.link.label));
    } else {
      parts.push(post.link.url);
    }
  }

  // Clean up: remove trailing empty lines, collapse multiple empty lines
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Format an opportunity for Slack posting (Maya's format)
 */
export function formatOpportunity(data: {
  opener: string;
  title: string;
  agency: string;
  naics?: string;
  setAside?: string;
  due?: string;
  score: number;
  reasons: string[];
  redFlags?: string[];
  url: string;
  tagUser?: string;
}): string {
  const post: SlackPost = {
    opener: data.opener,
    sections: [
      {
        header: data.title,
        content: [
          `Agency: ${data.agency}`,
          data.naics ? `NAICS: ${data.naics}` : '',
          data.setAside ? `Set-Aside: ${data.setAside}` : '',
          data.due ? `Due: ${data.due}` : '',
        ].filter(Boolean),
        type: 'plain',
      },
      {
        header: `Fit Score: ${data.score}/100`,
        content: data.reasons,
        type: 'bullets',
      },
    ],
    link: { url: data.url },
  };

  if (data.redFlags && data.redFlags.length > 0) {
    post.sections.push({
      header: 'Concerns',
      content: data.redFlags,
      type: 'bullets',
    });
  }

  if (data.tagUser) {
    post.footer = `${mention(data.tagUser)} might want to look into this`;
  }

  return buildPost(post);
}

/**
 * Format a morning intel brief (David's format)
 */
export function formatIntelBrief(data: {
  opener: string;
  competitorNews?: Array<{ company: string; summary: string; type: string }>;
  incumbentResearch?: Array<{
    title: string;
    incumbent?: string;
    value?: string;
    redFlags?: string[];
  }>;
  redFlags?: string[];
  closing?: string;
}): string {
  const sections: SlackSection[] = [];

  if (data.competitorNews && data.competitorNews.length > 0) {
    sections.push({
      header: 'Competitor Watch',
      content: data.competitorNews.map(n =>
        `${bold(n.company)}: ${n.summary} (${n.type})`
      ),
      type: 'bullets',
    });
  } else {
    sections.push({
      header: 'Competitor Watch',
      content: 'Nothing significant today.',
      type: 'plain',
    });
  }

  if (data.incumbentResearch && data.incumbentResearch.length > 0) {
    sections.push({
      header: 'Incumbent Research',
      content: data.incumbentResearch.map(r => {
        let line = r.title.slice(0, 60) + (r.title.length > 60 ? '...' : '');
        if (r.incumbent) line += ` | Incumbent: ${r.incumbent}`;
        if (r.value) line += ` | Value: ${r.value}`;
        return line;
      }),
      type: 'bullets',
    });
  }

  if (data.redFlags && data.redFlags.length > 0) {
    sections.push({
      header: 'Red Flags',
      content: data.redFlags,
      type: 'bullets',
    });
  }

  return buildPost({
    opener: bold('Morning Intel Brief') + '\n' + data.opener,
    sections,
    footer: data.closing || "Let me know if you want me to dig deeper on any of these.",
  });
}

/**
 * Format a partner search report (Rosa's format)
 */
export function formatPartnerReport(data: {
  opener: string;
  context: string;
  partners: Array<{
    name: string;
    location?: string;
    certifications?: string[];
    naics?: string[];
  }>;
  closing?: string;
}): string {
  const sections: SlackSection[] = [];

  if (data.context) {
    sections.push({
      content: data.context,
      type: 'plain',
    });
  }

  if (data.partners.length > 0) {
    sections.push({
      header: 'Potential Partners',
      content: data.partners.map(p => {
        const parts = [bold(p.name)];
        if (p.location) parts.push(`(${p.location})`);
        if (p.certifications && p.certifications.length > 0) {
          parts.push(`- ${p.certifications.join(', ')}`);
        }
        return parts.join(' ');
      }),
      type: 'bullets',
    });
  } else {
    sections.push({
      content: "Didn't find strong matches with the current filters. Want me to broaden the search?",
      type: 'plain',
    });
  }

  return buildPost({
    opener: data.opener,
    sections,
    footer: data.closing,
  });
}

/**
 * Format a strategic recommendation (James's format)
 */
export function formatStrategicRec(data: {
  opener: string;
  recommendation: 'GO' | 'PASS' | 'MORE_INFO';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string[];
  risks?: string[];
  nextSteps?: string[];
  closing?: string;
}): string {
  const recEmoji = data.recommendation === 'GO' ? '✅' :
                   data.recommendation === 'PASS' ? '⛔' : '🤔';

  const sections: SlackSection[] = [
    {
      header: `Recommendation: ${recEmoji} ${data.recommendation}`,
      content: `Confidence: ${data.confidence}`,
      type: 'plain',
    },
    {
      header: 'Reasoning',
      content: data.reasoning,
      type: 'bullets',
    },
  ];

  if (data.risks && data.risks.length > 0) {
    sections.push({
      header: 'Risks to Consider',
      content: data.risks,
      type: 'bullets',
    });
  }

  if (data.nextSteps && data.nextSteps.length > 0) {
    sections.push({
      header: 'Next Steps',
      content: data.nextSteps,
      type: 'numbered',
    });
  }

  return buildPost({
    opener: data.opener,
    sections,
    footer: data.closing,
  });
}
