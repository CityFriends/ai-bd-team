/**
 * Enhanced Partner Discovery
 *
 * Combines SAM.gov Entity API with USASpending enrichment to find
 * and evaluate potential teaming partners for opportunities.
 *
 * Features:
 * - Search by NAICS, certification, location
 * - Enrich with federal contract history from USASpending
 * - Score partners by relevance
 * - Generate draft outreach emails
 * - Check relationship memory for existing contacts
 */

import { findPartnersByNAICS, type SAMEntity } from '../integrations/sam-entity.js';
import { searchContractorSpending } from '../integrations/usaspending.js';
import { getPartnerByName } from '../integrations/database/partners.js';

// ============================================================
// Types
// ============================================================

export interface PartnerSearchCriteria {
  naicsCodes: string[];
  certifications?: ('8a' | 'WOSB' | 'SDVOSB' | 'HUBZone')[];
  agencyExperience?: string;
  geographicPreference?: string;
  minimumContractValue?: number;
}

export interface FederalContractHistory {
  totalAwarded: number;
  contractCount: number;
  topAgencies: { agency: string; amount: number }[];
  source: string;
}

export interface EnrichedPartner {
  // Core info from SAM.gov
  name: string;
  uei: string;
  cageCode?: string;
  certifications: string[];
  naicsCodes: string[];
  location: string;
  registrationStatus: string;
  expirationWarning?: string;

  // Federal contract history from USASpending
  federalContracts?: FederalContractHistory;

  // From our relationship database
  relationshipStatus?: 'prospect' | 'contacted' | 'active_partner' | 'past_partner' | 'do_not_use';
  relationshipNotes?: string;
  lastTeamedDate?: string;

  // Computed scores
  relevanceScore: number;
  relevanceReasons: string[];

  // Contact info if available
  contactName?: string;
  contactEmail?: string;
}

export interface PartnerDiscoveryResult {
  partners: EnrichedPartner[];
  searchCriteria: PartnerSearchCriteria;
  totalFound: number;
  enrichedCount: number;
  sources: string[];
}

// ============================================================
// Partner Discovery
// ============================================================

/**
 * Discover and enrich potential teaming partners
 */
export async function discoverPartners(
  criteria: PartnerSearchCriteria,
  options?: {
    limit?: number;
    enrichWithSpending?: boolean;
    checkRelationships?: boolean;
  }
): Promise<PartnerDiscoveryResult> {
  const limit = options?.limit || 15;
  const enrichWithSpending = options?.enrichWithSpending !== false;
  const checkRelationships = options?.checkRelationships !== false;

  const sources: string[] = [];
  const allEntities: SAMEntity[] = [];

  // Search SAM.gov for each NAICS code
  for (const naicsCode of criteria.naicsCodes.slice(0, 3)) {
    // Limit to 3 NAICS codes
    const result = await findPartnersByNAICS({
      naicsCode,
      state: criteria.geographicPreference,
      certifications: criteria.certifications,
      limit: limit * 2, // Get extra to allow filtering
    });

    allEntities.push(...result.entities);
    if (!sources.includes(result.source)) {
      sources.push(result.source);
    }
  }

  // Deduplicate by UEI
  const uniqueEntities = deduplicateByUEI(allEntities);

  // Convert to enriched partners
  const partners: EnrichedPartner[] = [];
  let enrichedCount = 0;

  for (const entity of uniqueEntities.slice(0, limit)) {
    const partner = await enrichPartner(entity, criteria, {
      enrichWithSpending,
      checkRelationships,
    });

    if (enrichWithSpending && partner.federalContracts) {
      enrichedCount++;
      sources.push(partner.federalContracts.source);
    }

    partners.push(partner);
  }

  // Sort by relevance score
  partners.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Deduplicate sources
  const uniqueSources = [...new Set(sources)];

  return {
    partners,
    searchCriteria: criteria,
    totalFound: uniqueEntities.length,
    enrichedCount,
    sources: uniqueSources,
  };
}

/**
 * Enrich a single SAM entity with USASpending and relationship data
 */
