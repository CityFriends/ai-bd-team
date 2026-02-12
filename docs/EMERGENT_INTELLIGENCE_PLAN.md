# Emergent Intelligence Layer Implementation Plan

## Overview

Transform the AI BD team from poll-based isolated workers to an event-driven interconnected system where agents react to each other's outputs in real-time.

**Key Principle:** The event layer is ADDITIVE - existing cron jobs and workflows continue working. Events add reactivity ON TOP.

---

## Phase 1: Database Infrastructure

### New Migration: `supabase/migrations/20260212_agent_events.sql`

**Tables to Create:**

1. **`agent_events`** - The event bus scratchpad
   - `id`, `event_type`, `source_agent`, `target_agent`
   - `payload` (JSONB), `parent_event_id` (for chaining), `root_event_id`
   - `status` (pending/claimed/processing/completed/failed/expired)
   - `priority` (1-10), `chain_depth`
   - `channel_id`, `thread_ts` (Slack context)
   - `process_after`, `expires_at`, `retry_count`

2. **`agent_subscriptions`** - Who listens to what
   - `agent`, `event_type`, `priority_override`, `filter_conditions`, `enabled`

3. **`agent_event_metrics`** - Performance tracking
   - Hourly aggregations of events published/processed/failed

**Database Functions:**
- `publish_event()` - Atomic event creation with chain tracking
- `claim_events()` - Atomic claim with `FOR UPDATE SKIP LOCKED`
- `complete_event()` - Mark success/failure with exponential backoff retry
- `get_pending_events()` - Read-only for monitoring
- `get_event_chain()` - Recursive CTE for chain visualization
- `expire_stale_events()` - Cleanup via cron

**Default Subscriptions:**
```
david    -> NEW_OPPORTUNITY
marcus   -> RESEARCH_COMPLETE
rosa     -> RESEARCH_COMPLETE
james    -> RESEARCH_COMPLETE, TECH_ASSESSMENT_COMPLETE, RELATIONSHIP_CHECK_COMPLETE
patricia -> GO_NO_GO_DECISION
marcus   -> GO_NO_GO_DECISION (for solution architecture)
maya     -> PURSUIT_DECISION_FEEDBACK (learning)
```

---

## Phase 2: TypeScript Event Module

### File Structure: `/src/events/`

```
src/events/
├── index.ts                 # Public exports
├── eventTypes.ts            # Event type constants + Zod schemas
├── eventBus.ts              # publishEvent, claimEvents, completeEvent
├── eventProcessor.ts        # Polling processor class
├── __tests__/
│   ├── eventTypes.test.ts
│   ├── eventBus.test.ts
│   └── eventProcessor.test.ts
└── handlers/
    ├── index.ts             # Handler registry
    ├── maya.handlers.ts
    ├── david.handlers.ts
    ├── rosa.handlers.ts
    ├── james.handlers.ts
    ├── patricia.handlers.ts
    └── marcus.handlers.ts
```

### Event Types (in `eventTypes.ts`)

```typescript
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
```

**Zod Schemas** for each event payload (validation + types).

---

## Phase 3: Chain Reaction Workflow

### Primary BD Chain

```
Maya finds opportunity (score >= 70)
  └─> NEW_OPPORTUNITY
        ├─> David: research incumbent, red flags
        │     └─> RESEARCH_COMPLETE
        │           ├─> Marcus: tech assessment
        │           │     └─> TECH_ASSESSMENT_COMPLETE
        │           ├─> Rosa: relationship check
        │           │     └─> RELATIONSHIP_CHECK_COMPLETE
        │           └─> James: waits for Marcus + Rosa
        │                 └─> GO_NO_GO_DECISION
        │                       ├─> Patricia: schedules pursuit
        │                       └─> Marcus: drafts solution architecture (if GO)
```

### Thread Continuity

Events carry `threadTs` + `channelId` through the chain so all agents reply in the same Slack thread - making the chain visible to humans.

---

## Phase 4: Agent Event Handlers

### David (`david.handlers.ts`)
- **Listens:** `NEW_OPPORTUNITY`
- **Publishes:** `RESEARCH_COMPLETE` with incumbent, red/green flags, confidence

### Marcus (`marcus.handlers.ts`)
- **Listens:** `RESEARCH_COMPLETE`, `GO_NO_GO_DECISION`
- **Publishes:** `TECH_ASSESSMENT_COMPLETE` with tech stack assessment, compliance concerns, FedRAMP requirements
- On GO: drafts solution architecture

