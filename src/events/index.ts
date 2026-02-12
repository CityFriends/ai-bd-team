// Event System - Public Exports

// Event Types and Schemas
export {
  EventTypes,
  EventStatus,
  type EventType,
  type EventStatusType,
  // Payload types
  type NewOpportunityPayload,
  type OpportunityUpdatedPayload,
  type ResearchCompletePayload,
  type TechAssessmentCompletePayload,
  type RelationshipCheckCompletePayload,
  type GoNoGoDecisionPayload,
  type PursuitScheduledPayload,
  type PursuitDecisionFeedbackPayload,
  type DeadlineWarningPayload,
  type PipelineHealthCheckPayload,
  type SystemHealthCheckPayload,
  type RiskAlertPayload,
  type OutcomeRecordedPayload,
  // Event record types
  type AgentEvent,
  type ClaimedEvent,
  // Validation
  validatePayload,
  isValidEventType,
} from './eventTypes.js';

// Event Bus Functions
export {
  publishEvent,
  claimEvents,
  completeEvent,
  getPendingEvents,
  getEventChain,
  expireStaleEvents,
  getEventById,
  getEventsByThread,
  updateSubscription,
  getAgentSubscriptions,
  // Convenience publishers
  publishNewOpportunity,
  publishChainEvent,
  publishTargetedEvent,
  // Types
  type PublishEventOptions,
  type PublishResult,
  type CompleteEventOptions,
  type EventChainItem,
  type AgentSubscription,
  type AgentOrSystem,
} from './eventBus.js';

// Event Processor
export {
  EventProcessor,
  createEventProcessor,
  // Handler helpers
  createTransformHandler,
  createLogHandler,
  combineHandlers,
  withTimeout,
  withRetry,
  // Types
  type EventHandler,
  type EventHandlerContext,
  type EventHandlerResult,
  type EventProcessorConfig,
} from './eventProcessor.js';

// Handler Registry
export {
  getHandlersForAgent,
  getHandler,
  hasHandler,
  getHandledEventTypes,
  getAgentsForEventType,
  // Individual handler maps
  mayaHandlers,
  davidHandlers,
  marcusHandlers,
  rosaHandlers,
  jamesHandlers,
  patriciaHandlers,
} from './handlers/index.js';
