/**
 * Requirement Extractor
 *
 * Extracts structured requirement signals from opportunity notice text.
 * Separates primary scope indicators from boilerplate compliance language.
 * Attaches source excerpts and character-offset provenance.
 *
 * This module does NOT determine fit — it produces evidence for downstream
 * capability matching.
 */

export interface RequirementExcerpt {
  text: string;
  charOffset: number;
  context: 'sow_body' | 'attachment' | 'synopsis' | 'title';
}

export interface ExtractedRequirement {
  signal: string;
  excerpts: RequirementExcerpt[];
  inPrimaryScope: boolean;
}

export interface EvidenceQuality {
  classification: 'DETAILED_SOW' | 'PARTIAL_SCOPE' | 'THIN_NOTICE' | 'TITLE_ONLY';
  rationale: string;
  structuredSections: string[];
  descriptionLength: number;
}

/**
 * Indicators that the notice contains structured SOW/PWS content —
 * not just one or two generic terms, but structural evidence of a
 * detailed requirements document.
 */
const STRUCTURAL_SOW_INDICATORS = [
  'performance work statement',
  'statement of work',
  'statement of objectives',
  'scope of work',
  'tasks and deliverables',
  'labor categories',
  'labor category',
  'key personnel',
  'period of performance',
  'contract line item',
  'clin',
  'quality assurance surveillance plan',
  'qasp',
  'phase-in',
  'option year',
  'base year',
  'surge',
] as const;

/**
 * Indicators that distinguish a thin notice from one with partial scope info.
 * These are weaker than structural SOW indicators but suggest the notice
 * describes what work needs to be done.
 */
const SCOPE_DESCRIPTION_INDICATORS = [
  'the contractor shall',
  'the vendor shall',
  'services include',
  'scope includes',
  'responsibilities include',
  'required services',
  'work includes',
  'deliverables include',
  'tasks include',
] as const;

/**
 * Boilerplate sections that should NOT be treated as primary scope.
 * Terms found within 200 chars of these headers are likely compliance
 * checkboxes, not delivery requirements.
 */
const BOILERPLATE_SECTION_HEADERS = [
  'section 508',
  'far clause',
  'dfars',
  'compliance requirements',
  'applicable regulations',
  'terms and conditions',
  'representations and certifications',
  'organizational conflict of interest',
  'security requirements',
  'clearance requirements',
  'travel requirements',
] as const;

/**
 * Assess the evidence quality of the notice text.
 * Does NOT infer scope from keyword count alone.
 */
export function assessEvidenceQuality(
  _title: string,
  description: string | null
): EvidenceQuality {
  if (!description || description.length < 200) {
    return {
      classification: 'TITLE_ONLY',
      rationale: description
        ? `Description too short (${description.length} chars) to establish scope`
        : 'No description available',
      structuredSections: [],
      descriptionLength: description?.length ?? 0,
    };
  }

  const lower = description.toLowerCase();

  // Check for structural SOW indicators
  const foundStructural = STRUCTURAL_SOW_INDICATORS.filter((s) => lower.includes(s));
  const foundScope = SCOPE_DESCRIPTION_INDICATORS.filter((s) => lower.includes(s));

  // DETAILED_SOW requires multiple structural indicators AND substantial length.
  // A notice with "period of performance" and "CLIN" in a 2-paragraph RFI is not
  // a detailed SOW — it's just referencing procurement structure.
  if (foundStructural.length >= 3 && description.length >= 10000 && foundScope.length >= 2) {
    return {
      classification: 'DETAILED_SOW',
      rationale: `${foundStructural.length} structural indicators, ${foundScope.length} scope descriptions, ${description.length} chars`,
      structuredSections: [...foundStructural],
      descriptionLength: description.length,
    };
  }

  if (foundStructural.length >= 1 || foundScope.length >= 1 || description.length >= 3000) {
    return {
      classification: 'PARTIAL_SCOPE',
      rationale: `${foundStructural.length} structural, ${foundScope.length} scope indicators, ${description.length} chars`,
      structuredSections: [...foundStructural],
      descriptionLength: description.length,
    };
  }

  return {
    classification: 'THIN_NOTICE',
    rationale: `No structural SOW indicators, ${description.length} chars`,
    structuredSections: [],
    descriptionLength: description.length,
  };
}

/**
 * Extract requirement signals from notice text.
 *
 * For each signal term found, determines whether it appears in
 * primary scope context (SOW body, task descriptions) or in
 * boilerplate/compliance sections.
 *
 * Returns excerpts with character offsets for provenance.
 */
