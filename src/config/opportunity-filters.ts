/**
 * Opportunity Filter Configuration
 * Defines what opportunities Maya should surface vs skip
 *
 * FFTC Sweet Spot: Human-centered design, UX research, digital services
 * NOT: COTS implementation, system integration, infrastructure, hardware
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

  // CORE KEYWORDS - At least ONE must be present for opportunity to be relevant
  // These represent FFTC's actual capabilities
  coreKeywords: [
    // HCD/UX - Our bread and butter
    'human-centered design', 'hcd', 'user experience', 'ux', 'user interface', 'ui',
    'service design', 'customer experience', 'cx', 'design thinking',
    'design research', 'user research', 'usability', 'usability testing',
    'journey mapping', 'service blueprint', 'experience mapping',
    'accessibility', '508 compliance', 'wcag', 'section 508',
    'design system', 'design ops', 'design sprint',

    // Digital Services (custom development, not COTS)
    'digital services', 'digital transformation', 'custom development',
    'agile development', 'iterative development', 'prototype', 'mvp',
    'web application development', 'mobile app development',

    // Content & Plain Language
    'content strategy', 'content design', 'plain language',
    'information architecture', 'digital communications',
  ],

  // Keywords that INCREASE relevance (bonus points on top of core)
  includeKeywords: [
    // Agile & Modern Development
    'agile', 'iterative', 'devops', 'ci/cd', 'continuous integration',
    'cloud native', 'api development', 'microservices',
    'full stack', 'front end', 'back end', 'frontend', 'backend',
    'react', 'angular', 'vue', 'node', 'python', 'javascript',
    'data visualization', 'dashboard', 'analytics',
    'open source', 'open data',

    // Product & Strategy
    'product management', 'product strategy', 'product owner',
    'scrum', 'kanban', 'safe', 'agile coaching',
    'roadmap', 'backlog', 'sprint',
    'discovery', 'alpha', 'beta',

    // AI/ML (but only if we're building, not buying)
    'ai development', 'machine learning development', 'ml model',
    'chatbot development', 'conversational ai', 'virtual assistant',

    // Modernization (our angle, not just infra)
    'legacy modernization', 'application modernization',
    'digital modernization', 'user-facing modernization',
  ],

  // HARD EXCLUDE - If ANY of these appear, score = 0, skip entirely
  // These are fundamentally not our work
  hardExcludeKeywords: [
    // COTS Implementation (buying/configuring products, not custom work)
    'cots implementation', 'cots solution', 'commercial off-the-shelf',
    'oracle implementation', 'sap implementation', 'peoplesoft',
    'workday implementation', 'servicenow implementation',
    'salesforce implementation', 'dynamics 365', 'microsoft dynamics',
    'erp implementation', 'crm implementation', 'hris implementation',
    'package implementation', 'cots configuration', 'software licensing',

    // System Integration (connecting existing systems, not building new)
    'system integrator', 'systems integration', 'enterprise integration',
    'integration services', 'middleware implementation', 'esb implementation',
    'data integration', 'etl development', 'data warehouse',

    // Infrastructure & Operations (not our lane)
    'infrastructure support', 'infrastructure management', 'data center',
    'network operations', 'noc', 'soc', 'security operations',
    'managed services', 'it operations', 'o&m', 'operations and maintenance',
    'help desk', 'service desk', 'tier 1 support', 'tier 2 support',
    'end user support', 'desktop support', 'call center',

    // Hardware & Telecom
    'hardware procurement', 'equipment purchase', 'hardware refresh',
    'telecommunications', 'voip', 'pbx', 'unified communications',
    'network equipment', 'server procurement',

    // Cleared Work (not our focus)
    'ts/sci required', 'top secret required', 'sci clearance',
    'security clearance required', 'cleared personnel',

    // Definitely not us
    'manufacturing', 'construction', 'facilities management',
    'janitorial', 'landscaping', 'grounds maintenance',
    'weapons', 'munitions', 'artillery',
    'staffing augmentation', 'staff aug', 'body shop',
    'mainframe', 'cobol', 'legacy mainframe',
  ],

  // SOFT EXCLUDE - Reduce score but don't auto-skip
  excludeKeywords: [
    // Award notices (not actionable)
    'award notice', 'contract award', 'intent to award', 'sole source award',
    // Red flags that reduce fit
    'sysadmin', 'system administrator', 'dba', 'database administrator',
    'cybersecurity monitoring', 'penetration testing', 'vulnerability scanning',
    'cloud infrastructure', 'aws administration', 'azure administration',
    'low code platform', 'no code platform', // platforms, not custom dev
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
 *
 * Scoring Philosophy:
 * - HARD EXCLUDES immediately disqualify (COTS, SI, infrastructure)
 * - CORE KEYWORDS are required for relevance (HCD, UX, digital services)
 * - Bonuses for agency fit, set-aside, and additional keywords
 * - Red flags reduce score but don't auto-disqualify
 */
