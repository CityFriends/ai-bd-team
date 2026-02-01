/**
 * Company Context Loader
 * Loads company profile, capabilities, and past performance into agent prompts
 */

import { getSupabase } from '../integrations/supabase.js';

export interface CompanyProfile {
  company_name: string;
  tagline?: string;
  elevator_pitch?: string;
  capabilities?: string[];
  differentiators?: string[];
  certifications?: string[];
  set_asides?: string[];
  naics_codes?: string[];
  contract_vehicles?: string[];
  agency_experience?: string[];
  ideal_opportunity?: string;
  no_bid_criteria?: string[];
  team_size?: number;
  location?: string;
  website?: string;
  cage_code?: string;
  uei?: string;
}

export interface PastPerformance {
  contract_name: string;
  agency: string;
  sub_agency?: string;
  contract_number?: string;
  contract_vehicle?: string;
  pop_start?: string;
  pop_end?: string;
  contract_value?: number;
  our_role?: string;
  description?: string;
  key_accomplishments?: string[];
  relevant_naics?: string[];
  tags?: string[];
  cpar_rating?: string;
}

export interface TeamingPartner {
  company_name: string;
  capabilities?: string[];
  certifications?: string[];
  set_asides?: string[];
  relationship_status?: string;
  past_work_together?: string[];
}

export interface KeyPerson {
  name: string;
  role?: string;
  short_bio?: string;
  specialties?: string[];
  certifications?: string[];
  years_experience?: number;
}

export interface CaseStudy {
  title: string;
  client?: string;
  agency?: string;
  challenge?: string;
  approach?: string;
  solution?: string;
  outcomes?: string[];
  methods_used?: string[];
}

export interface CompanyContext {
  profile: CompanyProfile | null;
  pastPerformance: PastPerformance[];
  teamingPartners: TeamingPartner[];
  keyPersonnel: KeyPerson[];
  caseStudies: CaseStudy[];
  loaded: boolean;
}

// Cache for company context (refreshes every 30 minutes)
let cachedContext: CompanyContext | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Load company context from Supabase
 */
export async function loadCompanyContext(): Promise<CompanyContext> {
  // Return cached if fresh
  if (cachedContext && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedContext;
  }

  console.log('[CompanyContext] Loading company context from Supabase...');

  try {
    // Load all data in parallel
    const [profileResult, ppResult, partnersResult, personnelResult, caseStudiesResult] = await Promise.all([
      getSupabase().from('company_profile').select('*').limit(1).single(),
      getSupabase().from('past_performance').select('*').order('pop_end', { ascending: false }),
      getSupabase().from('teaming_partners').select('*').eq('relationship_status', 'Active'),
      getSupabase().from('key_personnel').select('*').eq('available', true),
      getSupabase().from('case_studies').select('*').eq('public_releasable', true),
    ]);

    const context: CompanyContext = {
      profile: profileResult.data || null,
      pastPerformance: ppResult.data || [],
      teamingPartners: partnersResult.data || [],
      keyPersonnel: personnelResult.data || [],
      caseStudies: caseStudiesResult.data || [],
      loaded: true,
    };

    // Cache the result
    cachedContext = context;
    cacheTimestamp = Date.now();

    console.log(`[CompanyContext] Loaded: profile=${!!context.profile}, pastPerf=${context.pastPerformance.length}, partners=${context.teamingPartners.length}, personnel=${context.keyPersonnel.length}, cases=${context.caseStudies.length}`);

    return context;
  } catch (error) {
    console.error('[CompanyContext] Error loading context:', error);
    return {
      profile: null,
      pastPerformance: [],
      teamingPartners: [],
      keyPersonnel: [],
      caseStudies: [],
      loaded: false,
    };
  }
}

/**
 * Clear the cache (useful after onboarding updates)
 */
export function clearCompanyContextCache(): void {
  cachedContext = null;
  cacheTimestamp = 0;
  console.log('[CompanyContext] Cache cleared');
}

