/**
 * Marcus Technical Intelligence — Type Definitions
 *
 * All types, Zod schemas, and contracts for Marcus's technical
 * intelligence capabilities. Marcus produces technical assessments,
 * preliminary solution architectures, ROMs, clarification questions,
 * decisive blockers, and teaming candidates. He operates in multiple modes:
 *
 *   CAPTURE_REQUEST  — reactive, dispatched by James during capture
 *   PURSUIT_CHANGE   — reactive, triggered by material technical change
 *   HUMAN_REQUEST    — direct request from a human operator
 *
 * Marcus does NOT make GO/NO-GO decisions. He provides technical
 * evidence and recommendations for James and human decision-makers.
 */

import { z } from 'zod';

// ============================================================
// Trigger Types
// ============================================================

/**
 * How a Marcus technical task was initiated.
 *
 * CAPTURE_REQUEST — James requests technical research during capture
 * PURSUIT_CHANGE  — Material technical change detected in pursuit
 * HUMAN_REQUEST   — Direct request from a human operator
 */
export const MarcusTriggerType = {
  CAPTURE_REQUEST: 'CAPTURE_REQUEST',
  PURSUIT_CHANGE: 'PURSUIT_CHANGE',
  HUMAN_REQUEST: 'HUMAN_REQUEST',
} as const;

export type MarcusTriggerTypeValue =
  (typeof MarcusTriggerType)[keyof typeof MarcusTriggerType];

// ============================================================
// Task Status
// ============================================================

/**
 * Marcus task lifecycle: pending -> in_progress -> completed / failed / skipped
 */
export const MarcusTaskStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type MarcusTaskStatusValue =
  (typeof MarcusTaskStatus)[keyof typeof MarcusTaskStatus];

// ============================================================
// Research Types (James Integration)
// ============================================================

/**
 * Types of technical research James can request from Marcus.
 * Each maps to specific G2X tool combinations and artifact outputs.
 */
export const MarcusResearchType = {
  TECHNICAL_FEASIBILITY: 'TECHNICAL_FEASIBILITY',
  SOLUTION_ARCHITECTURE: 'SOLUTION_ARCHITECTURE',
  SECURITY_COMPLIANCE: 'SECURITY_COMPLIANCE',
  INTEGRATION_ANALYSIS: 'INTEGRATION_ANALYSIS',
  DELIVERY_RISK: 'DELIVERY_RISK',
  TECHNICAL_ROM: 'TECHNICAL_ROM',
  TECHNICAL_CLARIFICATION: 'TECHNICAL_CLARIFICATION',
  TECHNICAL_GAP: 'TECHNICAL_GAP',
} as const;

export type MarcusResearchTypeValue =
  (typeof MarcusResearchType)[keyof typeof MarcusResearchType];

// ============================================================
// Technical Conclusions
// ============================================================

/**
 * Marcus's technical conclusion for an assessment.
 * These are advisory — Marcus never makes GO/NO-GO decisions.
 */
export const MarcusTechnicalConclusion = {
  FEASIBLE: 'FEASIBLE',
  FEASIBLE_WITH_RISKS: 'FEASIBLE_WITH_RISKS',
  TEAMING_DEPENDENT: 'TEAMING_DEPENDENT',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  TECHNICALLY_UNSUITABLE: 'TECHNICALLY_UNSUITABLE',
} as const;

export type MarcusTechnicalConclusionValue =
  (typeof MarcusTechnicalConclusion)[keyof typeof MarcusTechnicalConclusion];

// ============================================================
// Technology Decision Types
// ============================================================

/**
 * Classification of a technology decision within an architecture.
 */
export const TechnologyDecisionType = {
  REQUIRED: 'REQUIRED',
  PROPOSED: 'PROPOSED',
  ASSUMED: 'ASSUMED',
} as const;

export type TechnologyDecisionTypeValue =
  (typeof TechnologyDecisionType)[keyof typeof TechnologyDecisionType];

// ============================================================
// Technical Evidence Types
// ============================================================

/**
 * Types of technical evidence Marcus collects and references.
 */