async function enrichPartner(
  entity: SAMEntity,
  criteria: PartnerSearchCriteria,
  options: { enrichWithSpending: boolean; checkRelationships: boolean }
): Promise<EnrichedPartner> {
  const partner: EnrichedPartner = {
    name: entity.legalBusinessName,
    uei: entity.ueiSAM,
    cageCode: entity.cageCode,
    certifications: extractCertifications(entity),
    naicsCodes: entity.naicsCodes || [],
    location: formatLocation(entity),
    registrationStatus: entity.registrationStatus,
    relevanceScore: 0,
    relevanceReasons: [],
  };

  // Check expiration
  if (entity.registrationExpirationDate) {
    const expDate = new Date(entity.registrationExpirationDate);
    const daysUntilExpiration = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiration < 60) {
      partner.expirationWarning = `Registration expires in ${daysUntilExpiration} days`;
    }
  }

  // Extract contact info if available
  if (entity.governmentBusinessPOC) {
    const poc = entity.governmentBusinessPOC;
    partner.contactName = `${poc.firstName} ${poc.lastName}`;
    partner.contactEmail = poc.email;
  }

  // Enrich with USASpending
  if (options.enrichWithSpending) {
    try {
      const spending = await searchContractorSpending({
        recipientName: entity.legalBusinessName,
      });

      if (spending.contractCount > 0) {
        partner.federalContracts = {
          totalAwarded: spending.totalAwarded,
          contractCount: spending.contractCount,
          topAgencies: spending.topAgencies,
          source: spending.source,
        };
      }
    } catch (err) {
      // Spending data is optional enhancement
      console.log(`[PartnerDiscovery] Could not enrich spending for ${entity.legalBusinessName}`);
    }
  }

  // Check relationship database
  if (options.checkRelationships) {
    try {
      const existing = await getPartnerByName(entity.legalBusinessName);
      if (existing) {
        partner.relationshipStatus = existing.relationship_status;
        partner.relationshipNotes = existing.relationship_notes;
        partner.lastTeamedDate = existing.last_teamed_date;
      }
    } catch {
      // Relationship check is optional
    }
  }

  // Calculate relevance score
  const scored = calculateRelevanceScore(partner, criteria);
  partner.relevanceScore = scored.score;
  partner.relevanceReasons = scored.reasons;

  return partner;
}

// ============================================================
// Scoring
// ============================================================

interface RelevanceResult {
  score: number;
  reasons: string[];
}

/**
 * Calculate relevance score for a partner (0-100)
 */
function calculateRelevanceScore(
  partner: EnrichedPartner,
  criteria: PartnerSearchCriteria
): RelevanceResult {
  let score = 0;
  const reasons: string[] = [];

  // Certification match (40 points max)
  if (criteria.certifications && criteria.certifications.length > 0) {
    const matchedCerts = criteria.certifications.filter((cert) =>
      partner.certifications.some((pc) => pc.toLowerCase().includes(cert.toLowerCase()))
    );

    if (matchedCerts.length > 0) {
      const certPoints = Math.min(matchedCerts.length * 15, 40);
      score += certPoints;
      reasons.push(`Has ${matchedCerts.join(', ')} certification (+${certPoints})`);
    }
  } else {
    // No specific cert required, give some points for having any
    if (partner.certifications.length > 0) {
      score += 10;
      reasons.push(`Has certifications: ${partner.certifications.slice(0, 2).join(', ')} (+10)`);
    }
  }

  // NAICS match (20 points max)
  const naicsMatches = criteria.naicsCodes.filter((n) => partner.naicsCodes.includes(n));
  if (naicsMatches.length > 0) {
    const naicsPoints = Math.min(naicsMatches.length * 10, 20);
    score += naicsPoints;
    reasons.push(`NAICS match: ${naicsMatches.join(', ')} (+${naicsPoints})`);
  }

  // Federal contract history (20 points max)
  if (partner.federalContracts) {
    const fc = partner.federalContracts;

    // Contract volume
    if (fc.contractCount > 10) {
      score += 10;
      reasons.push(`${fc.contractCount} federal contracts (+10)`);
    } else if (fc.contractCount > 5) {
      score += 5;
      reasons.push(`${fc.contractCount} federal contracts (+5)`);
    }

    // Agency experience match
    if (criteria.agencyExperience) {
      const hasAgency = fc.topAgencies.some((a) =>
        a.agency.toLowerCase().includes(criteria.agencyExperience!.toLowerCase())
      );
      if (hasAgency) {
        score += 10;
        reasons.push(`Experience with ${criteria.agencyExperience} (+10)`);
      }
    }
  }

  // Existing relationship (10 points max)
  if (partner.relationshipStatus) {
    switch (partner.relationshipStatus) {
      case 'active_partner':
        score += 10;
        reasons.push('Active teaming partner (+10)');
        break;
      case 'past_partner':
        score += 8;
        reasons.push('Previous teaming partner (+8)');
        break;
      case 'contacted':
        score += 3;
        reasons.push('Previously contacted (+3)');
        break;
      case 'do_not_use':
        score -= 50; // Major deduction
        reasons.push('Flagged as do-not-use (-50)');
        break;
    }
  }

  // Active registration (10 points)
  if (partner.registrationStatus === 'Active' && !partner.expirationWarning) {
    score += 10;
    reasons.push('Active SAM registration (+10)');
  } else if (partner.expirationWarning) {
    score -= 5;
    reasons.push(`${partner.expirationWarning} (-5)`);
  }

  return {
    score: Math.max(0, Math.min(score, 100)),
    reasons,
  };
}

// ============================================================
// Formatting
// ============================================================

/**
 * Extract certifications from SAM entity
 */
function extractCertifications(entity: SAMEntity): string[] {
  const certs: string[] = [];

  if (entity.certifications?.is8a) certs.push('8(a)');
  if (entity.certifications?.isWOSB) certs.push('WOSB');
  if (entity.certifications?.isEDWOSB) certs.push('EDWOSB');
  if (entity.certifications?.isSDVOSB) certs.push('SDVOSB');
  if (entity.certifications?.isHUBZone) certs.push('HUBZone');
  if (entity.isSmallBusiness) certs.push('Small Business');

  return certs;
}