### Rosa (`rosa.handlers.ts`)
- **Listens:** `RESEARCH_COMPLETE`
- **Publishes:** `RELATIONSHIP_CHECK_COMPLETE` with teaming recommendation, partner types, certification gaps

### James (`james.handlers.ts`)
- **Listens:** `RESEARCH_COMPLETE`, `TECH_ASSESSMENT_COMPLETE`, `RELATIONSHIP_CHECK_COMPLETE`
- **Publishes:** `GO_NO_GO_DECISION` with recommendation, win probability, key factors, risks

### Patricia (`patricia.handlers.ts`)
- **Listens:** `GO_NO_GO_DECISION`, `DEADLINE_WARNING`, `PIPELINE_HEALTH_CHECK`
- **Publishes:** `PURSUIT_SCHEDULED`, `DEADLINE_WARNING`

### Maya (`maya.handlers.ts`)
- **Listens:** `PURSUIT_DECISION_FEEDBACK`
- **Publishes:** `NEW_OPPORTUNITY` (from existing scanner)
- Learns from outcomes to refine future scoring

---

## Phase 5: Autonomous Behaviors

### Cron-Triggered Events (`src/cron/event-triggers.ts`)

| Schedule | Event | Handler |
|----------|-------|---------|
| Every 2 hours (business) | `PIPELINE_HEALTH_CHECK` | Patricia audits pipeline |
| Every hour | Deadline check | `DEADLINE_WARNING` if ≤24h |
| Every 30 min | `SYSTEM_HEALTH_CHECK` | Marcus monitors APIs |
| Daily 7am | `TECH_LANDSCAPE_SCAN` | Marcus scans gov tech news |
| Every 5 min | `expire_stale_events()` | Cleanup |

---

## Phase 6: LiveAgent Integration

Modify `src/live/agent.ts` base class:

```typescript
export abstract class LiveAgent {
  protected eventProcessor: EventProcessor | null = null;

  async startEventProcessor(): Promise<void> { ... }
  stopEventProcessor(): void { ... }
  protected async publishEvent(...): Promise<string | null> { ... }
}
```

Update `src/live/run-team.ts` to start event processors for all agents.

---

## Phase 7: Testing Strategy

Using vitest (already configured):

1. **Unit tests** for eventTypes Zod schemas
2. **Unit tests** for eventBus functions (mock Supabase)
3. **Unit tests** for EventProcessor (mock claimEvents, handlers)
4. **Integration tests** for full chain (Maya → Patricia)

Follow existing test patterns in `src/integrations/database/__tests__/`.

---

## Implementation Order

| Step | Task | Files |
|------|------|-------|
| 1 | Create database migration | `supabase/migrations/20260212_agent_events.sql` |
| 2 | Run migration, seed subscriptions | Supabase dashboard |
| 3 | Create eventTypes.ts | `src/events/eventTypes.ts` |
| 4 | Create eventBus.ts | `src/events/eventBus.ts` |
| 5 | Create eventProcessor.ts | `src/events/eventProcessor.ts` |
| 6 | Create handler registry | `src/events/handlers/index.ts` |
| 7 | Implement david.handlers.ts | First handler - proves pattern |
| 8 | Implement marcus.handlers.ts | Tech assessment chain |
| 9 | Implement rosa.handlers.ts | Relationship check |
| 10 | Implement james.handlers.ts | Go/no-go synthesis |
| 11 | Implement patricia.handlers.ts | Pursuit scheduling |
| 12 | Implement maya.handlers.ts | Learning feedback |
| 13 | Create event-triggers.ts | Autonomous behaviors |
| 14 | Modify LiveAgent base class | Event processor integration |
| 15 | Update run-team.ts | Start processors |
| 16 | Write tests | All __tests__ files |
| 17 | End-to-end testing | Full chain verification |

---

## Critical Files to Modify

- `src/live/agent.ts` - Add event processor support
- `src/live/run-team.ts` - Start event processors
- `src/live/maya.ts` - Publish NEW_OPPORTUNITY after posting
- `src/scripts/maya-scanner.ts` - Publish events from scanner

## Critical Files to Create

- `supabase/migrations/20260212_agent_events.sql`
- `src/events/eventTypes.ts`
- `src/events/eventBus.ts`
- `src/events/eventProcessor.ts`
- `src/events/handlers/*.ts` (6 files)
- `src/cron/event-triggers.ts`
- `src/events/__tests__/*.ts` (3 files)