/**
 * Format company context as a prompt section for agents
 */
export function formatCompanyContextForPrompt(context: CompanyContext, agentRole: string): string {
  if (!context.loaded || !context.profile) {
    return `
=== COMPANY CONTEXT ===
Company data not yet loaded. When asked about capabilities or past performance, acknowledge you need that information to be set up first.
`;
  }

  const profile = context.profile;

  let prompt = `
=== OUR COMPANY: ${profile.company_name} ===

${profile.tagline ? `"${profile.tagline}"` : ''}

${profile.elevator_pitch ? `ELEVATOR PITCH:\n${profile.elevator_pitch}` : ''}

CORE CAPABILITIES:
${profile.capabilities?.map(c => `• ${c}`).join('\n') || '• Not specified'}

DIFFERENTIATORS (What sets us apart):
${profile.differentiators?.map(d => `• ${d}`).join('\n') || '• Not specified'}

CERTIFICATIONS & SET-ASIDES:
${[...(profile.certifications || []), ...(profile.set_asides || [])].map(c => `• ${c}`).join('\n') || '• None listed'}

NAICS CODES:
${profile.naics_codes?.join(', ') || 'Not specified'}

CONTRACT VEHICLES:
${profile.contract_vehicles?.map(v => `• ${v}`).join('\n') || '• None listed'}

AGENCY EXPERIENCE:
${profile.agency_experience?.map(a => `• ${a}`).join('\n') || '• Not specified'}

IDEAL OPPORTUNITY:
${profile.ideal_opportunity || 'Not defined'}

NO-BID CRITERIA (Red flags that make us pass):
${profile.no_bid_criteria?.map(c => `• ${c}`).join('\n') || '• None defined'}

TEAM SIZE: ${profile.team_size || 'Unknown'}
LOCATION: ${profile.location || 'Unknown'}
`;

  // Add past performance for analysts/strategists
  if (['David', 'James', 'Rosa'].includes(agentRole) && context.pastPerformance.length > 0) {
    prompt += `\n\nPAST PERFORMANCE (Most Recent):\n`;
    context.pastPerformance.slice(0, 5).forEach(pp => {
      prompt += `
• ${pp.contract_name} (${pp.agency}${pp.sub_agency ? ` - ${pp.sub_agency}` : ''})
  - Role: ${pp.our_role || 'Unknown'}
  - Value: ${pp.contract_value ? `$${pp.contract_value.toLocaleString()}` : 'Unknown'}
  - Period: ${pp.pop_start || '?'} to ${pp.pop_end || 'ongoing'}
  ${pp.key_accomplishments?.length ? `- Key wins: ${pp.key_accomplishments.slice(0, 2).join('; ')}` : ''}
  ${pp.cpar_rating ? `- CPAR: ${pp.cpar_rating}` : ''}
`;
    });
  }

  // Add teaming partners for Rosa
  if (agentRole === 'Rosa' && context.teamingPartners.length > 0) {
    prompt += `\n\nACTIVE TEAMING PARTNERS:\n`;
    context.teamingPartners.forEach(partner => {
      prompt += `• ${partner.company_name}${partner.capabilities?.length ? ` - ${partner.capabilities.slice(0, 3).join(', ')}` : ''}${partner.set_asides?.length ? ` (${partner.set_asides.join(', ')})` : ''}\n`;
    });
  }

  // Add key personnel for Patricia
  if (agentRole === 'Patricia' && context.keyPersonnel.length > 0) {
    prompt += `\n\nKEY PERSONNEL:\n`;
    context.keyPersonnel.forEach(person => {
      prompt += `• ${person.name} - ${person.role || 'Team member'}${person.specialties?.length ? ` (${person.specialties.slice(0, 3).join(', ')})` : ''}\n`;
    });
  }

  // Add case studies for proposal/capture people
  if (['James', 'Patricia'].includes(agentRole) && context.caseStudies.length > 0) {
    prompt += `\n\nCASE STUDIES AVAILABLE:\n`;
    context.caseStudies.slice(0, 3).forEach(cs => {
      prompt += `• "${cs.title}" (${cs.agency || cs.client || 'Client'})${cs.outcomes?.length ? ` - ${cs.outcomes[0]}` : ''}\n`;
    });
  }

  prompt += `
=== END COMPANY CONTEXT ===

Use this company context when:
- Evaluating fit for opportunities (match our NAICS, capabilities, agency experience)
- Assessing competitive position (leverage our differentiators, past performance)
- Suggesting teaming strategies (know our partners, what we need)
- Making go/no-go recommendations (check against no-bid criteria)
- Discussing proposals (reference real case studies, key personnel)
`;

  return prompt;
}

