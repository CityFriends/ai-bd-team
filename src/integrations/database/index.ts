// Database client
export { getSupabase, isUsingServiceKey } from './client.js';

// User operations
export {
  type UserProfile,
  type UserInteraction,
  type UserContext,
  getUserProfile,
  upsertUserProfile,
  trackUserInteraction,
  getUserTopics,
  formatUserProfileForAgent,
  learnUserPreferences,
  saveUserContext,
  getUserContext,
  saveUserContextWithEmbedding,
} from './users.js';

// Opportunity operations
export {
  createOpportunity,
  getOpportunity,
  getOpportunityBySamId,
  updateOpportunity,
  getOpportunitiesByStatus,
  getActiveOpportunities,
  setOpportunityDecision,
} from './opportunities.js';

// Agency operations
export { getAgency, upsertAgency } from './agencies.js';

// Company operations
export {
  createCompany,
  getCompany,
  searchCompaniesByCapabilities,
  searchCompaniesByNaics,
  updateCompany,
} from './companies.js';

// Outreach operations
export { createOutreach, updateOutreach, getOutreachByOpportunity } from './outreach.js';

// Thread operations
export {
  createThread,
  getThreadBySlackTs,
  updateThread,
  type ThreadSummary,
  saveThreadSummary,
  getThreadSummary,
} from './threads.js';

// Queue operations
export { queueAgentTask, getPendingTasks, updateTaskStatus, cancelTask } from './queue.js';

// Memory operations
export {
  type AgentMemoryEntry,
  type MessageClaim,
  type ConversationMemory,
  type InsideJoke,
  type DecisionPattern,
  type ExtractedFact,
  logAgentMemory,
  getAgentMemory,
  getRecentThreadResponses,
  claimMessage,
  getMessageClaim,
  markMessageResponded,
  saveConversationMemory,
  getConversationMemories,
  saveConversationMemoryWithEmbedding,
  saveInsideJoke,
  getInsideJokes,
  incrementJokeUsage,
  saveDecisionPattern,
  getDecisionPatterns,
  saveDecisionPatternWithEmbedding,
  saveExtractedFact,
  getExtractedFacts,
  getConversationalContext,
} from './memory.js';

// Team activity operations
export {
  type TeamActivity,
  logTeamActivity,
  getThreadActivity,
  getOpportunityActivity,
  formatTeamActivityForAgent,
  hasAgentContributed,
  getActivitySummary,
  getTeamActivitySummary,
} from './team-activity.js';

// Competitor operations
export {
  type CompetitorIntel,
  saveCompetitorIntel,
  getCompetitorIntel,
  getCompetitorIntelByAgency,
  hasRecentIntel,
  markIntelStale,
  getRecentCompetitorIntel,
} from './competitors.js';

// Feedback operations
export {
  type SystemFeedback,
  type AgentFeedback,
  logFeedback,
  getUnresolvedFeedback,
  getFeedbackSummary,
  resolveFeedback,
  recordAgentFeedback,
  getAgentFeedbackStats,
} from './feedback.js';

// Participation operations
export {
  type ThreadParticipation,
  type AgentHandoff,
  recordThreadParticipation,
  getAgentThreads,
  hasParticipatedInThread,
  createHandoff,
  getPendingHandoffs,
  acknowledgeHandoff,
} from './participation.js';

// Workflow operations
export {
  type WorkflowStage,
  type OpportunityWorkflow,
  type DecisionOutcome,
  createOpportunityWorkflow,
  getWorkflowByNoticeId,
  updateOpportunityWorkflow,
  getWorkflowsNeedingAction,
  getWorkflowsByStage,
  getWorkflowsAwaitingHuman,
  recordStageTransition,
  recordDecisionOutcome,
  getRecommendationAccuracy,
} from './workflow.js';

// Partner operations
export {
  type PartnerCompany,
  type TeamingInteraction,
  savePartnerCompany,
  getPartnerByName,
  searchPartnersByCertification,
  searchPartnersByCapability,
  searchPartnersByAgency,
  getActivePartners,
  logTeamingInteraction,
  getTeamingHistory,
  getPartnersForOpportunity,
  formatPartnerForContext,
} from './partners.js';

// Cron job operations
export {
  type CronJobRun,
  logJobStart,
  logJobComplete,
  logJobFailed,
  getRecentJobRuns,
  getJobStats,
  acquireCronLock,
  releaseCronLock,
  cleanupExpiredLocks,
} from './cron.js';
