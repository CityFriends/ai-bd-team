/**
 * David Competitive & Market Intelligence — Type Definitions
 *
 * All types, Zod schemas, and contracts for David's intelligence
 * capabilities. David produces competitive briefs, market briefs,
 * forecast signals, and event briefs. He operates in two modes:
 *
 *   CAPTURE_INTELLIGENCE — reactive, dispatched by James during capture
 *   MARKET_INTELLIGENCE  — proactive, event-driven signal monitoring
 *
 * David does NOT make GO/NO-GO decisions. He provides evidence and
 * recommendations for James and human decision-makers.
 */

import { z } from 'zod';

// ============================================================
// Trigger Types
// ============================================================

/**
 * How a David intelligence task was initiated.
 *
 * CAPTURE_REQUEST     — James requests research during capture
 * FORECAST_SIGNAL     — Proactive forecast monitoring detected change
 * COMPETITIVE_SIGNAL  — Proactive competitive landscape change
 * GOVCON_EVENT        — GovCon event detected (industry day, etc.)
 * HUMAN_REQUEST       — Direct request from a human operator
 */
export const DavidTriggerType = {
  CAPTURE_REQUEST: 'CAPTURE_REQUEST',
  FORECAST_SIGNAL: 'FORECAST_SIGNAL',
  COMPETITIVE_SIGNAL: 'COMPETITIVE_SIGNAL',
  GOVCON_EVENT: 'GOVCON_EVENT',
  HUMAN_REQUEST: 'HUMAN_REQUEST',
} as const;

export type DavidTriggerTypeValue =
  (typeof DavidTriggerType)[keyof typeof DavidTriggerType];

// ============================================================
// Task Status
// ============================================================

/**
 * David task lifecycle: pending -> in_progress -> completed / failed / skipped
 */
export const DavidTaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type DavidTaskStatusValue =
  (typeof DavidTaskStatus)[keyof typeof DavidTaskStatus];

// ============================================================
// Research Types (James Integration)
// ============================================================

/**
 * Types of research James can request from David.
 * Each maps to specific G2X tool combinations and artifact outputs.
 */
export const DavidResearchType = {
  INCUMBENT_ANALYSIS: 'INCUMBENT_ANALYSIS',
  COMPETITOR_ANALYSIS: 'COMPETITOR_ANALYSIS',
  CUSTOMER_BUYING_PATTERN: 'CUSTOMER_BUYING_PATTERN',
  CONTRACT_HISTORY: 'CONTRACT_HISTORY',
  RECOMPETE_CONTEXT: 'RECOMPETE_CONTEXT',
  ACQUISITION_MARKET_CONTEXT: 'ACQUISITION_MARKET_CONTEXT',
} as const;

export type DavidResearchTypeValue =
  (typeof DavidResearchType)[keyof typeof DavidResearchType];

// ============================================================
// Recommendations
// ============================================================

/**
 * David's actionable recommendations.
 * These are advisory — David never makes GO/NO-GO decisions.
 */
export const DavidRecommendation = {
  ATTEND_EVENT: 'ATTEND_EVENT',
  WATCH_FORECAST: 'WATCH_FORECAST',
  INVESTIGATE_INCUMBENT: 'INVESTIGATE_INCUMBENT',
  INVESTIGATE_COMPETITOR: 'INVESTIGATE_COMPETITOR',
  WATCH_RECOMPETE: 'WATCH_RECOMPETE',
  CONSIDER_TEAMING_COMPANY: 'CONSIDER_TEAMING_COMPANY',
  GATHER_MORE_EVIDENCE: 'GATHER_MORE_EVIDENCE',
  NO_ACTION: 'NO_ACTION',
} as const;

export type DavidRecommendationValue =
  (typeof DavidRecommendation)[keyof typeof DavidRecommendation];

// ============================================================
// Artifact Types
// ============================================================

/**
 * Types of intelligence artifacts David produces.
 */
