/**
 * Maya Pipeline Types
 *
 * Canonical opportunity model, source abstraction, review contracts.
 */

// ============================================================
// Source Abstraction
// ============================================================

export interface OpportunityFetchInput {
  since?: Date;
  naicsCodes?: string[];
  limit?: number;
}

export interface RawOpportunity {
  sourceId: string;
  sourceName: string;
  rawPayload: Record<string, unknown>;
}

export interface OpportunitySource {
  sourceName: string;
  fetchChanges(input: OpportunityFetchInput): Promise<RawOpportunity[]>;
  normalize(raw: RawOpportunity): NormalizedOpportunity;
}

// ============================================================
// Canonical Opportunity Model
// ============================================================

export interface NormalizedOpportunity {
  // Identity
  sourceId: string;
  source: string;
  solicitationNumber: string | null;

  // Content
  title: string;
  description: string | null;
  synopsis: string | null;

  // Organization
  agency: string | null;
  subAgency: string | null;
  office: string | null;

  // Classification
  noticeType: string;
  naics: string | null;
  psc: string | null;
  setAside: string | null;
  setAsideDescription: string | null;

  // Timeline
  postedDate: string | null;
  responseDeadline: string | null;

  // Value
  estimatedValue: number | null;

  // Geography
  placeOfPerformance: string | null;

  // Access
  vehicle: string | null;
  sourceUrl: string;

  // Attachments
  attachments: Array<{ name: string; url?: string; type?: string }>;

  // Status
  active: boolean;
  archived: boolean;
  cancelled: boolean;

  // Hashing (for change detection)
  rawHash: string;
  materialHash: string;
}

// ============================================================
// Pipeline Decision
// ============================================================

export type PipelineDecision =
  | 'HARD_EXCLUDE'
  | 'PASS'
  | 'WATCH'
  | 'MAYA_QUICK_REVIEW'
  | 'MAYA_FULL_REVIEW';

export interface HardFilterResult {
  excluded: boolean;
  reason: string | null;
  rule: string | null;
}

export interface FitScoreResult {
  totalScore: number;
  breakdown: FitScoreBreakdown;
  reasons: string[];
  concerns: string[];
  hardExcluded: boolean;
}

export interface FitScoreBreakdown {
  capabilityFit: number; // 0-25
  pastPerformance: number; // 0-20
  agencyFit: number; // 0-15
  setAsideAdvantage: number; // 0-10
  revenueRoleQuality: number; // 0-10
  naicsPscFit: number; // 0-5
  vehicleAccessFit: number; // 0-5
  primeSuitability: number; // 0-5
  timingViability: number; // 0-5
}

export interface StrategicOverride {
  triggered: boolean;
  rules: string[];
}

// ============================================================
// Maya Review Contracts
// ============================================================

export interface QuickReviewInput {
  opportunity: NormalizedOpportunity;
  fitScore: FitScoreResult;
  strategicOverrides: StrategicOverride;
  matchedPastPerformance: PastPerformanceMatch[];
  companyProfile: CompanyProfileSummary;
}

export interface QuickReviewOutput {
  decision: 'PASS' | 'WATCH' | 'FULL_REVIEW';
  confidence: number;
  rationale: string[];
  concerns: string[];
  missingInformation: string[];
}

export interface FullReviewInput extends QuickReviewInput {
  quickReviewResult?: QuickReviewOutput;
}

export interface FullReviewOutput {
  recommendation: 'PASS' | 'WATCH' | 'EVALUATE';
  confidence: number;
  strengths: string[];
  concerns: string[];
  matchedPastPerformance: PastPerformanceMatch[];
  strategicAdvantages: string[];
  researchRequests: ResearchRequest[];
  primeSuitability: 'LOW' | 'MEDIUM' | 'HIGH';
  meaningfulRolePotential: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
}

export type ResearchRequest =
  | 'INCUMBENT'
  | 'AWARD_HISTORY'
  | 'AGENCY'
  | 'COMPETITOR'
  | 'TECHNICAL'
  | 'TEAMING'
  | 'VEHICLE';

// ============================================================
// Past Performance Matching
// ============================================================

export interface PastPerformanceMatch {
  project: string;
  agency: string;
  matchedCapabilities: string[];
  agencyMatch: boolean;
  similarityScore: number;
}

// ============================================================
// Company Profile Summary (for Maya context)
// ============================================================

export interface CompanyProfileSummary {
  name: string;
  primaryNaics: string[];
  certifications: string[];
  setAsides: string[];
  vehicles: string[];
  coreCapabilities: string[];
  agencyExperience: string[];
  securityClearance: string;
  primeSubStrategy: string;
  contractSizeRange: { min: number; max: number };
}

// ============================================================
// Pipeline Result
// ============================================================

export interface PipelineResult {
  opportunity: NormalizedOpportunity;
  decision: PipelineDecision;
  hardFilter: HardFilterResult;
  fitScore: FitScoreResult;
  strategicOverride: StrategicOverride;
  pastPerformanceMatches: PastPerformanceMatch[];
  mayaQuickReview?: QuickReviewOutput;
  mayaFullReview?: FullReviewOutput;
  processedAt: string;
}

// ============================================================
// Scoring Configuration
// ============================================================

export interface ScoringWeights {
  capabilityFit: number;
  pastPerformance: number;
  agencyFit: number;
  setAsideAdvantage: number;
  revenueRoleQuality: number;
  naicsPscFit: number;
  vehicleAccessFit: number;
  primeSuitability: number;
  timingViability: number;
}

export interface ScoringThresholds {
  passArchive: number; // 0-39
  storeWatch: number; // 40-59
  quickReview: number; // 60-79
  fullReview: number; // 80-100
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  capabilityFit: 25,
  pastPerformance: 20,
  agencyFit: 15,
  setAsideAdvantage: 10,
  revenueRoleQuality: 10,
  naicsPscFit: 5,
  vehicleAccessFit: 5,
  primeSuitability: 5,
  timingViability: 5,
};

export const DEFAULT_THRESHOLDS: ScoringThresholds = {
  passArchive: 39,
  storeWatch: 59,
  quickReview: 79,
  fullReview: 100,
};
