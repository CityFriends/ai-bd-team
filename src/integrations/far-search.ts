// FAR (Federal Acquisition Regulation) search integration
import { getSupabase } from './supabase.js';

export interface FARSection {
  id?: string;
  section_number: string;
  title: string;
  part: number;
  subpart?: string;
  full_text: string;
  summary?: string;
  created_at?: string;
}

export interface FARSearchResult {
  section: FARSection;
  relevance: 'high' | 'medium' | 'low';
  matchType: 'exact' | 'partial' | 'semantic';
}

// FAR Parts reference for context
export const FAR_PARTS: Record<number, string> = {
  1: 'Federal Acquisition Regulations System',
  2: 'Definitions of Words and Terms',
  3: 'Improper Business Practices and Personal Conflicts of Interest',
  4: 'Administrative and Information Matters',
  5: 'Publicizing Contract Actions',
  6: 'Competition Requirements',
  7: 'Acquisition Planning',
  8: 'Required Sources of Supplies and Services',
  9: 'Contractor Qualifications',
  10: 'Market Research',
  11: 'Describing Agency Needs',
  12: 'Acquisition of Commercial Products and Services',
  13: 'Simplified Acquisition Procedures',
  14: 'Sealed Bidding',
  15: 'Contracting by Negotiation',
  16: 'Types of Contracts',
  17: 'Special Contracting Methods',
  18: 'Emergency Acquisitions',
  19: 'Small Business Programs',
  22: 'Application of Labor Laws to Government Acquisitions',
  23: 'Environment, Energy and Water Efficiency, Renewable Energy Technologies, Occupational Safety, and Drug-Free Workplace',
  25: 'Foreign Acquisition',
  27: 'Patents, Data, and Copyrights',
  28: 'Bonds and Insurance',
  29: 'Taxes',
  30: 'Cost Accounting Standards Administration',
  31: 'Contract Cost Principles and Procedures',
  32: 'Contract Financing',
  33: 'Protests, Disputes, and Appeals',
  34: 'Major System Acquisition',
  35: 'Research and Development Contracting',
  36: 'Construction and Architect-Engineer Contracts',
  37: 'Service Contracting',
  38: 'Federal Supply Schedule Contracting',
  39: 'Acquisition of Information Technology',
  40: 'Reserved',
  41: 'Acquisition of Utility Services',
  42: 'Contract Administration and Audit Services',
  43: 'Contract Modifications',
  44: 'Subcontracting Policies and Procedures',
  45: 'Government Property',
  46: 'Quality Assurance',
  47: 'Transportation',
  48: 'Value Engineering',
  49: 'Termination of Contracts',
  50: 'Extraordinary Contractual Actions and the Safety Act',
  51: 'Use of Government Sources by Contractors',
  52: 'Solicitation Provisions and Contract Clauses',
  53: 'Forms',
};

// Common FAR topics and their relevant sections
const TOPIC_SECTIONS: Record<string, string[]> = {
  'past performance': ['15.304', '15.305', '42.1501', '42.1502', '42.1503'],
  'evaluation factors': ['15.304', '15.305', '15.306'],
  'source selection': ['15.101', '15.102', '15.303', '15.304', '15.305', '15.308'],
  'best value': ['15.101', '15.101-1', '15.101-2'],
  'task order': ['16.505', '16.501', '16.504'],
  idiq: ['16.501', '16.504', '16.505'],
  'small business': ['19.501', '19.502', '19.505', '19.702'],
  subcontracting: ['19.702', '19.703', '19.704', '44.201', '44.202'],
  'organizational conflict': ['9.505', '9.505-1', '9.505-2', '9.505-3', '9.505-4'],
  oci: ['9.505', '9.505-1', '9.505-2', '9.505-3', '9.505-4'],
  protest: ['33.101', '33.102', '33.103', '33.104', '33.105'],
  debriefing: ['15.505', '15.506'],
  pricing: ['15.402', '15.403', '15.404'],
  'cost realism': ['15.404-1'],
  discussions: ['15.306', '15.307'],
  teaming: ['9.601', '9.602', '9.603', '9.604'],
  responsibility: ['9.103', '9.104', '9.105'],
  specifications: ['11.101', '11.102', '11.104'],
  'brand name': ['11.104', '11.105'],
  'market research': ['10.001', '10.002'],
  competition: ['6.101', '6.102', '6.301', '6.302'],
  'sole source': ['6.302', '6.302-1', '6.302-2', '6.303'],
  justification: ['6.303', '6.304'],
  'contract types': ['16.101', '16.102', '16.103', '16.104'],
  'fixed price': ['16.201', '16.202', '16.203'],
  'cost reimbursement': ['16.301', '16.302', '16.303', '16.304', '16.305', '16.306', '16.307'],
  modifications: ['43.101', '43.102', '43.103'],
  changes: ['43.201', '43.202', '43.203', '43.204', '43.205'],
  termination: ['49.101', '49.102', '49.103', '49.104'],
  option: ['17.201', '17.202', '17.203', '17.204', '17.205', '17.206', '17.207', '17.208'],
  warranty: [
    '46.701',
    '46.702',
    '46.703',
    '46.704',
    '46.705',
    '46.706',
    '46.707',
    '46.708',
    '46.709',
    '46.710',
  ],
};