export function scoreOpportunity(opportunity: {
  title?: string;
  description?: string;
  naicsCode?: string;
  agency?: string;
  setAside?: string;
  setAsideDescription?: string;
  responseDeadline?: string;
  responseDeadLine?: string; // SAM.gov uses this spelling
  estimatedValue?: number;
  department?: string;
  office?: string;
}): { score: number; reasons: string[]; redFlags: string[]; hardExcluded: boolean } {
  let score = 30; // Start lower - must earn relevance
  const reasons: string[] = [];
  const redFlags: string[] = [];

  const text = `${opportunity.title || ''} ${opportunity.description || ''}`.toLowerCase();
  const agency = opportunity.agency || opportunity.department || '';
  const setAside = opportunity.setAside || opportunity.setAsideDescription || '';
  const deadline = opportunity.responseDeadline || opportunity.responseDeadLine || '';

  // ============================================
  // PHASE 1: HARD EXCLUDES (instant disqualification)
  // ============================================
  for (const keyword of OPPORTUNITY_FILTERS.hardExcludeKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      redFlags.push(`HARD EXCLUDE: "${keyword}"`);
      return {
        score: 0,
        reasons: [],
        redFlags,
        hardExcluded: true,
      };
    }
  }

  // ============================================
  // PHASE 2: CORE KEYWORD CHECK (must have relevance)
  // ============================================
  let hasCoreKeyword = false;
  const matchedCoreKeywords: string[] = [];

  for (const keyword of OPPORTUNITY_FILTERS.coreKeywords) {
    // Use word boundary matching for short keywords to avoid false positives
    // e.g., "ui" shouldn't match "circuit" or "requirements"
    const kw = keyword.toLowerCase();
    let matched = false;

    if (kw.length <= 3) {
      // Short keywords need word boundaries
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      matched = regex.test(text);
    } else {
      // Longer keywords can use simple includes
      matched = text.includes(kw);
    }

    if (matched) {
      hasCoreKeyword = true;
      matchedCoreKeywords.push(keyword);
    }
  }

  if (hasCoreKeyword) {
    // Core keyword match is worth significant points
    score += 25;
    reasons.push(`Core capability match: ${matchedCoreKeywords.slice(0, 3).join(', ')}`);

    // Additional core keywords add smaller bonus
    if (matchedCoreKeywords.length > 1) {
      score += Math.min((matchedCoreKeywords.length - 1) * 3, 12);
      reasons.push(`Strong HCD/UX focus (${matchedCoreKeywords.length} core matches)`);
    }
  } else {
    // No core keyword = NOT RELEVANT TO FFTC
    // Generic consulting, IT services, etc. without HCD/UX focus is NOT our work
    // Cap score at 50 max - will never meet posting threshold (60+)
    redFlags.push('No HCD/UX/design keywords - not our core capability');
    return {
      score: Math.min(50, score),
      reasons: [],
      redFlags,
      hardExcluded: false, // Not hard excluded, just low relevance
    };
  }

  // ============================================
  // PHASE 3: NAICS MATCH
  // ============================================
  if (opportunity.naicsCode && OPPORTUNITY_FILTERS.naicsCodes.includes(opportunity.naicsCode)) {
    score += 15;
    reasons.push(`NAICS ${opportunity.naicsCode} match`);
  }

  // ============================================
  // PHASE 4: BONUS KEYWORDS
  // ============================================
  let keywordBonus = 0;
  const matchedBonusKeywords: string[] = [];

  for (const keyword of OPPORTUNITY_FILTERS.includeKeywords) {
    const kw = keyword.toLowerCase();
    let matched = false;

    if (kw.length <= 3) {
      const regex = new RegExp(`\\b${kw}\\b`, 'i');
      matched = regex.test(text);
    } else {
      matched = text.includes(kw);
    }

    if (matched) {
      keywordBonus += 3;
      matchedBonusKeywords.push(keyword);
    }
  }

  if (keywordBonus > 0) {
    const capped = Math.min(keywordBonus, 15);
    score += capped;
    if (matchedBonusKeywords.length > 0) {
      reasons.push(`Bonus keywords: ${matchedBonusKeywords.slice(0, 2).join(', ')}`);
    }
  }

  // ============================================
  // PHASE 5: SOFT EXCLUDES (reduce score)
  // ============================================
  for (const keyword of OPPORTUNITY_FILTERS.excludeKeywords) {
    if (text.includes(keyword.toLowerCase())) {
      score -= 10;
      redFlags.push(`Concern: "${keyword}"`);
    }
  }

  // ============================================
  // PHASE 6: AGENCY FIT
  // ============================================
  if (agency) {
    const isPriority = OPPORTUNITY_FILTERS.priorityAgencies.some(a =>
      agency.toLowerCase().includes(a.toLowerCase().split(' ')[0])
    );
    if (isPriority) {
      score += 10;
      reasons.push(`Priority agency`);
    }
  }

  // ============================================
  // PHASE 7: SET-ASIDE ELIGIBILITY
  // ============================================
  if (setAside) {
    const isEligible = OPPORTUNITY_FILTERS.eligibleSetAsides.some(s =>
      setAside.toLowerCase().includes(s.toLowerCase())
    );
    if (isEligible) {
      score += 8;
      reasons.push(`Eligible set-aside: ${setAside.slice(0, 30)}`);
    } else {
      score -= 15;
      redFlags.push(`May not be eligible: ${setAside.slice(0, 30)}`);
    }
  }

  // ============================================
  // PHASE 8: TIMELINE CHECK
  // ============================================
  if (deadline) {
    const daysLeft = Math.ceil(
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysLeft < OPPORTUNITY_FILTERS.timeline.minDaysToRespond) {
      score -= 15;
      redFlags.push(`Short timeline: ${daysLeft} days`);
    } else if (daysLeft >= OPPORTUNITY_FILTERS.timeline.idealDaysToRespond) {
      score += 5;
      reasons.push(`Good timeline: ${daysLeft} days`);
    }
  }

  // ============================================
  // FINAL: Clamp and return
  // ============================================
  score = Math.max(0, Math.min(100, score));

  return { score, reasons, redFlags, hardExcluded: false };
}

/**
 * Determine if opportunity should be posted
 *
 * Thresholds (updated for quality over quantity):
 * - 85+: Hot opportunity, post immediately with high enthusiasm
 * - 70-84: Good fit, post in morning batch with medium enthusiasm
 * - 60-69: Marginal fit, post with low enthusiasm (might be worth a look)
 * - Below 60: Skip - doesn't match our capabilities well enough
 */
export function shouldPostOpportunity(score: number): {
  shouldPost: boolean;
  urgency: 'immediate' | 'morning' | 'skip';
  enthusiasm: 'high' | 'medium' | 'low';
} {
  if (score >= 85) {
    return { shouldPost: true, urgency: 'immediate', enthusiasm: 'high' };
  } else if (score >= 70) {
    return { shouldPost: true, urgency: 'morning', enthusiasm: 'medium' };
  } else if (score >= 60) {
    return { shouldPost: true, urgency: 'morning', enthusiasm: 'low' };
  } else {
    return { shouldPost: false, urgency: 'skip', enthusiasm: 'low' };
  }
}
