/**
 * Deliverable Templates
 *
 * Structured templates for actionable work products.
 * These aren't just summaries - they're ready-to-use documents
 * that actually help win business.
 */

import type { DeliverableType } from '../integrations/database/deliverables.js';
import type { OpportunityDiscussion } from '../discussions/orchestrator.js';

// ============================================================
// Types
// ============================================================

export interface TemplateSection {
  heading: string;
  instruction: string;
  required: boolean;
  maxWords?: number;
  agentSource?: string; // Which agent's input to use
}

export interface DeliverableTemplate {
  type: DeliverableType;
  name: string;
  description: string;
  owner: string;
  sections: TemplateSection[];
}

export interface PartnerCandidate {
  name: string;
  uei?: string;
  certifications: string[];
  naicsCodes: string[];
  location?: string;
  relevantExperience?: string;
  federalContracts?: {
    totalAwarded: number;
    topAgencies: string[];
  };
  pros: string[];
  cons: string[];
  relationshipStatus?: string;
}

export interface OutreachEmailParams {
  partnerName: string;
  contactName?: string;
  opportunityTitle: string;
  agency: string;
  setAside?: string;
  dueDate?: string;
  capabilityNeed: string;
  partnerStrength: string;
  senderName: string;
  senderCompany: string;
}

// ============================================================
// Templates
// ============================================================