// Direct lookup by section number (e.g., "FAR 15.304" or "15.304")
export async function lookupFARSection(sectionNumber: string): Promise<FARSection | null> {
  const supabase = getSupabase();

  // Normalize the section number
  const normalized = sectionNumber
    .replace(/^FAR\s*/i, '')
    .replace(/^§\s*/, '')
    .trim();

  const { data, error } = await supabase
    .from('far_sections')
    .select()
    .eq('section_number', normalized)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.warn('FAR lookup error:', error);
  }

  return data || null;
}

// Search FAR by keyword/topic
export async function searchFAR(query: string, limit: number = 5): Promise<FARSearchResult[]> {
  const supabase = getSupabase();
  const results: FARSearchResult[] = [];
  const seenSections = new Set<string>();

  // 1. Check for direct section reference (e.g., "FAR 15.304")
  const sectionMatch = query.match(/(?:FAR\s*)?(\d{1,2}\.\d{3}(?:-\d+)?(?:\([a-z]\))?)/i);
  if (sectionMatch) {
    const section = await lookupFARSection(sectionMatch[1]);
    if (section) {
      results.push({
        section,
        relevance: 'high',
        matchType: 'exact',
      });
      seenSections.add(section.section_number);
    }
  }

  // 2. Check for topic-based sections
  const queryLower = query.toLowerCase();
  for (const [topic, sections] of Object.entries(TOPIC_SECTIONS)) {
    if (queryLower.includes(topic)) {
      for (const sectionNum of sections) {
        if (!seenSections.has(sectionNum)) {
          const section = await lookupFARSection(sectionNum);
          if (section) {
            results.push({
              section,
              relevance: 'high',
              matchType: 'semantic',
            });
            seenSections.add(sectionNum);
          }
        }
        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }

  // 3. Full-text search if we still need more results
  if (results.length < limit) {
    const searchTerms = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 3);

    if (searchTerms.length > 0) {
      // Search in title and full_text
      const { data, error } = await supabase
        .from('far_sections')
        .select()
        .or(searchTerms.map((term) => `title.ilike.%${term}%,full_text.ilike.%${term}%`).join(','))
        .limit(limit * 2);

      if (!error && data) {
        for (const section of data) {
          if (!seenSections.has(section.section_number)) {
            // Determine relevance based on match location
            const titleMatch = searchTerms.some((term) =>
              section.title.toLowerCase().includes(term)
            );

            results.push({
              section,
              relevance: titleMatch ? 'high' : 'medium',
              matchType: 'partial',
            });
            seenSections.add(section.section_number);

            if (results.length >= limit) break;
          }
        }
      }
    }
  }

  // Sort by relevance
  results.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.relevance] - order[b.relevance];
  });

  return results.slice(0, limit);
}

// Get sections by part number
export async function getFARPart(partNumber: number): Promise<FARSection[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('far_sections')
    .select()
    .eq('part', partNumber)
    .order('section_number');

  if (error) {
    console.warn('FAR part lookup error:', error);
    return [];
  }

  return data || [];
}

// Format a FAR section for agent response
export function formatFARCitation(section: FARSection): string {
  const partName = FAR_PARTS[section.part] || 'Unknown Part';
  return `FAR ${section.section_number} (${section.title}) - Part ${section.part}: ${partName}`;
}

// Format multiple results for agent context
export function formatFARResults(results: FARSearchResult[]): string {
  if (results.length === 0) {
    return 'No relevant FAR sections found.';
  }

  const formatted = results.map((r) => {
    const section = r.section;
    const citation = `FAR ${section.section_number}`;
    const summary = section.summary || section.full_text.slice(0, 200) + '...';

    return `${citation}: ${section.title}\n${summary}`;
  });

  return formatted.join('\n\n');
}

// Check if a query is FAR-related
export function isFARQuery(text: string): boolean {
  const farIndicators = [
    /\bFAR\b/i,
    /\bfederal acquisition/i,
    /\bacquisition regulation/i,
    /\bFAR\s*\d+\.\d+/i,
    /\b(part|subpart|section)\s*\d+/i,
    /\bCFR\s*48\b/i,
  ];

  const topicIndicators = [
    /\bpast performance\b/i,
    /\bevaluation factor/i,
    /\bsource selection\b/i,
    /\bbest value\b/i,
    /\btask order\b/i,
    /\bidiq\b/i,
    /\borganizational conflict/i,
    /\bOCI\b/,
    /\bprotest\b/i,
    /\bdebriefing\b/i,
    /\bsole source\b/i,
    /\bjustification\b/i,
    /\bteaming agreement/i,
    /\bsubcontracting plan/i,
  ];

  return farIndicators.some((r) => r.test(text)) || topicIndicators.some((r) => r.test(text));
}

// Get relevant FAR context for a conversation
export async function getFARContext(query: string): Promise<string | null> {
  if (!isFARQuery(query)) {
    return null;
  }

  const results = await searchFAR(query, 3);

  if (results.length === 0) {
    return null;
  }

  return `\n\nRELEVANT FAR SECTIONS:\n${formatFARResults(results)}`;
}
