/**
 * James Capture Orchestration — Types and Schemas
 *
 * Zod schemas for James decision output, specialist tasks/artifacts,
 * and research needs. All bounded arrays and string lengths.
 */

import { z } from 'zod';

// ============================================================
// Capture Dimension Assessment
// ============================================================

export const CaptureDimensionSchema = z.object({
  assessment: z.enum(['STRONG', 'MODERATE', 'WEAK', 'BLOCKING', 'UNKNOWN']),
  evidenceRefs: z.array(z.string().max(200)).max(5),
  concerns: z.array(z.string().max(200)).max(5),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type CaptureDimensionAssessment = z.infer<typeof CaptureDimensionSchema>;

// ============================================================
// Research Need — what James requests from specialists
// ============================================================

export const ResearchNeedSchema = z.object({
  type: z.enum([
    'COMPETITIVE_INTELLIGENCE',
    'TECHNICAL_ASSESSMENT',
    'PARTNER_SEARCH',
    'ACQUISITION_INTERPRETATION',
  ]),
  question: z.string().max(300),
  whyDecisionBlocking: z.string().max(300),
  evidenceRefs: z.array(z.string().max(200)).max(3).default([]),
  priority: z.enum(['REQUIRED', 'USEFUL']),
});

export type ResearchNeed = z.infer<typeof ResearchNeedSchema>;

// ============================================================
// James Capture Decision — structured output
// ============================================================

export const JamesCaptureDecisionSchema = z.object({
  recommendation: z.enum(['GO', 'NO_GO', 'MORE_RESEARCH_REQUIRED']),
  confidence: z.number().int().min(0).max(100),

  customerFit: CaptureDimensionSchema,
  capabilityFit: CaptureDimensionSchema,
  acquisitionFit: CaptureDimensionSchema,
  competitivePosition: CaptureDimensionSchema,
  deliveryFeasibility: CaptureDimensionSchema,
  businessCase: CaptureDimensionSchema,

  primeSubPosture: z.enum(['PRIME', 'SUB', 'TEAMING_DEPENDENT', 'UNCLEAR']),

  strongestReasonsToPursue: z.array(z.string().max(200)).max(3),
  criticalRisks: z.array(z.string().max(200)).max(3),
  unresolvedQuestions: z.array(z.string().max(200)).max(3),

  requestedResearch: z.array(ResearchNeedSchema).max(4),

  specialistFindingsUsed: z.array(z.string().max(200)).max(5),

  rationale: z.string().max(1500),

  recommendedNextActions: z.array(z.string().max(200)).max(3),
});

export type JamesCaptureDecision = z.infer<typeof JamesCaptureDecisionSchema>;

// ============================================================
// Specialist Artifact — what specialists return
// ============================================================

export const SpecialistArtifactSchema = z.object({
  finding: z.string().max(1000),
  assessment: z.enum(['FAVORABLE', 'MIXED', 'UNFAVORABLE', 'INSUFFICIENT']),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),

  evidence: z
    .array(
      z.object({
        claim: z.string().max(200),
        evidenceRef: z.string().max(200),
      })
    )
    .max(5),

  materialUnsolicitedFindings: z.array(z.string().max(200)).max(3),
  unknowns: z.array(z.string().max(200)).max(3),
  captureImplications: z.array(z.string().max(200)).max(3),
  recommendedFollowup: z.array(z.string().max(200)).max(3),

  schemaVersion: z.number().int().default(1),
});

export type SpecialistArtifact = z.infer<typeof SpecialistArtifactSchema>;

// ============================================================
// Specialist Task Types
// ============================================================

export type SpecialistTaskType =
  | 'COMPETITIVE_INTELLIGENCE'
  | 'TECHNICAL_ASSESSMENT'
  | 'PARTNER_SEARCH'
  | 'ACQUISITION_INTERPRETATION';

export type ResearchAuthority = 'AUTONOMOUS' | 'EXECUTIVE_REQUESTED';

export type ArtifactSource = 'REAL_SPECIALIST' | 'TEST_FIXTURE';

// ============================================================
// Capture Status
// ============================================================

export type CaptureStatus =
  | 'pending'
  | 'initial_assessment'
  | 'researching'
  | 'recommendation_ready'
  | 'pursuit_authorized'
  | 'no_go'
  | 'abandoned';

// ============================================================
// Budget Constants
// ============================================================

export const CAPTURE_BUDGET = {
  /** Maximum AI spend per capture workflow */
  MAX_CAPTURE_USD: 0.25,
  /** James initial assessment task budget */
  INITIAL_ASSESSMENT_USD: 0.1,
  /** James resynthesis task budget */
  RESYNTHESIS_USD: 0.05,
  /** Human-requested research budget */
  EXECUTIVE_RESEARCH_USD: 0.1,
  /** Maximum autonomous research rounds */
  MAX_AUTONOMOUS_ROUNDS: 2,
} as const;

// ============================================================
// Default Specialist Timeout (seconds)
// ============================================================

export const SPECIALIST_TIMEOUT_SECONDS: Record<SpecialistTaskType, number> = {
  COMPETITIVE_INTELLIGENCE: 300,
  TECHNICAL_ASSESSMENT: 300,
  PARTNER_SEARCH: 300,
  ACQUISITION_INTERPRETATION: 180,
};
