// Event Types and Zod Schemas for the Agent Event System
import { z } from 'zod';
import type { LiveAgentName } from '../live/types.js';

// ============================================================
// Event Type Constants
// ============================================================
export const EventTypes = {
  // Opportunity lifecycle
  NEW_OPPORTUNITY: 'NEW_OPPORTUNITY',
  OPPORTUNITY_UPDATED: 'OPPORTUNITY_UPDATED',

  // Research chain
  RESEARCH_COMPLETE: 'RESEARCH_COMPLETE',

  // Technical assessment
  TECH_ASSESSMENT_COMPLETE: 'TECH_ASSESSMENT_COMPLETE',

  // Relationship/teaming
  RELATIONSHIP_CHECK_COMPLETE: 'RELATIONSHIP_CHECK_COMPLETE',

  // Strategy
  GO_NO_GO_DECISION: 'GO_NO_GO_DECISION',

  // Pursuit
  PURSUIT_SCHEDULED: 'PURSUIT_SCHEDULED',
  PURSUIT_DECISION_FEEDBACK: 'PURSUIT_DECISION_FEEDBACK',

  // Autonomous behaviors
  DEADLINE_WARNING: 'DEADLINE_WARNING',
  PIPELINE_HEALTH_CHECK: 'PIPELINE_HEALTH_CHECK',
  SYSTEM_HEALTH_CHECK: 'SYSTEM_HEALTH_CHECK',
  RISK_ALERT: 'RISK_ALERT',

  // Learning
  OUTCOME_RECORDED: 'OUTCOME_RECORDED',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

// ============================================================
// Event Status
// ============================================================
export const EventStatus = {
  PENDING: 'pending',
  CLAIMED: 'claimed',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
} as const;

export type EventStatusType = (typeof EventStatus)[keyof typeof EventStatus];

// ============================================================
// Base Schemas
// ============================================================
export const AgentNameSchema = z.enum([
  'maya',
  'david',
  'rosa',
  'james',
  'patricia',
  'jodie',
  'marcus',
  'system',
]);

export const SlackContextSchema = z.object({
  channelId: z.string().optional(),
  threadTs: z.string().optional(),
});

// ============================================================
// Opportunity Schemas
// ============================================================
export const OpportunityBaseSchema = z.object({
  noticeId: z.string(),
  title: z.string(),
  agency: z.string().optional(),
  value: z.number().optional(),
  deadline: z.string().optional(),
  naics: z.string().optional(),
  setAside: z.string().optional(),
  url: z.string().optional(),
});

// NEW_OPPORTUNITY payload
export const NewOpportunityPayloadSchema = OpportunityBaseSchema.extend({
  score: z.number().min(0).max(100),
  scoreBreakdown: z
    .object({
      keywordMatch: z.number().optional(),
      agencyFit: z.number().optional(),
      setAsideFit: z.number().optional(),
      valueFit: z.number().optional(),
    })
    .optional(),
  source: z.enum(['sam_gov', 'ebuy', 'manual', 'scanner']),
  postedMessage: z.string().optional(),
});

export type NewOpportunityPayload = z.infer<typeof NewOpportunityPayloadSchema>;

// OPPORTUNITY_UPDATED payload
export const OpportunityUpdatedPayloadSchema = OpportunityBaseSchema.extend({
  changes: z.array(
    z.object({
      field: z.string(),
      oldValue: z.unknown(),
      newValue: z.unknown(),
    })
  ),
});

export type OpportunityUpdatedPayload = z.infer<typeof OpportunityUpdatedPayloadSchema>;

// ============================================================
// Research Schemas
// ============================================================
export const ResearchCompletePayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // Incumbent analysis
  incumbent: z
    .object({
      name: z.string().optional(),
      contractNumber: z.string().optional(),
      contractValue: z.number().optional(),
      performanceRating: z.string().optional(),
      incumbentAdvantage: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
    })
    .optional(),

  // Red flags
  redFlags: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
    })
  ),

  // Green flags
  greenFlags: z.array(
    z.object({
      type: z.string(),
      description: z.string(),
    })
  ),

  // Agency intel
  agencyIntel: z
    .object({
      recentAwards: z.number().optional(),
      preferredVendors: z.array(z.string()).optional(),
      budgetTrend: z.enum(['increasing', 'stable', 'decreasing', 'unknown']).optional(),
    })
    .optional(),

  // Confidence
  confidence: z.enum(['high', 'medium', 'low']),
  sources: z.array(z.string()),
  summary: z.string(),
});