export const DavidArtifactType = {
  COMPETITIVE_BRIEF: 'COMPETITIVE_BRIEF',
  CUSTOMER_MARKET_BRIEF: 'CUSTOMER_MARKET_BRIEF',
  FORECAST_SIGNAL: 'FORECAST_SIGNAL',
  EVENT_BRIEF: 'EVENT_BRIEF',
} as const;

export type DavidArtifactTypeValue =
  (typeof DavidArtifactType)[keyof typeof DavidArtifactType];

// ============================================================
// Confidence Levels
// ============================================================

export const ConfidenceLevel = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type ConfidenceLevelValue =
  (typeof ConfidenceLevel)[keyof typeof ConfidenceLevel];

// ============================================================
// Research Request (from James)
// ============================================================

/**
 * Research request schema — sent by James to David during capture.
 * David uses this to scope G2X research and produce artifacts.
 */
export const DavidResearchRequestSchema = z.object({
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity being evaluated */
  opportunityId: z.string().max(200),
  /** Specific research question */
  question: z.string().max(500),
  /** Type of research requested */
  researchType: z.enum([
    'INCUMBENT_ANALYSIS',
    'COMPETITOR_ANALYSIS',
    'CUSTOMER_BUYING_PATTERN',
    'CONTRACT_HISTORY',
    'RECOMPETE_CONTEXT',
    'ACQUISITION_MARKET_CONTEXT',
  ]),
  /** Expected artifact output type */
  expectedArtifact: z.enum([
    'COMPETITIVE_BRIEF',
    'CUSTOMER_MARKET_BRIEF',
    'FORECAST_SIGNAL',
    'EVENT_BRIEF',
  ]),
  /** Supporting evidence references from James */
  evidenceRefs: z.array(z.string().max(500)).max(5),
  /** Optional deadline for time-sensitive research */
  deadline: z.string().datetime().optional(),
});

export type DavidResearchRequest = z.infer<typeof DavidResearchRequestSchema>;

// ============================================================
// Research Result (to James)
// ============================================================

/**
 * Research result schema — returned by David to James after
 * completing a research task. Contains findings, evidence,
 * and any unresolved questions.
 */
