import { describe, it, expect } from 'vitest';
import {
  EventTypes,
  EventStatus,
  validatePayload,
  isValidEventType,
  NewOpportunityPayloadSchema,
  ResearchCompletePayloadSchema,
  TechAssessmentCompletePayloadSchema,
  RelationshipCheckCompletePayloadSchema,
  GoNoGoDecisionPayloadSchema,
  PursuitScheduledPayloadSchema,
  DeadlineWarningPayloadSchema,
  PipelineHealthCheckPayloadSchema,
  SystemHealthCheckPayloadSchema,
  type EventType,
} from '../eventTypes.js';

describe('eventTypes', () => {
  describe('EventTypes constants', () => {
    it('should define all expected event types', () => {
      expect(EventTypes.NEW_OPPORTUNITY).toBe('NEW_OPPORTUNITY');
      expect(EventTypes.OPPORTUNITY_UPDATED).toBe('OPPORTUNITY_UPDATED');
      expect(EventTypes.RESEARCH_COMPLETE).toBe('RESEARCH_COMPLETE');
      expect(EventTypes.TECH_ASSESSMENT_COMPLETE).toBe('TECH_ASSESSMENT_COMPLETE');
      expect(EventTypes.RELATIONSHIP_CHECK_COMPLETE).toBe('RELATIONSHIP_CHECK_COMPLETE');
      expect(EventTypes.GO_NO_GO_DECISION).toBe('GO_NO_GO_DECISION');
      expect(EventTypes.PURSUIT_SCHEDULED).toBe('PURSUIT_SCHEDULED');
      expect(EventTypes.PURSUIT_DECISION_FEEDBACK).toBe('PURSUIT_DECISION_FEEDBACK');
      expect(EventTypes.DEADLINE_WARNING).toBe('DEADLINE_WARNING');
      expect(EventTypes.PIPELINE_HEALTH_CHECK).toBe('PIPELINE_HEALTH_CHECK');
      expect(EventTypes.SYSTEM_HEALTH_CHECK).toBe('SYSTEM_HEALTH_CHECK');
      expect(EventTypes.RISK_ALERT).toBe('RISK_ALERT');
      expect(EventTypes.OUTCOME_RECORDED).toBe('OUTCOME_RECORDED');
    });
  });

  describe('EventStatus constants', () => {
    it('should define all expected statuses', () => {
      expect(EventStatus.PENDING).toBe('pending');
      expect(EventStatus.CLAIMED).toBe('claimed');
      expect(EventStatus.PROCESSING).toBe('processing');
      expect(EventStatus.COMPLETED).toBe('completed');
      expect(EventStatus.FAILED).toBe('failed');
      expect(EventStatus.EXPIRED).toBe('expired');
    });
  });

  describe('isValidEventType', () => {
    it('should return true for valid event types', () => {
      expect(isValidEventType('NEW_OPPORTUNITY')).toBe(true);
      expect(isValidEventType('RESEARCH_COMPLETE')).toBe(true);
      expect(isValidEventType('GO_NO_GO_DECISION')).toBe(true);
    });

    it('should return false for invalid event types', () => {
      expect(isValidEventType('INVALID_TYPE')).toBe(false);
      expect(isValidEventType('')).toBe(false);
      expect(isValidEventType('new_opportunity')).toBe(false); // Case sensitive
    });
  });

  describe('validatePayload', () => {
    it('should return error for unknown event type', () => {
      const result = validatePayload('UNKNOWN_TYPE' as EventType, {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Unknown event type');
      }
    });
  });

  describe('NewOpportunityPayloadSchema', () => {
    it('should validate a valid payload', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        score: 85,
        source: 'sam_gov',
      };

      const result = NewOpportunityPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate with optional fields', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        agency: 'VA',
        value: 1000000,
        deadline: '2024-12-31',
        naics: '541511',
        setAside: '8(a)',
        url: 'https://sam.gov/opp/abc123',
        score: 85,
        scoreBreakdown: {
          keywordMatch: 20,
          agencyFit: 20,
          setAsideFit: 15,
          valueFit: 10,
        },
        source: 'sam_gov',
        postedMessage: '1234567890.123',
      };

      const result = NewOpportunityPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid source', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        score: 85,
        source: 'invalid_source',
      };

      const result = NewOpportunityPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should reject score out of range', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        score: 150,
        source: 'sam_gov',
      };

      const result = NewOpportunityPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('ResearchCompletePayloadSchema', () => {
    it('should validate a valid payload', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        redFlags: [{ type: 'wired', description: 'Incumbent favored', severity: 'high' }],
        greenFlags: [{ type: 'open', description: 'New requirement' }],
        confidence: 'high',
        sources: ['FPDS', 'USASpending'],
        summary: 'Research summary here',
      };

      const result = ResearchCompletePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate with incumbent data', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        incumbent: {
          name: 'Acme Corp',
          contractNumber: 'ABC123',
          contractValue: 5000000,
          performanceRating: 'Satisfactory',
          incumbentAdvantage: 'high',
        },
        redFlags: [],
        greenFlags: [],
        confidence: 'medium',
        sources: ['FPDS'],
        summary: 'Summary',
      };

      const result = ResearchCompletePayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid severity', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        redFlags: [{ type: 'wired', description: 'Bad', severity: 'extreme' }],
        greenFlags: [],
        confidence: 'high',
        sources: [],
        summary: '',
      };

      const result = ResearchCompletePayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('GoNoGoDecisionPayloadSchema', () => {
    it('should validate a GO decision', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        decision: 'GO',
        winProbability: 65,
        keyFactors: [{ factor: 'Past performance', impact: 'positive', weight: 8 }],
        risks: [{ risk: 'Tight timeline', likelihood: 'medium', mitigation: 'Add resources' }],
        inputsReceived: {
          research: true,
          techAssessment: true,
          relationshipCheck: true,
        },
        rationale: 'Strong fit for our capabilities',
        confidence: 'high',
      };

      const result = GoNoGoDecisionPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate a CONDITIONAL_GO with conditions', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        decision: 'CONDITIONAL_GO',
        winProbability: 45,
        keyFactors: [],
        risks: [],
        conditions: ['Partner confirmed', 'Pricing approved'],
        inputsReceived: {
          research: true,
          techAssessment: false,
          relationshipCheck: true,
        },
        rationale: 'Conditional on teaming',
        confidence: 'medium',
      };

      const result = GoNoGoDecisionPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should validate NEEDS_MORE_INFO with questions', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        decision: 'NEEDS_MORE_INFO',
        winProbability: 0,
        keyFactors: [],
        risks: [],
        openQuestions: ['What is the budget?', 'Who is the incumbent?'],
        inputsReceived: {
          research: true,
          techAssessment: false,
          relationshipCheck: false,
        },
        rationale: 'Need more data',
        confidence: 'low',
      };

      const result = GoNoGoDecisionPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid decision', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test',
        decision: 'MAYBE',
        winProbability: 50,
        keyFactors: [],
        risks: [],
        inputsReceived: {
          research: true,
          techAssessment: true,
          relationshipCheck: true,
        },
        rationale: 'Not sure',
        confidence: 'low',
      };

      const result = GoNoGoDecisionPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('DeadlineWarningPayloadSchema', () => {
    it('should validate a deadline warning', () => {
      const payload = {
        noticeId: 'abc123',
        title: 'Test Opportunity',
        deadline: '2024-12-31T17:00:00Z',
        hoursRemaining: 24,
        currentStage: 'pursuing',
        blockers: [{ description: 'Waiting for partner input', owner: 'rosa' }],
        urgentActions: ['Finalize pricing', 'Get executive approval'],
      };

      const result = DeadlineWarningPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('PipelineHealthCheckPayloadSchema', () => {
    it('should validate a pipeline health check', () => {
      const payload = {
        totalOpportunities: 15,
        byStage: {
          found: 5,
          researching: 3,
          assessing: 2,
          pursuing: 5,
        },
        stuckOpportunities: [
          {
            noticeId: 'abc123',
            title: 'Stuck Opp',
            stage: 'researching',
            daysInStage: 5,
            lastActivity: '2024-01-01T00:00:00Z',
          },
        ],
        upcomingDeadlines: [
          {
            noticeId: 'def456',
            title: 'Deadline Soon',
            deadline: '2024-12-31',
            daysRemaining: 3,
          },
        ],
        healthScore: 75,
        recommendations: ['Review stuck opportunities'],
      };

      const result = PipelineHealthCheckPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('SystemHealthCheckPayloadSchema', () => {
    it('should validate a system health check', () => {
      const payload = {
        apiStatus: {
          'sam.gov': { status: 'healthy', lastCheck: '2024-01-01T00:00:00Z', latencyMs: 150 },
          supabase: { status: 'healthy', lastCheck: '2024-01-01T00:00:00Z' },
        },
        agentStatus: {
          maya: { status: 'active', lastActivity: '2024-01-01T00:00:00Z', eventsProcessed24h: 10 },
          david: { status: 'idle', lastActivity: '2024-01-01T00:00:00Z', eventsProcessed24h: 5 },
        },
        alerts: [{ severity: 'warning', message: 'High latency', source: 'monitoring' }],
        overallHealth: 'healthy',
      };

      const result = SystemHealthCheckPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject invalid overall health', () => {
      const payload = {
        apiStatus: {},
        agentStatus: {},
        alerts: [],
        overallHealth: 'bad',
      };

      const result = SystemHealthCheckPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });
});