export function extractRequirements(
  title: string,
  description: string | null,
  signals: string[]
): ExtractedRequirement[] {
  const results: ExtractedRequirement[] = [];
  const fullText = description || '';
  const lower = fullText.toLowerCase();
  const titleLower = title.toLowerCase();

  for (const signal of signals) {
    const signalLower = signal.toLowerCase();
    const excerpts: RequirementExcerpt[] = [];

    // Check title
    if (titleLower.includes(signalLower)) {
      excerpts.push({
        text: title,
        charOffset: 0,
        context: 'title',
      });
    }

    // Find all occurrences in description
    let searchFrom = 0;
    while (searchFrom < lower.length) {
      const idx = lower.indexOf(signalLower, searchFrom);
      if (idx === -1) break;

      // Extract surrounding context (up to 150 chars each side)
      const excerptStart = Math.max(0, idx - 150);
      const excerptEnd = Math.min(fullText.length, idx + signal.length + 150);
      const excerptText = fullText.slice(excerptStart, excerptEnd);

      const context = isInAttachmentSection(fullText, idx)
        ? 'attachment' as const
        : 'sow_body' as const;

      excerpts.push({
        text: excerptText,
        charOffset: idx,
        context,
      });

      searchFrom = idx + signal.length;
    }

    if (excerpts.length > 0) {
      results.push({
        signal,
        excerpts,
        inPrimaryScope: excerpts.some(
          (e) => e.context !== 'title' && !isInBoilerplateSection(fullText, e.charOffset)
        ),
      });
    }
  }

  return results;
}

/**
 * Line-level boilerplate patterns found in SAM.gov notice formatting.
 * A signal match on a line containing any of these patterns is boilerplate,
 * not a technical requirement.
 */
const BOILERPLATE_LINE_PATTERNS = [
  // Agency URLs and contact fields
  "agency's url",
  'url description',
  'email description',
  'agency contact',
  'point of contact',
  'contracting office address',
  'contracting office',
  'contract specialist',
  // Procurement metadata (only exact SAM.gov field labels)
  'solicitation number*',
  'response date/time/zone',
  'recovery act funds',
  'naics code*',
  'product service code*',
  'set-aside*',
  // Generic notice instructions
  'this sources sought',
  'does not constitute a solicitation',
  'market research purposes',
  'no award will result',
  'disclaimer',
  'interested parties',
  // VA-specific boilerplate
  'va.gov',
  'network contracting office',
  'technology acquisition center',
] as const;

/**
 * Check if a character offset falls within a boilerplate section.
 *
 * Two-level check:
 * 1. Section-level: boilerplate headers within 500 chars before offset
 * 2. Line-level: the line containing the match has boilerplate patterns
 */
function isInBoilerplateSection(text: string, offset: number): boolean {
  // Section-level check (original)
  const windowStart = Math.max(0, offset - 500);
  const sectionWindow = text.slice(windowStart, offset).toLowerCase();
  if (BOILERPLATE_SECTION_HEADERS.some((h) => sectionWindow.includes(h))) {
    return true;
  }

  // Line-level check: extract the line containing the offset
  const lineStart = text.lastIndexOf('\n', offset) + 1;
  const lineEnd = text.indexOf('\n', offset);
  const line = text
    .slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
    .toLowerCase();

  if (BOILERPLATE_LINE_PATTERNS.some((p) => line.includes(p))) {
    return true;
  }

  // Nearby-line check: if the surrounding 300 chars contain 3+ distinct
  // boilerplate indicators, this is a metadata section. Threshold of 3
  // avoids false positives when SOW text happens to mention one or two
  // administrative terms.
  const nearbyStart = Math.max(0, offset - 150);
  const nearbyEnd = Math.min(text.length, offset + 150);
  const nearby = text.slice(nearbyStart, nearbyEnd).toLowerCase();
  let nearbyHits = 0;
  for (const p of BOILERPLATE_LINE_PATTERNS) {
    if (nearby.includes(p)) nearbyHits++;
  }
  if (nearbyHits >= 3) return true;

  return false;
}

/**
 * Check if a character offset falls within an attachment-extracted section.
 * SAM.gov attachment text is typically prefixed with "--- download ---".
 */
function isInAttachmentSection(text: string, offset: number): boolean {
  const before = text.slice(Math.max(0, offset - 2000), offset).toLowerCase();
  return before.includes('--- download ---') || before.includes('attachment');
}