export type ResearchCompletePayload = z.infer<typeof ResearchCompletePayloadSchema>;

// ============================================================
// Tech Assessment Schemas
// ============================================================
export const TechAssessmentCompletePayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // Tech stack analysis
  techStack: z.object({
    required: z.array(z.string()),
    preferred: z.array(z.string()),
    compatibility: z.enum(['high', 'medium', 'low']),
  }),

  // Compliance
  compliance: z.object({
    fedRampRequired: z.boolean(),
    fedRampLevel: z.enum(['high', 'moderate', 'low', 'not_required']).optional(),
    atoRequired: z.boolean(),
    section508: z.boolean(),
    otherCertifications: z.array(z.string()),
  }),

  // Assessment
  concerns: z.array(
    z.object({
      area: z.string(),
      description: z.string(),
      severity: z.enum(['blocker', 'major', 'minor']),
    })
  ),

  strengths: z.array(
    z.object({
      area: z.string(),
      description: z.string(),
    })
  ),

  recommendation: z.enum(['strong_fit', 'good_fit', 'possible_fit', 'poor_fit', 'no_fit']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
});

export type TechAssessmentCompletePayload = z.infer<typeof TechAssessmentCompletePayloadSchema>;

// ============================================================
// Relationship Check Schemas
// ============================================================
export const RelationshipCheckCompletePayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // Teaming recommendation
  teamingRecommendation: z.enum(['prime', 'sub', 'joint_venture', 'solo', 'pass']),

  // Partner analysis
  potentialPartners: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['prime', 'sub', 'mentor', 'jv_partner']),
      relationship: z.enum(['existing', 'warm_intro', 'cold']),
      certifications: z.array(z.string()),
      relevantExperience: z.string().optional(),
      contactInfo: z.string().optional(),
    })
  ),

  // Certification gaps
  certificationGaps: z.array(
    z.object({
      certification: z.string(),
      importance: z.enum(['required', 'preferred', 'nice_to_have']),
      partnerCanFill: z.boolean(),
    })
  ),

  // Assessment
  relationshipStrength: z.enum(['strong', 'moderate', 'weak', 'none']),
  confidence: z.enum(['high', 'medium', 'low']),
  summary: z.string(),
});

export type RelationshipCheckCompletePayload = z.infer<
  typeof RelationshipCheckCompletePayloadSchema
>;

// ============================================================
// Go/No-Go Decision Schemas
// ============================================================
export const GoNoGoDecisionPayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // Decision
  decision: z.enum(['GO', 'NO_GO', 'CONDITIONAL_GO', 'NEEDS_MORE_INFO']),
  winProbability: z.number().min(0).max(100),

  // Key factors
  keyFactors: z.array(
    z.object({
      factor: z.string(),
      impact: z.enum(['positive', 'negative', 'neutral']),
      weight: z.number().min(1).max(10),
    })
  ),

  // Risks
  risks: z.array(
    z.object({
      risk: z.string(),
      likelihood: z.enum(['high', 'medium', 'low']),
      mitigation: z.string().optional(),
    })
  ),

  // Conditions (for CONDITIONAL_GO)
  conditions: z.array(z.string()).optional(),

  // Questions (for NEEDS_MORE_INFO)
  openQuestions: z.array(z.string()).optional(),

  // Sources of input
  inputsReceived: z.object({
    research: z.boolean(),
    techAssessment: z.boolean(),
    relationshipCheck: z.boolean(),
  }),

  // Rationale
  rationale: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type GoNoGoDecisionPayload = z.infer<typeof GoNoGoDecisionPayloadSchema>;

// ============================================================
// Pursuit Schemas
// ============================================================
export const PursuitScheduledPayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),
  deadline: z.string(),

  // Schedule
  milestones: z.array(
    z.object({
      name: z.string(),
      dueDate: z.string(),
      owner: AgentNameSchema.optional(),
    })
  ),

  // Assignments
  teamAssignments: z.array(
    z.object({
      agent: AgentNameSchema,
      role: z.string(),
      tasks: z.array(z.string()),
    })
  ),

  // Status
  kickoffScheduled: z.boolean(),
  kickoffDate: z.string().optional(),
});