export const DELIVERABLE_TEMPLATES: Record<string, DeliverableTemplate> = {
  go_no_go_memo: {
    type: 'go_no_go_memo',
    name: 'Go/No-Go Decision Memo',
    description:
      'Executive decision document synthesizing team analysis into actionable recommendation',
    owner: 'james',
    sections: [
      {
        heading: 'Opportunity Summary',
        instruction:
          'Agency, title, contract value, due date, set-aside type, primary NAICS. 2-3 sentences max.',
        required: true,
        maxWords: 75,
      },
      {
        heading: 'Fit Assessment',
        instruction:
          "Set-aside eligibility, NAICS alignment, timeline feasibility. Reference Maya's analysis.",
        required: true,
        maxWords: 150,
        agentSource: 'maya',
      },
      {
        heading: 'Competitive Position',
        instruction:
          "Incumbent status, agency spending context, risk factors. Reference David's research.",
        required: true,
        maxWords: 200,
        agentSource: 'david',
      },
      {
        heading: 'Teaming Strategy',
        instruction:
          "Partner needs, candidates identified, relationship status. Reference Rosa's input.",
        required: false,
        maxWords: 150,
        agentSource: 'rosa',
      },
      {
        heading: 'Technical Feasibility',
        instruction:
          'Can we deliver? Compliance requirements, architecture, resource needs. Reference Marcus.',
        required: true,
        maxWords: 150,
        agentSource: 'marcus',
      },
      {
        heading: 'Recommendation',
        instruction:
          'GO | NO-GO | HOLD with confidence percentage (e.g., "GO - 72% confidence"). Then 3-5 key factors as bullets.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Next Steps if GO',
        instruction: 'Immediate actions with owners and deadlines. Be specific.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Risks to Monitor',
        instruction: 'Top 3 risks with mitigation approach for each.',
        required: true,
        maxWords: 100,
      },
    ],
  },

  partner_shortlist: {
    type: 'partner_shortlist',
    name: 'Teaming Partner Shortlist',
    description: 'Ranked partner candidates with analysis and ready-to-send outreach',
    owner: 'rosa',
    sections: [
      {
        heading: 'Partnership Need',
        instruction:
          'What capability or certification gap are we filling? Why do we need a partner?',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Search Criteria',
        instruction:
          'NAICS codes, certifications, agency experience, location requirements used to find candidates.',
        required: true,
        maxWords: 75,
      },
      {
        heading: 'Partner Candidates',
        instruction:
          'For each candidate (3-5): Company name, certifications, relevant experience, federal contract history, pros/cons, relationship status.',
        required: true,
        maxWords: 400,
      },
      {
        heading: 'Recommended Partner',
        instruction: 'Top choice with clear rationale. Why this partner over others?',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Draft Outreach Email',
        instruction: 'Ready-to-send email template for first contact. Include subject line.',
        required: true,
        maxWords: 200,
      },
      {
        heading: 'Teaming Arrangement',
        instruction:
          'Recommended structure (prime/sub/JV), work share considerations, key terms to negotiate.',
        required: true,
        maxWords: 100,
      },
    ],
  },

  research_brief: {
    type: 'research_brief',
    name: 'Research Brief',
    description: 'Synthesized answer to a specific question with supporting evidence',
    owner: 'david',
    sections: [
      {
        heading: 'Question',
        instruction: 'The specific question being answered.',
        required: true,
        maxWords: 50,
      },
      {
        heading: 'Answer',
        instruction: 'Direct answer to the question in 2-3 sentences.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Supporting Evidence',
        instruction: 'Data points, sources, and analysis that support the answer.',
        required: true,
        maxWords: 200,
      },
      {
        heading: 'Confidence Level',
        instruction: 'High/Medium/Low with explanation of what would increase confidence.',
        required: true,
        maxWords: 75,
      },
      {
        heading: 'Open Questions',
        instruction: "What we still don't know. What additional research would help.",
        required: false,
        maxWords: 100,
      },
    ],
  },

  tech_assessment: {
    type: 'tech_assessment',
    name: 'Technical Risk Assessment',
    description: 'Technical feasibility and risk analysis for opportunity pursuit',
    owner: 'marcus',
    sections: [
      {
        heading: 'Technical Requirements Summary',
        instruction: 'Key technical requirements from the solicitation.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Capability Assessment',
        instruction: 'What we can deliver vs. gaps. Be honest.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Compliance Requirements',
        instruction: 'FedRAMP level, IL level, clearances, Section 508, etc.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Risk Areas',
        instruction: 'Technical risks ranked by severity with likelihood assessment.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Mitigation Strategies',
        instruction: 'How to address each major risk.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Resource Requirements',
        instruction: 'Skills, tools, and staffing needed.',
        required: true,
        maxWords: 100,
      },
    ],
  },

  executive_insight: {
    type: 'executive_insight',
    name: 'Executive Insight',
    description: 'High-impact observation requiring leadership attention',
    owner: 'patricia',
    sections: [
      {
        heading: 'Insight',
        instruction: 'The key observation or finding in 1-2 sentences.',
        required: true,
        maxWords: 50,
      },
      {
        heading: 'Why It Matters',
        instruction: 'Business impact and strategic implications.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Recommended Action',
        instruction: 'What should leadership do?',
        required: true,
        maxWords: 75,
      },
      {
        heading: 'Timeline',
        instruction: 'When does this need attention? Urgency level.',
        required: true,
        maxWords: 50,
      },
    ],
  },

  capture_plan: {
    type: 'capture_plan',
    name: 'Capture Plan Outline',
    description: 'Strategic plan for winning a specific opportunity',
    owner: 'james',
    sections: [
      {
        heading: 'Opportunity Overview',
        instruction: 'Agency, title, value, timeline, competitive landscape.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Win Strategy',
        instruction: 'Primary win theme and discriminators.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Team Composition',
        instruction: 'Proposed team structure, key personnel, teaming partners.',
        required: true,
        maxWords: 150,
      },
      {
        heading: 'Customer Engagement Plan',
        instruction: 'How we will build relationship before proposal.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Key Milestones',
        instruction: 'Critical dates from now through proposal submission.',
        required: true,
        maxWords: 100,
      },
      {
        heading: 'Risk Mitigation',
        instruction: 'Top risks and how we will address them.',
        required: true,
        maxWords: 100,
      },
    ],
  },
};

// ============================================================
// Outreach Email Generator
// ============================================================

/**
 * Generate a draft outreach email for partner contact
 */