export const TechnicalEvidenceType = {
  REQUIREMENT: 'REQUIREMENT',
  CONSTRAINT: 'CONSTRAINT',
  ASSUMPTION: 'ASSUMPTION',
  DECISION: 'DECISION',
  RISK: 'RISK',
} as const;

export type TechnicalEvidenceTypeValue =
  (typeof TechnicalEvidenceType)[keyof typeof TechnicalEvidenceType];

// ============================================================
// Artifact Types
// ============================================================

/**
 * Types of technical artifacts Marcus produces.
 */
export const MarcusArtifactType = {
  TECHNICAL_ASSESSMENT: 'TECHNICAL_ASSESSMENT',
  PRELIMINARY_SOLUTION_ARCHITECTURE: 'PRELIMINARY_SOLUTION_ARCHITECTURE',
  TECHNICAL_ROM: 'TECHNICAL_ROM',
  TECHNICAL_CLARIFICATION: 'TECHNICAL_CLARIFICATION',
  DECISIVE_BLOCKER: 'DECISIVE_BLOCKER',
  TEAMING_CANDIDATE: 'TEAMING_CANDIDATE',
} as const;

export type MarcusArtifactTypeValue =
  (typeof MarcusArtifactType)[keyof typeof MarcusArtifactType];

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
// Severity Levels
// ============================================================

export const SeverityLevel = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type SeverityLevelValue =
  (typeof SeverityLevel)[keyof typeof SeverityLevel];

// ============================================================
// Clarification Question Status
// ============================================================

export const ClarificationQuestionStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED_EXTERNAL: 'SUBMITTED_EXTERNAL',
} as const;

export type ClarificationQuestionStatusValue =
  (typeof ClarificationQuestionStatus)[keyof typeof ClarificationQuestionStatus];

// ============================================================
// Material Technical Change Types
// ============================================================

/**
 * Categories of material technical changes that can trigger
 * re-evaluation of technical artifacts.
 */
export const MaterialTechnicalChangeType = {
  HOSTING_CLOUD: 'HOSTING_CLOUD',
  MANDATORY_TECHNOLOGY: 'MANDATORY_TECHNOLOGY',
  ARCHITECTURE_CONSTRAINT: 'ARCHITECTURE_CONSTRAINT',
  API_INTEGRATION: 'API_INTEGRATION',
  DATA_HANDLING: 'DATA_HANDLING',
  SECURITY_COMPLIANCE: 'SECURITY_COMPLIANCE',
  CLEARANCE: 'CLEARANCE',
  ACCESSIBILITY: 'ACCESSIBILITY',
  PERFORMANCE_SLA: 'PERFORMANCE_SLA',
  DEVSECOPS_DEPLOYMENT: 'DEVSECOPS_DEPLOYMENT',
  TECHNICAL_CERTIFICATION: 'TECHNICAL_CERTIFICATION',
  TECHNICAL_SCOPE: 'TECHNICAL_SCOPE',
  TECHNICAL_CHANGE_REVIEW_REQUIRED: 'TECHNICAL_CHANGE_REVIEW_REQUIRED',
} as const;

export type MaterialTechnicalChangeTypeValue =
  (typeof MaterialTechnicalChangeType)[keyof typeof MaterialTechnicalChangeType];

// ============================================================
// Research Request (from James)
// ============================================================

/**
 * Research request schema — sent by James to Marcus during capture.
 * Marcus uses this to scope G2X research and produce technical artifacts.
 */
export const MarcusResearchRequestSchema = z.object({
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity being evaluated */
  opportunityId: z.string().max(200),
  /** Specific research question */
  question: z.string().max(500),
  /** Type of technical research requested */
  researchType: z.enum([
    'TECHNICAL_FEASIBILITY',
    'SOLUTION_ARCHITECTURE',
    'SECURITY_COMPLIANCE',
    'INTEGRATION_ANALYSIS',
    'DELIVERY_RISK',
    'TECHNICAL_ROM',
    'TECHNICAL_CLARIFICATION',
    'TECHNICAL_GAP',
  ]),
  /** Expected artifact output type */
  expectedArtifact: z.enum([
    'TECHNICAL_ASSESSMENT',
    'PRELIMINARY_SOLUTION_ARCHITECTURE',
    'TECHNICAL_ROM',
    'TECHNICAL_CLARIFICATION',
    'DECISIVE_BLOCKER',
    'TEAMING_CANDIDATE',
  ]),
  /** Supporting evidence references from James */
  evidenceRefs: z.array(z.string().max(500)).max(5),
});