export type PursuitScheduledPayload = z.infer<typeof PursuitScheduledPayloadSchema>;

export const PursuitDecisionFeedbackPayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // What happened
  outcome: z.enum(['won', 'lost', 'no_bid', 'cancelled', 'withdrawn']),

  // Scoring feedback
  originalScore: z.number(),
  actualOutcome: z.string(),

  // Learning points
  lessonsLearned: z.array(z.string()),

  // For future scoring adjustments
  scoringAdjustments: z
    .array(
      z.object({
        factor: z.string(),
        currentWeight: z.number(),
        suggestedWeight: z.number(),
        reason: z.string(),
      })
    )
    .optional(),
});

export type PursuitDecisionFeedbackPayload = z.infer<typeof PursuitDecisionFeedbackPayloadSchema>;

// ============================================================
// Autonomous Behavior Schemas
// ============================================================
export const DeadlineWarningPayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),
  deadline: z.string(),
  hoursRemaining: z.number(),
  currentStage: z.string(),
  blockers: z.array(
    z.object({
      description: z.string(),
      owner: AgentNameSchema.optional(),
    })
  ),
  urgentActions: z.array(z.string()),
});

export type DeadlineWarningPayload = z.infer<typeof DeadlineWarningPayloadSchema>;

export const PipelineHealthCheckPayloadSchema = z.object({
  // Summary
  totalOpportunities: z.number(),
  byStage: z.record(z.string(), z.number()),

  // Concerns
  stuckOpportunities: z.array(
    z.object({
      noticeId: z.string(),
      title: z.string(),
      stage: z.string(),
      daysInStage: z.number(),
      lastActivity: z.string(),
    })
  ),

  upcomingDeadlines: z.array(
    z.object({
      noticeId: z.string(),
      title: z.string(),
      deadline: z.string(),
      daysRemaining: z.number(),
    })
  ),

  // Metrics
  healthScore: z.number().min(0).max(100),
  recommendations: z.array(z.string()),
});

export type PipelineHealthCheckPayload = z.infer<typeof PipelineHealthCheckPayloadSchema>;

export const SystemHealthCheckPayloadSchema = z.object({
  // API status
  apiStatus: z.record(
    z.string(),
    z.object({
      status: z.enum(['healthy', 'degraded', 'down']),
      latencyMs: z.number().optional(),
      lastCheck: z.string(),
      errorRate: z.number().optional(),
    })
  ),

  // Agent status
  agentStatus: z.record(
    AgentNameSchema,
    z.object({
      status: z.enum(['active', 'idle', 'error']),
      lastActivity: z.string(),
      eventsProcessed24h: z.number(),
    })
  ),

  // Alerts
  alerts: z.array(
    z.object({
      severity: z.enum(['critical', 'warning', 'info']),
      message: z.string(),
      source: z.string(),
    })
  ),

  // Overall
  overallHealth: z.enum(['healthy', 'degraded', 'critical']),
});

export type SystemHealthCheckPayload = z.infer<typeof SystemHealthCheckPayloadSchema>;