/**
 * Format location from SAM entity
 */
function formatLocation(entity: SAMEntity): string {
  const addr = entity.physicalAddress;
  if (!addr) return 'Unknown';

  const parts: string[] = [];
  if (addr.city) parts.push(addr.city);
  if (addr.state || addr.stateOrProvinceCode) {
    parts.push(addr.state || addr.stateOrProvinceCode || '');
  }

  return parts.join(', ') || 'Unknown';
}

/**
 * Deduplicate entities by UEI
 */
function deduplicateByUEI(entities: SAMEntity[]): SAMEntity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    if (seen.has(e.ueiSAM)) return false;
    seen.add(e.ueiSAM);
    return true;
  });
}

/**
 * Format partner for display
 */
export function formatPartnerForDisplay(partner: EnrichedPartner): string {
  const lines = [
    `**${partner.name}**`,
    `Location: ${partner.location}`,
    `Certifications: ${partner.certifications.join(', ') || 'None'}`,
  ];

  if (partner.federalContracts) {
    const amount = (partner.federalContracts.totalAwarded / 1000000).toFixed(1);
    lines.push(`Federal Contracts: $${amount}M (${partner.federalContracts.contractCount} awards)`);

    if (partner.federalContracts.topAgencies.length > 0) {
      const agencies = partner.federalContracts.topAgencies.slice(0, 3).map((a) => a.agency);
      lines.push(`Top Agencies: ${agencies.join(', ')}`);
    }
  }

  if (partner.relationshipStatus && partner.relationshipStatus !== 'prospect') {
    lines.push(`Relationship: ${partner.relationshipStatus.replace('_', ' ')}`);
  }

  lines.push(`Relevance Score: ${partner.relevanceScore}/100`);
  lines.push(`Factors: ${partner.relevanceReasons.join('; ')}`);

  return lines.join('\n');
}

/**
 * Format partners for Slack message
 */
export function formatPartnersForSlack(result: PartnerDiscoveryResult): string {
  const lines = [
    `:mag: *Partner Search Results*`,
    `Found ${result.totalFound} potential partners | Top ${result.partners.length} shown`,
    `Sources: ${result.sources.join(', ')}`,
    '',
  ];

  for (let i = 0; i < Math.min(result.partners.length, 5); i++) {
    const p = result.partners[i];
    const emoji =
      p.relevanceScore >= 70
        ? ':star:'
        : p.relevanceScore >= 50
          ? ':white_check_mark:'
          : ':small_blue_diamond:';

    lines.push(`${emoji} *${i + 1}. ${p.name}* (${p.relevanceScore}/100)`);
    lines.push(`   ${p.certifications.join(', ') || 'No certs'} | ${p.location}`);

    if (p.federalContracts) {
      const amount = (p.federalContracts.totalAwarded / 1000000).toFixed(1);
      lines.push(`   $${amount}M in federal contracts`);
    }

    if (p.relationshipStatus && p.relationshipStatus !== 'prospect') {
      lines.push(`   _${p.relationshipStatus.replace('_', ' ')}_`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Outreach Email Generation
// ============================================================

export interface OutreachParams {
  partner: EnrichedPartner;
  opportunity: {
    title: string;
    agency: string;
    setAside?: string;
    dueDate?: string;
  };
  capabilityNeed: string;
  senderName: string;
  senderCompany: string;
}

/**
 * Generate draft outreach email for a partner
 */
export function generateOutreachEmail(params: OutreachParams): string {
  const { partner, opportunity, capabilityNeed, senderName, senderCompany } = params;

  const greeting = partner.contactName ? `Hi ${partner.contactName.split(' ')[0]},` : 'Hello,';

  const setAsideText = opportunity.setAside ? `a ${opportunity.setAside} ` : 'an ';

  const dueDateText = opportunity.dueDate
    ? ` with responses due ${new Date(opportunity.dueDate).toLocaleDateString()}`
    : '';

  // Identify partner strength to reference
  let partnerStrength = '';
  if (partner.federalContracts && partner.federalContracts.topAgencies.length > 0) {
    const topAgency = partner.federalContracts.topAgencies[0].agency;
    partnerStrength = `strong track record with ${topAgency}`;
  } else if (partner.certifications.length > 0) {
    partnerStrength = `${partner.certifications[0]} certification`;
  } else {
    partnerStrength = `expertise in our target market`;
  }

  return `Subject: Teaming Opportunity - ${opportunity.agency} ${opportunity.title.slice(0, 40)}

${greeting}

I'm reaching out from ${senderCompany} regarding ${opportunity.title}, ${setAsideText}opportunity with ${opportunity.agency}${dueDateText}.

We're building a team and looking for a partner with ${capabilityNeed}. I noticed ${partner.name}'s ${partnerStrength}, which would complement our capabilities well.

Would you be open to a brief call this week to discuss potential teaming?

I can share more details on the opportunity and our proposed approach. Looking forward to hearing from you.

Best regards,
${senderName}
${senderCompany}`;
}