export const DavidResearchResultSchema = z.object({
  /** David task ID */
  taskId: z.string().uuid(),
  /** Type of artifact produced */
  artifactType: z.enum([
    'COMPETITIVE_BRIEF',
    'CUSTOMER_MARKET_BRIEF',
    'FORECAST_SIGNAL',
    'EVENT_BRIEF',
  ]),
  /** Executive summary of findings */
  summary: z.string().max(1000),
  /** Individual findings with detail */
  findings: z.array(z.string().max(500)).max(10),
  /** Evidence references supporting findings */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** Questions David could not resolve — may prompt further research */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
  /** Overall confidence in the research result */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type DavidResearchResult = z.infer<typeof DavidResearchResultSchema>;

// ============================================================
// Intelligence Artifacts
// ============================================================

/**
 * Competitive brief — analysis of a specific competitor for
 * a given opportunity or market segment.
 */
export const CompetitiveBriefSchema = z.object({
  /** Company under analysis */
  company: z.string().max(200),
  /** Relevant contract awards */
  relevantAwards: z.array(z.object({
    awardId: z.string().max(200),
    title: z.string().max(300),
    agency: z.string().max(200),
    value: z.string().max(100),
    period: z.string().max(100),
  })).max(10),
  /** Customer relationship history */
  customerHistory: z.string().max(1000),
  /** Known contract values and ranges */
  contractValues: z.string().max(500),
  /** Contract vehicles the competitor holds */
  vehicles: z.array(z.string().max(200)).max(10),
  /** Competitive position assessment */
  competitivePosition: z.string().max(500),
  /** Recompete context if applicable */
  recompeteContext: z.string().max(500).nullable(),
  /** Competitor strengths relative to FFTC */
  strengths: z.array(z.string().max(300)).max(5),
  /** Risks and weaknesses */
  risks: z.array(z.string().max(300)).max(5),
  /** What this means for FFTC's positioning */
  fftcImplications: z.string().max(500),
  /** Source provenance references */
  provenance: z.array(z.string().max(500)).max(10),
});

export type CompetitiveBrief = z.infer<typeof CompetitiveBriefSchema>;

/**
 * Customer/market brief — analysis of an agency's buying
 * patterns, procurement history, and FFTC alignment.
 */
export const CustomerMarketBriefSchema = z.object({
  /** Agency under analysis */
  agency: z.string().max(200),
  /** Key programs relevant to FFTC capabilities */
  programs: z.array(z.object({
    name: z.string().max(200),
    description: z.string().max(300),
    status: z.string().max(100),
  })).max(10),
  /** Historical procurement patterns */
  procurementHistory: z.string().max(1000),
  /** Buying pattern analysis */
  buyingPatterns: z.string().max(1000),
  /** Contract vehicles the agency uses */
  vehicles: z.array(z.string().max(200)).max(10),
  /** Active or upcoming forecast activity */
  forecastActivity: z.string().max(500),
  /** Acquisition tendency analysis */
  acquisitionTendencies: z.string().max(500),
  /** How FFTC capabilities align with this agency */
  fftcAlignment: z.string().max(500),
  /** Source provenance references */
  provenance: z.array(z.string().max(500)).max(10),
});

export type CustomerMarketBrief = z.infer<typeof CustomerMarketBriefSchema>;

/**
 * Forecast signal artifact — a pre-solicitation or forecast
 * opportunity with maturity assessment.
 */
export const ForecastSignalArtifactSchema = z.object({
  /** G2X or SAM forecast identifier */
  forecastId: z.string().max(200),
  /** Procuring customer/agency */
  customer: z.string().max(200),
  /** Expected scope of work */
  expectedScope: z.string().max(500),
  /** Expected timing/schedule */
  expectedTiming: z.string().max(200),
  /** Contract vehicle if known */
  vehicleIfKnown: z.string().max(200).nullable(),
  /** Set-aside category if known */
  setAsideIfKnown: z.string().max(200).nullable(),
  /** Maturity of the forecast signal */
  maturity: z.enum(['EARLY', 'DEVELOPING', 'MATURE', 'IMMINENT']),
  /** Confidence in signal accuracy */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  /** How this connects to FFTC capabilities or pursuits */
  fftcConnection: z.string().max(500),
  /** Recommended next action */
  recommendedAction: z.enum([
    'ATTEND_EVENT', 'WATCH_FORECAST', 'INVESTIGATE_INCUMBENT',
    'INVESTIGATE_COMPETITOR', 'WATCH_RECOMPETE', 'CONSIDER_TEAMING_COMPANY',
    'GATHER_MORE_EVIDENCE', 'NO_ACTION',
  ]),
  /** Source provenance references */
  provenance: z.array(z.string().max(500)).max(10),
});

export type ForecastSignalArtifact = z.infer<typeof ForecastSignalArtifactSchema>;

/**
 * Event brief — analysis of a GovCon event (industry day,
 * conference, vendor outreach) and its relevance to FFTC.
 */
export const EventBriefArtifactSchema = z.object({
  /** Event name */
  eventName: z.string().max(300),
  /** Date range of the event */
  dateRange: z.string().max(100),
  /** Physical location */
  location: z.string().max(300),
  /** Virtual/hybrid status */
  virtualStatus: z.enum(['IN_PERSON', 'VIRTUAL', 'HYBRID', 'UNKNOWN']),
  /** Organizing entity */
  organizer: z.string().max(200),
  /** Associated agency if applicable */
  agencyAssociation: z.string().max(200).nullable(),
  /** Why FFTC should care about this event */
  whyFftcCares: z.string().max(500),
  /** Connection to active pursuit if any */
  pursuitConnection: z.string().max(300).nullable(),
  /** Notable speakers or participants */
  speakers: z.array(z.object({
    name: z.string().max(200),
    title: z.string().max(200),
    organization: z.string().max(200),
  })).max(10),
  /** Registration deadline if known */
  registrationDeadline: z.string().max(100).nullable(),
  /** Recommended action */
  recommendedAction: z.enum(['ATTEND', 'WATCH', 'PASS']),
  /** Source provenance references */
  provenance: z.array(z.string().max(500)).max(10),
});

export type EventBriefArtifact = z.infer<typeof EventBriefArtifactSchema>;

// ============================================================
// Intelligence Profiles
// ============================================================

/**
 * Company intelligence profile — durable, incrementally updated
 * profile of a competitor or teaming partner.
 */
export const CompanyIntelligenceProfileSchema = z.object({
  /** Unique Entity Identifier */
  uei: z.string().max(20),
  /** Company name */
  name: z.string().max(200),
  /** Summary of recent awards */
  awardsSummary: z.string().max(1000),
  /** Contract vehicles held */
  vehicles: z.array(z.string().max(200)).max(20),
  /** Active certifications (8(a), HUBZone, etc.) */
  certifications: z.array(z.string().max(100)).max(10),
  /** Key contracts relevant to FFTC's market */
  keyContracts: z.array(z.object({
    title: z.string().max(300),
    agency: z.string().max(200),
    value: z.string().max(100),
    period: z.string().max(100),
  })).max(10),
  /** Overall competitive assessment */
  competitiveAssessment: z.string().max(500),
  /** When this profile was last refreshed from sources */
  lastRefreshed: z.string().datetime(),
  /** Evidence references supporting the profile */
  evidenceRefs: z.array(z.string().max(500)).max(20),
});

export type CompanyIntelligenceProfile = z.infer<typeof CompanyIntelligenceProfileSchema>;

/**
 * Agency intelligence profile — durable, incrementally updated
 * profile of a procuring agency.
 */
export const AgencyIntelligenceProfileSchema = z.object({
  /** Agency code (e.g., DOD, HHS, VA) */
  agencyCode: z.string().max(20),
  /** Full agency name */
  name: z.string().max(200),
  /** Key programs */
  programs: z.array(z.object({
    name: z.string().max(200),
    description: z.string().max(300),
    status: z.string().max(100),
  })).max(20),
  /** Buying pattern analysis */
  buyingPatterns: z.string().max(1000),
  /** Recent forecast activity */
  recentForecasts: z.array(z.object({
    forecastId: z.string().max(200),
    title: z.string().max(300),
    maturity: z.string().max(50),
  })).max(10),
  /** Recent events associated with this agency */
  recentEvents: z.array(z.object({
    eventId: z.string().max(200),
    name: z.string().max(300),
    date: z.string().max(100),
  })).max(10),
  /** Contract vehicles this agency uses */
  vehicles: z.array(z.string().max(200)).max(20),
  /** FFTC's history with this agency */
  fftcHistory: z.string().max(500),
  /** When this profile was last refreshed */
  lastRefreshed: z.string().datetime(),
  /** Evidence references */
  evidenceRefs: z.array(z.string().max(500)).max(20),
});

export type AgencyIntelligenceProfile = z.infer<typeof AgencyIntelligenceProfileSchema>;

// ============================================================
// Proactive Relevance Scoring
// ============================================================

/**
 * Relevance scoring for proactive intelligence signals.
 * Determines whether a signal is worth surfacing.
 */
export const ProactiveRelevanceScoreSchema = z.object({
  /** Overall relevance score (0-100) */
  totalScore: z.number().int().min(0).max(100),
  /** Scoring dimensions with individual weights */
  dimensions: z.array(z.object({
    name: z.string().max(100),
    score: z.number().int().min(0).max(100),
    weight: z.number().min(0).max(1),
    reason: z.string().max(300),
  })).max(10),
  /** Minimum score to trigger proactive action */
  wakeThreshold: z.number().int().min(0).max(100),
  /** Signals that contributed to the score */
  signalsMatched: z.array(z.string().max(200)).max(10),
  /** Whether there is an active related pursuit */
  activeRelatedPursuit: z.boolean(),
});

export type ProactiveRelevanceScore = z.infer<typeof ProactiveRelevanceScoreSchema>;

// ============================================================
// Partner Intelligence
// ============================================================

/**
 * Partner/teaming candidate identified during intelligence work.
 * Advisory only — David does not initiate teaming conversations.
 */
export const PartnerIntelligenceCandidateSchema = z.object({
  /** Company name */
  company: z.string().max(200),
  /** Why this company is a potential partner */
  reason: z.string().max(500),
  /** Related opportunity if applicable */
  relatedOpportunity: z.string().max(200).nullable(),
  /** Supporting evidence */
  evidence: z.array(z.string().max(500)).max(5),
  /** Confidence in the recommendation */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  /** Suggested research question for further investigation */
  recommendedResearchQuestion: z.string().max(500),
});

export type PartnerIntelligenceCandidate = z.infer<typeof PartnerIntelligenceCandidateSchema>;

// ============================================================
// Research Envelope Constants
// ============================================================

/**
 * Per-signal G2X call budget.
 * David is bounded per signal to prevent runaway research.
 */
export const MAX_G2X_CALLS_PER_SIGNAL = 8;

/**
 * Per-signal record retrieval budget.
 * Prevents excessive data ingestion per research task.
 */
export const MAX_RECORDS_PER_SIGNAL = 100;

/**
 * Maximum LLM reasoning calls David may make per task.
 * David's LLM usage is tightly constrained — most work
 * is structured G2X data retrieval, not free-form reasoning.
 */
export const MAX_DAVID_REASONING_CALLS = 1;

// ============================================================
// David G2X Allowed Tools
// ============================================================

/**
 * G2X tools David is authorized to invoke.
 * Any tool not in this list is DENIED regardless of
 * remote availability via tools/list.
 */
export const DAVID_G2X_ALLOWED_TOOLS = [
  'g2x_search_companies',
  'g2x_company_contract_history',
  'g2x_search_records',
  'g2x_get_record',
  'g2x_forecast_scan',
  'g2x_search_events',
  'g2x_get_event',
  'g2x_get_graph_neighborhood',
] as const;

export type DavidG2XAllowedTool = (typeof DAVID_G2X_ALLOWED_TOOLS)[number];

// ============================================================
// Watched Signal Types
// ============================================================

/**
 * Types of signals David can watch proactively.
 */
export const WatchedSignalType = {
  FORECAST: 'FORECAST',
  EVENT: 'EVENT',
  COMPANY: 'COMPANY',
  RECOMPETE: 'RECOMPETE',
} as const;

export type WatchedSignalTypeValue =
  (typeof WatchedSignalType)[keyof typeof WatchedSignalType];

/**
 * Status of a watched signal.
 */
export const WatchedSignalStatus = {
  WATCHING: 'WATCHING',
  DISMISSED: 'DISMISSED',
  RESOLVED: 'RESOLVED',
} as const;

export type WatchedSignalStatusValue =
  (typeof WatchedSignalStatus)[keyof typeof WatchedSignalStatus];

// ============================================================
// Event Recommended Actions
// ============================================================

/**
 * Event-specific recommended actions (subset of DavidRecommendation).
 */
export const EventRecommendedAction = {
  ATTEND: 'ATTEND',
  WATCH: 'WATCH',
  PASS: 'PASS',
} as const;

export type EventRecommendedActionValue =
  (typeof EventRecommendedAction)[keyof typeof EventRecommendedAction];

// ============================================================
// Forecast Maturity
// ============================================================

/**
 * Maturity stages for forecast signals.
 */
export const ForecastMaturity = {
  EARLY: 'EARLY',
  DEVELOPING: 'DEVELOPING',
  MATURE: 'MATURE',
  IMMINENT: 'IMMINENT',
} as const;

export type ForecastMaturityValue =
  (typeof ForecastMaturity)[keyof typeof ForecastMaturity];

// ============================================================
// Virtual Status
// ============================================================

/**
 * Event virtual/hybrid classification.
 */
export const VirtualStatus = {
  IN_PERSON: 'IN_PERSON',
  VIRTUAL: 'VIRTUAL',
  HYBRID: 'HYBRID',
  UNKNOWN: 'UNKNOWN',
} as const;

export type VirtualStatusValue =
  (typeof VirtualStatus)[keyof typeof VirtualStatus];
