/**
 * Opportunity Filter Configuration
 * Defines what opportunities Maya should surface vs skip
 */

export const OPPORTUNITY_FILTERS = {
  // NAICS codes we care about
  naicsCodes: [
    '541511', // Custom Computer Programming
    '541512', // Computer Systems Design
    '541519', // Other Computer Related Services
    '541611', // Management Consulting
    '541618', // Other Management Consulting
    '541430', // Graphic Design
    '541910', // Marketing Research
  ],

  // Keywords that INCREASE relevance
  includeKeywords: [
    // Design & Research
    'human-centered design', 'hcd', 'user experience', 'ux', 'ui',
    'service design', 'customer experience', 'cx',
    'design research', 'user research', 'usability', 'usability testing',
    'journey mapping', 'service blueprint', 'experience mapping',
    'accessibility', '508 compliance', 'wcag',
    'design system', 'design ops',

    // Digital Transformation
    'digital services', 'digital transformation', 'modernization',
    'agile', 'iterative', 'prototype', 'mvp',
    'devops', 'ci/cd', 'continuous integration',
    'cloud migration', 'cloud native',
    'api', 'microservices', 'integration',
    'legacy modernization', 'system modernization',

    // Software Development
    'software development', 'software engineering',
    'full stack', 'front end', 'back end', 'frontend', 'backend',
    'web application', 'mobile application', 'responsive',
    'react', 'angular', 'vue', 'node', 'python', 'javascript',
    'low code', 'no code', 'salesforce', 'servicenow',
    'data visualization', 'dashboard', 'analytics',
    'ai', 'machine learning', 'ml', 'automation',
    'open source', 'open data',

    // Product & Strategy
    'product management', 'product strategy', 'product owner',
    'scrum', 'kanban', 'safe', 'agile coaching',
    'roadmap', 'backlog', 'sprint',
    'discovery', 'alpha', 'beta',
    'technology strategy', 'it strategy',
    'enterprise architecture',

    // Content & Communication
    'content strategy', 'content design', 'plain language',
    'information architecture', 'ia',
    'digital communications', 'web content',
    'chatbot', 'conversational ai', 'virtual assistant',
  ],

  // Keywords that DECREASE relevance (skip if these are primary focus)
  excludeKeywords: [
    'manufacturing', 'construction', 'facilities',
    'janitorial', 'maintenance', 'grounds', 'landscaping',
    'weapons', 'munitions', 'artillery', 'ammunition',
    'staffing augmentation', 'staff aug', 'body shop', 'staff augmentation',
    'mainframe', 'cobol',
    'help desk', 'tier 1 support', 'tier 1', 'call center',
    'security clearance required', 'ts/sci', 'top secret',
    'hardware procurement', 'equipment purchase',
  ],

  // Keywords that only matter if paired with modernization
  conditionalKeywords: [
    'legacy migration', 'legacy system', 'legacy modernization',
  ],

  // Agencies we prioritize (sorted by preference)
  priorityAgencies: [
    'Department of Veterans Affairs',
    'Department of Health and Human Services',
    'Centers for Medicare & Medicaid Services',
    'Department of Labor',
    'Department of Education',
    'Department of State',
    'Small Business Administration',
    'General Services Administration',
    'Department of Agriculture',
    'Department of Transportation',
    'Department of Homeland Security',
    'Internal Revenue Service',
  ],

  // Set-asides we can compete for
  eligibleSetAsides: [
    '8(a)',
    'WOSB',
    'SDVOSB',
    'Small Business',
    'Total Small Business',
    'Full and Open',
    'Competitive 8(a)',
  ],

  // Contract value sweet spot
  valueRange: {
    min: 100000,      // $100K minimum
    max: 10000000,    // $10M maximum (can go higher with team)
    sweet: {
      min: 500000,    // $500K
      max: 5000000,   // $5M - ideal range
    },
  },

  // Response time requirements
  timeline: {
    minDaysToRespond: 14,   // Skip if less than 14 days to respond
    idealDaysToRespond: 30, // Prefer 30+ days
  },
};

/**
 * Score an opportunity based on fit
 * Returns 0-100 score
 */
export function scoreOpportunity(opportunity: {
  title?: string;
  description?: string;
  naicsCode?: string;
  agency?: string;
  setAside?: string;
  responseDeadline?: string;
  estimatedValue?: number;
}): { score: number; reasons: string[]; redFlags: string[] } {
  let score = 50; // Start at neutral
  const reasons: string[] = [];
  const redFlags: string[] = [];

  const text = `${opportunity.title || ''} ${opportunity.description || ''}`.toLowerCase();

  // NAICS match (+20)
  if (opportunity.naicsCode && OPPORTUNITY_FILTERS.naicsCodes.includes(opportunity.naicsCode)) {
    score += 20;
    reasons.push(`NAICS ${opportunity.naicsCode} match`);
  }

  // Include keywords (+5 each, max +25)
  let keywordBonus = 0;
  for (const keyword of OPPORTUNITY_FILTERS.includeKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      keywordBonus += 5;
      if (keywordBonus <= 25) {
        reasons.push(`Keyword: "${keyword}"`);
      }
    }
  }
  score += Math.min(keywordBonus, 25);

  // Exclude keywords (-15 each)
  for (const keyword of OPPORTUNITY_FILTERS.excludeKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      score -= 15;
      redFlags.push(`Contains: "${keyword}"`);
    }
  }

  // Priority agency (+15)
  if (opportunity.agency) {
    const isPriority = OPPORTUNITY_FILTERS.priorityAgencies.some(a =>
      opportunity.agency!.toLowerCase().includes(a.toLowerCase().split(' ')[0])
    );
    if (isPriority) {
      score += 15;
      reasons.push(`Priority agency: ${opportunity.agency}`);
    }
  }

  // Set-aside eligibility (+10 or -20)
  if (opportunity.setAside) {
    const isEligible = OPPORTUNITY_FILTERS.eligibleSetAsides.some(s =>
      opportunity.setAside!.toLowerCase().includes(s.toLowerCase())
    );
    if (isEligible) {
      score += 10;
      reasons.push(`Eligible set-aside: ${opportunity.setAside}`);
    } else {
      score -= 20;
      redFlags.push(`Ineligible set-aside: ${opportunity.setAside}`);
    }
  }

  // Timeline check
  if (opportunity.responseDeadline) {
    const daysLeft = Math.ceil(
      (new Date(opportunity.responseDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysLeft < OPPORTUNITY_FILTERS.timeline.minDaysToRespond) {
      score -= 20;
      redFlags.push(`Only ${daysLeft} days to respond`);
    } else if (daysLeft >= OPPORTUNITY_FILTERS.timeline.idealDaysToRespond) {
      score += 5;
      reasons.push(`Good timeline: ${daysLeft} days`);
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return { score, reasons, redFlags };
}

/**
 * Determine if opportunity should be posted
 */
export function shouldPostOpportunity(score: number): {
  shouldPost: boolean;
  urgency: 'immediate' | 'morning' | 'skip';
  enthusiasm: 'high' | 'medium' | 'low';
} {
  if (score >= 80) {
    return { shouldPost: true, urgency: 'immediate', enthusiasm: 'high' };
  } else if (score >= 60) {
    return { shouldPost: true, urgency: 'morning', enthusiasm: 'medium' };
  } else if (score >= 40) {
    return { shouldPost: true, urgency: 'morning', enthusiasm: 'low' };
  } else {
    return { shouldPost: false, urgency: 'skip', enthusiasm: 'low' };
  }
}