export function generateOutreachEmail(params: OutreachEmailParams): string {
  const {
    partnerName,
    contactName,
    opportunityTitle,
    agency,
    setAside,
    dueDate,
    capabilityNeed,
    partnerStrength,
    senderName,
    senderCompany,
  } = params;

  const greeting = contactName ? `Hi ${contactName},` : `Hello,`;
  const setAsideText = setAside ? `a ${setAside} ` : 'an ';
  const dueDateText = dueDate ? ` with responses due ${dueDate}` : '';

  return `Subject: Teaming Opportunity - ${agency} ${opportunityTitle.slice(0, 40)}

${greeting}

I'm reaching out from ${senderCompany} regarding ${opportunityTitle}, ${setAsideText}opportunity with ${agency}${dueDateText}.

We're building a team and looking for a partner with ${capabilityNeed}. I noticed ${partnerName}'s ${partnerStrength}, which would complement our capabilities well.

Would you be open to a brief call this week to discuss potential teaming?

I can provide more details on the opportunity and our proposed approach. Looking forward to hearing from you.

Best regards,
${senderName}
${senderCompany}`;
}

/**
 * Format partner candidate for shortlist
 */
export function formatPartnerForShortlist(partner: PartnerCandidate, rank: number): string {
  const lines = [
    `### ${rank}. ${partner.name}`,
    '',
    `**Certifications:** ${partner.certifications.join(', ') || 'None listed'}`,
    `**NAICS Codes:** ${partner.naicsCodes.slice(0, 5).join(', ')}`,
  ];

  if (partner.location) {
    lines.push(`**Location:** ${partner.location}`);
  }

  if (partner.federalContracts) {
    lines.push(
      `**Federal Contracts:** $${(partner.federalContracts.totalAwarded / 1000000).toFixed(1)}M total`
    );
    if (partner.federalContracts.topAgencies.length > 0) {
      lines.push(`**Top Agencies:** ${partner.federalContracts.topAgencies.join(', ')}`);
    }
  }

  if (partner.relationshipStatus) {
    lines.push(`**Relationship:** ${partner.relationshipStatus}`);
  }

  lines.push('');
  lines.push('**Pros:**');
  for (const pro of partner.pros) {
    lines.push(`- ${pro}`);
  }

  lines.push('');
  lines.push('**Cons:**');
  for (const con of partner.cons) {
    lines.push(`- ${con}`);
  }

  return lines.join('\n');
}

// ============================================================
// Discussion to Deliverable Conversion
// ============================================================

/**
 * Extract content from discussion turns for a specific agent
 */
export function extractAgentContent(
  discussion: OpportunityDiscussion,
  agent: string
): string | null {
  const turn = discussion.turns.find((t) => t.agent === agent);
  return turn?.content || null;
}

/**
 * Build deliverable prompt from template and discussion
 */
export function buildDeliverablePrompt(
  template: DeliverableTemplate,
  discussion: OpportunityDiscussion,
  additionalContext?: string
): string {
  const lines = [
    `Generate a ${template.name} based on the following team discussion.`,
    '',
    '## TEAM DISCUSSION',
    '',
  ];

  for (const turn of discussion.turns) {
    lines.push(`### ${turn.agent.toUpperCase()} (${turn.role})`);
    lines.push(turn.content);
    lines.push('');
  }

  if (additionalContext) {
    lines.push('## ADDITIONAL CONTEXT');
    lines.push(additionalContext);
    lines.push('');
  }

  lines.push('## OUTPUT FORMAT');
  lines.push('');
  lines.push(`Create the ${template.name} with these sections:`);
  lines.push('');

  for (const section of template.sections) {
    const required = section.required ? '(Required)' : '(Optional)';
    const maxWords = section.maxWords ? `Max ${section.maxWords} words.` : '';
    const source = section.agentSource ? `Use ${section.agentSource}'s input.` : '';

    lines.push(`### ${section.heading} ${required}`);
    lines.push(`${section.instruction} ${maxWords} ${source}`);
    lines.push('');
  }

  lines.push("Be specific and actionable. Use the team's actual analysis, not generic advice.");

  return lines.join('\n');
}

/**
 * Get template by type
 */
export function getTemplate(type: DeliverableType): DeliverableTemplate | null {
  return DELIVERABLE_TEMPLATES[type] || null;
}

/**
 * Get all template types
 */
export function getTemplateTypes(): DeliverableType[] {
  return Object.keys(DELIVERABLE_TEMPLATES) as DeliverableType[];
}