---

## Success Criteria

1. **Chain reactions work:** Maya finding triggers automatic David → Marcus → Rosa → James → Patricia chain
2. **Thread visibility:** All agent responses appear in same Slack thread
3. **Autonomous alerts:** Patricia warns about deadlines, Marcus monitors system health
4. **Learning loop:** Win/loss outcomes feed back to Maya's scoring
5. **Observability:** Can trace full event chains via `get_event_chain()`
6. **No regressions:** Existing cron jobs and workflows continue working

---

## Phase 7: Self-Organizing Process Evolution (The Playbook)

Rules, SOPs, and lessons learned that the team discovers from their own data — not hardcoded by humans.

### Database Tables (`supabase/migrations/20260212_team_playbook.sql`)

1. **`team_playbook`** - Self-discovered rules
   - `rule_type`: process_rule, threshold, preference, sop, lesson_learned
   - `category`: pursuit_criteria, timeline, teaming, tech_assessment, capacity
   - `evidence`: JSONB with win rates, samples, thresholds
   - `confidence`: 0-1, increases as more data supports it
   - `status`: proposed → active → retired

2. **`playbook_applications`** - Track rule usage
   - When rules are applied or overridden per opportunity

3. **`retrospective_runs`** - Patricia's monthly analysis runs

### Database Functions
- `propose_rule()` - Agent proposes rule, merges with similar existing
- `adopt_rule()` - Human activates a proposed rule
- `retire_rule()` - Retire underperforming rules
- `override_rule()` - Human overrides for specific opportunity
- `get_active_rules()` - Get rules by category/confidence
- `check_rule_health()` - Find rules to retire (>40% override rate)

### TypeScript Module (`src/playbook/`)

```
src/playbook/
├── index.ts              # Public exports
├── types.ts              # RuleType, RuleCategory, Zod schemas
├── database.ts           # DB functions (proposeRule, adoptRule, etc.)
├── rules.ts              # checkOpportunityAgainstRules, formatRulesForPrompt
├── retrospective.ts      # runMonthlyRetrospective, formatRetrospectiveForSlack
└── __tests__/
    ├── types.test.ts
    ├── database.test.ts
    └── rules.test.ts
```

### Integration Points

- **James' handler** consults playbook before go/no-go decisions
- **Patricia's cron** (`src/cron/patricia-retrospective.ts`) runs monthly retrospective
- Rules appear in agent prompts with confidence scores
- Violations flagged with recommendations

---

## Verification

After implementation:

1. Run `npm test` - all tests pass
2. Run `npm run lint` - no errors
3. Manual test: Post test opportunity in Slack → watch chain unfold
4. Check Supabase: `agent_events` table shows completed chain
5. Check metrics: `agent_event_metrics` accumulating data

---

## Implementation Log

### 2026-02-12: Phase 7 Complete (The Playbook)

**Files Created:**
- `supabase/migrations/20260212_team_playbook.sql` - Tables + functions
- `src/playbook/types.ts` - Type definitions, Zod schemas
- `src/playbook/database.ts` - DB wrapper functions
- `src/playbook/rules.ts` - Rule consultation utilities
- `src/playbook/retrospective.ts` - Monthly analysis
- `src/playbook/index.ts` - Public exports
- `src/cron/patricia-retrospective.ts` - Monthly cron job
- `src/playbook/__tests__/*.ts` - 56 tests

**Files Modified:**
- `src/events/handlers/james.handlers.ts` - Consults playbook before decisions
- `src/events/eventProcessor.ts` - Fixed NodeJS.Timeout type
- `src/playbook/rules.ts` - Fixed RuleCategory import

**Verified:**
- All 229 tests pass
- 0 linting errors
- Migration applied to Supabase
- All playbook tables and functions working

### 2026-02-12: Added TypeScript Pre-Commit Check

**Problem:** ESLint doesn't catch TypeScript type errors across files (e.g., invalid union values, missing properties). Build failed after push.

**Solution:** Added `tsc --noEmit` to lint-staged pre-commit hook:

```json
"lint-staged": {
  "*.ts": ["prettier --write", "eslint --fix"],
  "*.{ts,tsx}": ["bash -c 'npm run typecheck'"]
}
```

Now all commits with TypeScript files run full type checking before committing.