/**
 * Get a quick summary of company capabilities for matching
 */
export async function getCapabilitySummary(): Promise<string[]> {
  const context = await loadCompanyContext();
  if (!context.profile) return [];

  return [
    ...(context.profile.capabilities || []),
    ...(context.profile.naics_codes || []),
    ...(context.profile.set_asides || []),
  ];
}

/**
 * Check if an opportunity matches our profile
 */
export async function checkOpportunityFit(opportunity: {
  naicsCodes?: string[];
  setAside?: string;
  agency?: string;
  keywords?: string[];
}): Promise<{
  match: boolean;
  reasons: string[];
  concerns: string[];
}> {
  const context = await loadCompanyContext();
  if (!context.profile) {
    return { match: false, reasons: [], concerns: ['Company profile not loaded'] };
  }

  const reasons: string[] = [];
  const concerns: string[] = [];
  const profile = context.profile;

  // Check NAICS match
  if (opportunity.naicsCodes && profile.naics_codes) {
    const matchingNaics = opportunity.naicsCodes.filter(n =>
      profile.naics_codes!.some(our => n.startsWith(our) || our.startsWith(n))
    );
    if (matchingNaics.length > 0) {
      reasons.push(`NAICS match: ${matchingNaics.join(', ')}`);
    } else {
      concerns.push(`No NAICS match (they want: ${opportunity.naicsCodes.join(', ')})`);
    }
  }

  // Check set-aside match
  if (opportunity.setAside && profile.set_asides) {
    const hasSetAside = profile.set_asides.some(s =>
      opportunity.setAside!.toLowerCase().includes(s.toLowerCase()) ||
      s.toLowerCase().includes(opportunity.setAside!.toLowerCase())
    );
    if (hasSetAside) {
      reasons.push(`Set-aside match: ${opportunity.setAside}`);
    } else if (opportunity.setAside !== 'Full and Open') {
      concerns.push(`Set-aside requirement: ${opportunity.setAside} - we may not qualify`);
    }
  }

  // Check agency experience
  if (opportunity.agency && profile.agency_experience) {
    const hasAgency = profile.agency_experience.some(a =>
      opportunity.agency!.toLowerCase().includes(a.toLowerCase()) ||
      a.toLowerCase().includes(opportunity.agency!.toLowerCase())
    );
    if (hasAgency) {
      reasons.push(`Agency experience: ${opportunity.agency}`);
    }
  }

  // Check no-bid criteria
  if (profile.no_bid_criteria && opportunity.keywords) {
    const redFlags = profile.no_bid_criteria.filter(criterion =>
      opportunity.keywords!.some(kw =>
        kw.toLowerCase().includes(criterion.toLowerCase()) ||
        criterion.toLowerCase().includes(kw.toLowerCase())
      )
    );
    if (redFlags.length > 0) {
      concerns.push(`No-bid criteria triggered: ${redFlags.join(', ')}`);
    }
  }

  const match = reasons.length >= concerns.length && reasons.length > 0;

  return { match, reasons, concerns };
}