export type MarcusResearchRequest = z.infer<typeof MarcusResearchRequestSchema>;

// ============================================================
// Research Result (to James)
// ============================================================

/**
 * Research result schema — returned by Marcus to James after
 * completing a research task. Contains findings, technical risks,
 * evidence, and any unresolved questions.
 */
export const MarcusResearchResultSchema = z.object({
  /** Marcus task ID */
  taskId: z.string().uuid(),
  /** Type of artifact produced */
  artifactType: z.enum([
    'TECHNICAL_ASSESSMENT',
    'PRELIMINARY_SOLUTION_ARCHITECTURE',
    'TECHNICAL_ROM',
    'TECHNICAL_CLARIFICATION',
    'DECISIVE_BLOCKER',
    'TEAMING_CANDIDATE',
  ]),
  /** Technical conclusion */
  conclusion: z.enum([
    'FEASIBLE',
    'FEASIBLE_WITH_RISKS',
    'TEAMING_DEPENDENT',
    'INSUFFICIENT_EVIDENCE',
    'TECHNICALLY_UNSUITABLE',
  ]),
  /** Executive summary of findings */
  summary: z.string().max(1000),
  /** Individual findings with detail */
  findings: z.array(z.string().max(500)).max(10),
  /** Technical risks identified */
  technicalRisks: z.array(z.string().max(500)).max(5),
  /** Evidence references supporting findings */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** Questions Marcus could not resolve — may prompt further research */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
  /** Recommended next actions */
  recommendedActions: z.array(z.string().max(300)).max(5),
  /** Overall confidence in the research result */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type MarcusResearchResult = z.infer<typeof MarcusResearchResultSchema>;

// ============================================================
// Technical Assessment
// ============================================================

/**
 * Technical assessment — structured feasibility analysis of
 * an opportunity's technical requirements.
 */
export const TechnicalAssessmentSchema = z.object({
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity being assessed */
  opportunityId: z.string().max(200),
  /** Technical conclusion */
  conclusion: z.enum([
    'FEASIBLE',
    'FEASIBLE_WITH_RISKS',
    'TEAMING_DEPENDENT',
    'INSUFFICIENT_EVIDENCE',
    'TECHNICALLY_UNSUITABLE',
  ]),
  /** Overall confidence */
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  /** Extracted technical requirements */
  requirements: z.array(z.string().max(300)).max(10),
  /** Identified constraints */
  constraints: z.array(z.string().max(300)).max(10),
  /** Working assumptions */
  assumptions: z.array(z.string().max(300)).max(10),
  /** Technical risks with severity and mitigation */
  technicalRisks: z.array(z.object({
    description: z.string().max(300),
    severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    mitigation: z.string().max(200),
  })).max(10),
  /** Delivery considerations narrative */
  deliveryConsiderations: z.string().max(500),
  /** Evidence references */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** Unresolved questions for follow-up */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
  /** Recommended next actions */
  recommendedActions: z.array(z.string().max(300)).max(5),
});

export type TechnicalAssessment = z.infer<typeof TechnicalAssessmentSchema>;

// ============================================================
// Preliminary Solution Architecture
// ============================================================

/**
 * Preliminary solution architecture — high-level technical
 * approach for an opportunity, including components, data flows,
 * integrations, and technology decisions.
 */
export const PreliminarySolutionArchitectureSchema = z.object({
  /** Architecture overview */
  architectureSummary: z.string().max(1000),
  /** System components */
  components: z.array(z.object({
    name: z.string().max(200),
    purpose: z.string().max(300),
    technology: z.string().max(200),
    status: z.enum(['REQUIRED', 'PROPOSED', 'ASSUMED']),
  })).max(15),
  /** Data flows between components */
  dataFlows: z.array(z.object({
    source: z.string().max(200),
    destination: z.string().max(200),
    description: z.string().max(300),
    protocol: z.string().max(100),
  })).max(10),
  /** External system integrations */
  integrations: z.array(z.object({
    system: z.string().max(200),
    type: z.string().max(100),
    complexity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  })).max(10),
  /** Security boundary description */
  securityBoundaries: z.string().max(500),
  /** Deployment approach description */
  deploymentApproach: z.string().max(500),
  /** Technology decisions with rationale */
  technologyDecisions: z.array(z.object({
    technology: z.string().max(200),
    status: z.enum(['REQUIRED', 'PROPOSED', 'ASSUMED']),
    rationale: z.string().max(200),
    alternatives: z.array(z.string().max(100)).max(3),
  })).max(10),
  /** Working assumptions */
  assumptions: z.array(z.string().max(300)).max(10),
  /** Alternative approaches considered */
  alternatives: z.array(z.string().max(300)).max(5),
  /** Key tradeoffs in the architecture */
  tradeoffs: z.array(z.string().max(300)).max(5),
  /** Architecture risks */
  risks: z.array(z.string().max(300)).max(10),
  /** Evidence references */
  evidenceRefs: z.array(z.string().max(500)).max(10),
});

export type PreliminarySolutionArchitecture = z.infer<typeof PreliminarySolutionArchitectureSchema>;

// ============================================================
// Technical Solution Artifact Version
// ============================================================

/**
 * Version record for a technical solution artifact.
 * Tracks changes between document versions including
 * requirements, assumptions, architecture, risks, and decisions.
 */
export const TechnicalSolutionArtifactVersionSchema = z.object({
  /** Sequential version number */
  versionNumber: z.number().int().min(1),
  /** Previous version ID (null for first version) */
  previousVersionId: z.string().uuid().nullable(),
  /** Source document version references that drove this version */
  sourceDocumentVersionRefs: z.array(z.string().max(500)).max(10),
  /** Requirements added in this version */
  requirementsAdded: z.array(z.string().max(300)).max(20),
  /** Requirements changed in this version */
  requirementsChanged: z.array(z.string().max(300)).max(20),
  /** Requirements removed in this version */
  requirementsRemoved: z.array(z.string().max(300)).max(20),
  /** Assumptions invalidated by this version */
  assumptionsInvalidated: z.array(z.string().max(300)).max(10),
  /** Architecture changes in this version */
  architectureChanges: z.array(z.string().max(300)).max(10),
  /** New risks identified in this version */
  newRisks: z.array(z.string().max(300)).max(10),
  /** Risks resolved in this version */
  resolvedRisks: z.array(z.string().max(300)).max(10),
  /** Technical decisions changed in this version */
  technicalDecisionsChanged: z.array(z.string().max(300)).max(10),
  /** Evidence references */
  evidenceRefs: z.array(z.string().max(500)).max(10),
  /** When this version was superseded (null if current) */
  supersededAt: z.string().datetime().nullable(),
});

export type TechnicalSolutionArtifactVersion = z.infer<typeof TechnicalSolutionArtifactVersionSchema>;

// ============================================================
// Technical ROM (Rough Order of Magnitude)
// ============================================================

/**
 * Technical ROM — rough order of magnitude estimate
 * for delivery effort, structured by workstreams.
 */
export const TechnicalROMSchema = z.object({
  /** Always 'ROM' — this is a rough order of magnitude */
  estimateType: z.literal('ROM'),
  /** Delivery workstreams */
  workstreams: z.array(z.object({
    name: z.string().max(200),
    description: z.string().max(300),
    roles: z.array(z.string().max(100)).max(5),
    seniorityMix: z.string().max(200),
    phases: z.array(z.string().max(100)).max(5),
    relativeEffort: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    complexityBand: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  })).max(10),
  /** Cross-workstream dependencies */
  dependencies: z.array(z.string().max(300)).max(10),
  /** Schedule assumptions narrative */
  scheduleAssumptions: z.string().max(500),
  /** Additional notes */
  notes: z.string().max(500),
});

export type TechnicalROM = z.infer<typeof TechnicalROMSchema>;

// ============================================================
// Technical Clarification Question
// ============================================================

/**
 * Technical clarification question — a question Marcus
 * identifies as needing external resolution, with context
 * on why it matters technically.
 */
export const TechnicalClarificationQuestionSchema = z.object({
  /** Requirement that prompted this question */
  sourceRequirement: z.string().max(300),
  /** Evidence reference for the ambiguity source */
  evidenceRef: z.string().max(200),
  /** What is ambiguous */
  ambiguity: z.string().max(500),
  /** Technical impact of the ambiguity */
  technicalImpact: z.string().max(500),
  /** Proposed question for external resolution */
  proposedQuestion: z.string().max(500),
  /** Priority of resolution */
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type TechnicalClarificationQuestion = z.infer<typeof TechnicalClarificationQuestionSchema>;

// ============================================================
// Decisive Technical Blocker
// ============================================================

/**
 * Decisive technical blocker — a technical requirement that
 * FFTC cannot meet, with evidence and recommendation.
 */
export const DecisiveTechnicalBlockerSchema = z.object({
  /** The requirement that blocks pursuit */
  blockingRequirement: z.string().max(300),
  /** Why this is a blocker */
  reason: z.string().max(500),
  /** Supporting evidence */
  evidence: z.array(z.object({
    claim: z.string().max(200),
    source: z.string().max(200),
  })).max(3),
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity being blocked */
  opportunityId: z.string().max(200),
  /** Recommended course of action */
  recommendation: z.string().max(300),
});

export type DecisiveTechnicalBlocker = z.infer<typeof DecisiveTechnicalBlockerSchema>;

// ============================================================
// Technical Teaming Candidate
// ============================================================

/**
 * Technical teaming candidate — a gap Marcus identifies
 * that may require a teaming partner to fill.
 */
export const TechnicalTeamingCandidateSchema = z.object({
  /** Capture aggregate ID */
  captureId: z.string().uuid(),
  /** Opportunity with the gap */
  opportunityId: z.string().max(200),
  /** Description of the technical gap */
  technicalGap: z.string().max(500),
  /** Whether the gap is mandatory or advantageous */
  mandatoryOrAdvantageous: z.enum(['MANDATORY', 'ADVANTAGEOUS']),
  /** Evidence references supporting the gap */
  evidenceRefs: z.array(z.string().max(500)).max(5),
  /** Required partner capability to fill the gap */
  requiredPartnerCapability: z.string().max(300),
  /** Rationale for teaming */
  rationale: z.string().max(500),
  /** Unresolved questions about the gap */
  unresolvedQuestions: z.array(z.string().max(300)).max(5),
});

export type TechnicalTeamingCandidate = z.infer<typeof TechnicalTeamingCandidateSchema>;

// ============================================================
// Marcus G2X Allowed Tools
// ============================================================

/**
 * G2X tools Marcus is authorized to invoke.
 * Any tool not in this list is DENIED regardless of
 * remote availability via tools/list.
 */
export const MARCUS_G2X_ALLOWED_TOOLS = [
  'g2x_get_record',
  'g2x_opportunity_documents',
  'g2x_opportunity_attachment_text',
] as const;

export type MarcusG2XAllowedTool = (typeof MARCUS_G2X_ALLOWED_TOOLS)[number];

// ============================================================
// Research Envelope Constants
// ============================================================

/**
 * Per-task G2X call budget.
 * Marcus is bounded per task to prevent runaway research.
 */
export const MAX_G2X_CALLS_PER_TASK = 8;

/**
 * Per-task record retrieval budget.
 * Prevents excessive data ingestion per research task.
 */
export const MAX_RECORDS_PER_TASK = 100;

/**
 * Maximum LLM reasoning calls Marcus may make per task.
 * Marcus's LLM usage is tightly constrained — most work
 * is structured G2X data retrieval, not free-form reasoning.
 */
export const MAX_MARCUS_REASONING_CALLS = 1;

// ============================================================
// Budget Constants
// ============================================================

/**
 * Shared capture budget ceiling (USD).
 * Shared across James, David, Rosa, and Marcus per capture.
 */
export const CAPTURE_BUDGET_CEILING = 0.25;

/**
 * Cost per Marcus capture task (USD).
 * Deducted from the shared capture budget.
 */
export const MARCUS_CAPTURE_TASK_COST = 0.05;