export const RiskAlertPayloadSchema = z.object({
  noticeId: z.string().optional(),
  title: z.string().optional(),

  // Risk details
  riskType: z.enum([
    'deadline',
    'competitor',
    'compliance',
    'resource',
    'technical',
    'relationship',
    'other',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string(),

  // Context
  detectedBy: AgentNameSchema,
  detectedAt: z.string(),

  // Actions
  suggestedActions: z.array(z.string()),
  requiresHumanDecision: z.boolean(),
});

export type RiskAlertPayload = z.infer<typeof RiskAlertPayloadSchema>;

// ============================================================
// Outcome Schemas
// ============================================================
export const OutcomeRecordedPayloadSchema = z.object({
  noticeId: z.string(),
  title: z.string(),

  // Outcome
  outcome: z.enum(['won', 'lost', 'no_bid', 'cancelled', 'withdrawn']),
  awardAmount: z.number().optional(),
  winner: z.string().optional(),

  // Analysis
  jamesRecommendation: z.enum(['GO', 'NO_GO', 'CONDITIONAL_GO', 'NEEDS_MORE_INFO']).optional(),
  humanDecision: z.enum(['go', 'pass']).optional(),
  wasCorrect: z.boolean().optional(),

  // Post-mortem
  postMortem: z.string().optional(),
  lessonsLearned: z.array(z.string()).optional(),
});

export type OutcomeRecordedPayload = z.infer<typeof OutcomeRecordedPayloadSchema>;

// ============================================================
// Event Payload Union
// ============================================================
export const EventPayloadSchema = z.union([
  NewOpportunityPayloadSchema,
  OpportunityUpdatedPayloadSchema,
  ResearchCompletePayloadSchema,
  TechAssessmentCompletePayloadSchema,
  RelationshipCheckCompletePayloadSchema,
  GoNoGoDecisionPayloadSchema,
  PursuitScheduledPayloadSchema,
  PursuitDecisionFeedbackPayloadSchema,
  DeadlineWarningPayloadSchema,
  PipelineHealthCheckPayloadSchema,
  SystemHealthCheckPayloadSchema,
  RiskAlertPayloadSchema,
  OutcomeRecordedPayloadSchema,
]);

// ============================================================
// Event Record Schema (full event from database)
// ============================================================
export const AgentEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  source_agent: z.string(),
  target_agent: z.string().nullable(),
  payload: z.record(z.unknown()),
  parent_event_id: z.string().uuid().nullable(),
  root_event_id: z.string().uuid().nullable(),
  chain_depth: z.number(),
  status: z.enum(['pending', 'claimed', 'processing', 'completed', 'failed', 'expired']),
  priority: z.number().min(1).max(10),
  channel_id: z.string().nullable(),
  thread_ts: z.string().nullable(),
  process_after: z.string(),
  expires_at: z.string(),
  retry_count: z.number(),
  max_retries: z.number(),
  last_error: z.string().nullable(),
  claimed_by: z.string().nullable(),
  claimed_at: z.string().nullable(),
  result: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ============================================================
// Claimed Event (subset returned by claim_events)
// ============================================================
export const ClaimedEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.string(),
  source_agent: z.string(),
  payload: z.record(z.unknown()),
  parent_event_id: z.string().uuid().nullable(),
  root_event_id: z.string().uuid().nullable(),
  chain_depth: z.number(),
  priority: z.number(),
  channel_id: z.string().nullable(),
  thread_ts: z.string().nullable(),
  created_at: z.string(),
});

export type ClaimedEvent = z.infer<typeof ClaimedEventSchema>;

// ============================================================
// Payload Validator Map
// ============================================================
export const PayloadValidators: Record<EventType, z.ZodSchema> = {
  [EventTypes.NEW_OPPORTUNITY]: NewOpportunityPayloadSchema,
  [EventTypes.OPPORTUNITY_UPDATED]: OpportunityUpdatedPayloadSchema,
  [EventTypes.RESEARCH_COMPLETE]: ResearchCompletePayloadSchema,
  [EventTypes.TECH_ASSESSMENT_COMPLETE]: TechAssessmentCompletePayloadSchema,
  [EventTypes.RELATIONSHIP_CHECK_COMPLETE]: RelationshipCheckCompletePayloadSchema,
  [EventTypes.GO_NO_GO_DECISION]: GoNoGoDecisionPayloadSchema,
  [EventTypes.PURSUIT_SCHEDULED]: PursuitScheduledPayloadSchema,
  [EventTypes.PURSUIT_DECISION_FEEDBACK]: PursuitDecisionFeedbackPayloadSchema,
  [EventTypes.DEADLINE_WARNING]: DeadlineWarningPayloadSchema,
  [EventTypes.PIPELINE_HEALTH_CHECK]: PipelineHealthCheckPayloadSchema,
  [EventTypes.SYSTEM_HEALTH_CHECK]: SystemHealthCheckPayloadSchema,
  [EventTypes.RISK_ALERT]: RiskAlertPayloadSchema,
  [EventTypes.OUTCOME_RECORDED]: OutcomeRecordedPayloadSchema,
};

// ============================================================
// Validation Helpers
// ============================================================
export function validatePayload<T extends EventType>(
  eventType: T,
  payload: unknown
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const validator = PayloadValidators[eventType];
  if (!validator) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: ['eventType'],
          message: `Unknown event type: ${eventType}`,
        },
      ]),
    };
  }

  const result = validator.safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export function isValidEventType(type: string): type is EventType {
  return Object.values(EventTypes).includes(type as EventType);
}
