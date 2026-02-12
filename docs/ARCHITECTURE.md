# AI BD Team - Architecture

*Last Updated: February 2026*

## System Overview

The AI BD Team is an event-driven multi-agent system that simulates a government contracting business development team. Seven AI agents with distinct personalities collaborate in a Slack workspace to find, research, and evaluate federal opportunities using real government data APIs.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    SLACK WORKSPACE                                       │
│                                                                                          │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│   │  Maya   │ │  David  │ │  Rosa   │ │  James  │ │Patricia │ │  Jodie  │ │ Marcus  │ │
│   │ (Scout) │ │(Analyst)│ │(Connect)│ │(Stratgy)│ │  (PM)   │ │(Writer) │ │ (Engin) │ │
│   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ │
│        │           │           │           │           │           │           │        │
│        └───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘        │
│                                         │                                                │
│                              Socket Mode WebSocket                                       │
└─────────────────────────────────────────┼───────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              NODE.JS APPLICATION (Railway)                               │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              LIVE AGENT SYSTEM                                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │ │
│  │  │   Message    │  │   Research   │  │   Claude     │  │   Memory     │           │ │
│  │  │   Handler    │──│   Context    │──│   Response   │──│   Manager    │           │ │
│  │  │              │  │   Builder    │  │   Generator  │  │              │           │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘           │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                               │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              EVENT SYSTEM                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │ │
│  │  │   Event      │  │    Event     │  │   Agent      │  │   Chain      │           │ │
│  │  │   Bus        │──│   Processor  │──│   Handlers   │──│   Tracker    │           │ │
│  │  │              │  │              │  │              │  │              │           │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘           │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                               │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           INTEGRATION LAYER                                         │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │ │
│  │  │ SAM.gov │ │  FPDS/  │ │ SerpAPI │ │   FAR   │ │ GitHub  │ │ Notion  │         │ │
│  │  │         │ │USASpend │ │ (News)  │ │(pgvec.) │ │(@octo)  │ │  Hub    │         │ │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                               │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           SCHEDULED JOBS (node-cron)                                │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                     │ │
│  │  │ Maya Scanner    │  │ Patricia Check  │  │ David News      │                     │ │
│  │  │ (8am Mon-Fri)   │  │ (11am/2pm)      │  │ (8am MWF)       │                     │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘                     │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────┼───────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  EXTERNAL SERVICES                                       │
│                                                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│  │   Supabase    │  │   Anthropic   │  │   SAM.gov     │  │    SerpAPI    │            │
│  │  (PostgreSQL  │  │    Claude     │  │     APIs      │  │    (News)     │            │
│  │   + pgvector) │  │               │  │               │  │               │            │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘            │
│                                                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │
│  │  USASpending  │  │    GitHub     │  │    Notion     │  │     Slack     │            │
│  │               │  │  (@octokit)   │  │      Hub      │  │   (Socket)    │            │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Opportunity Discovery to Pursuit

### Complete Opportunity Workflow

```
                              ┌─────────────────────────────────────────┐
                              │              SAM.gov API                 │
                              │     (Federal Opportunities)              │
                              └──────────────────┬──────────────────────┘
                                                 │
                                    8am Daily Poll (NAICS 541511/12/19)
                                                 │
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                     MAYA (SCOUT)                                         │
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  1. Fetch new opportunities from SAM.gov                                        │   │
│   │  2. Score each opportunity (0-100):                                             │   │
│   │     - Keywords (0-30): HCD, UX, modernization, etc.                             │   │
│   │     - Agency (0-20): VA, HHS, DOL priority                                      │   │
│   │     - Set-aside (0-15): 8(a), WOSB preference                                   │   │
│   │     - Type (0-15): RFI/Sources Sought bonus                                     │   │
│   │     - Timeline (0-20): 14-45 days sweet spot                                    │   │
│   │  3. Validate: noticeId, title, postedDate must exist                            │   │
│   │  4. Post to Slack with personality-driven summary                               │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│   Publishes: NEW_OPPORTUNITY event                                                       │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           │ Event triggers David
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DAVID (ANALYST)                                       │
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  Parallel Research:                                                              │   │
│   │  ├── USASpending: Agency budget trends, spending categories                     │   │
│   │  ├── Contract Data: Incumbent contracts, vendor history                         │   │
│   │  ├── SerpAPI: Agency news, leadership changes (30 days)                         │   │
│   │  ├── Competitor Intel: Protests, performance issues                             │   │
│   │  └── FAR: Relevant acquisition regulations                                      │   │
│   │                                                                                  │   │
│   │  Output: Red flags, green flags, incumbent analysis, risk assessment            │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│   Publishes: RESEARCH_COMPLETE event                                                     │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                              ▼                         ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│         MARCUS (ENGINEERING)          │  │           ROSA (CONNECTOR)            │
│                                        │  │                                        │
│   ┌────────────────────────────────┐  │  │   ┌────────────────────────────────┐  │
│   │  If technical opportunity:      │  │  │   │  Partner search:                │  │
│   │  ├── Analyze linked repos       │  │  │   │  ├── Query partner database     │  │
│   │  ├── Assess tech stack          │  │  │   │  ├── Match NAICS/capabilities   │  │
│   │  ├── FedRAMP/ATO requirements   │  │  │   │  ├── Check certifications       │  │
│   │  ├── Section 508 compliance     │  │  │   │  ├── Evaluate relationship      │  │
│   │  └── Architecture concerns      │  │  │   │  └── Prime vs. sub analysis     │  │
│   └────────────────────────────────┘  │  │   └────────────────────────────────┘  │
│                                        │  │                                        │
│   Publishes: TECH_ASSESSMENT_COMPLETE  │  │   Publishes: RELATIONSHIP_CHECK_DONE  │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
                              │                         │
                              └────────────┬────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   JAMES (STRATEGIST)                                     │
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  Waits for: RESEARCH_COMPLETE + TECH_ASSESSMENT + RELATIONSHIP_CHECK            │   │
│   │                                                                                  │   │
│   │  Synthesis:                                                                      │   │
│   │  ├── Consult team_playbook for relevant rules                                   │   │
│   │  ├── Calculate win probability (HIGH/MEDIUM/LOW)                                │   │
│   │  ├── Determine approach (PRIME/SUB/NO-BID)                                      │   │
│   │  ├── Identify discriminators                                                     │   │
│   │  ├── List key risks                                                              │   │
│   │  └── Estimate investment (hours)                                                │   │
│   │                                                                                  │   │
│   │  Output: GO / NO-GO / HOLD recommendation with reasoning                        │   │
│   │  Action: @Lapedra for final decision                                            │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│   Publishes: GO_NO_GO_DECISION event                                                     │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           │ Human decision required
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HUMAN DECISION                                         │
│                                                                                          │
│   @Lapedra reviews in Slack or Notion Hub:                                              │
│   ├── All agent analysis in single thread                                               │
│   ├── Win probability and risks                                                         │
│   ├── Teaming recommendation                                                            │
│   └── Makes GO / NO-GO / HOLD decision                                                  │
│                                                                                          │
│   Decision recorded in: decision_patterns table                                          │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           │ If GO decision
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PATRICIA (PM)                                          │
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  Pipeline Management:                                                            │   │
│   │  ├── Update opportunity status to "pursuing"                                    │   │
│   │  ├── Track key deadlines (Q&A, proposal, orals)                                 │   │
│   │  ├── Schedule follow-up reminders                                               │   │
│   │  ├── Monitor progress in morning standups                                       │   │
│   │  └── Nudge for pending items (2pm daily)                                        │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                          │
│   Publishes: PURSUIT_SCHEDULED event                                                     │
└──────────────────────────────────────────┬──────────────────────────────────────────────┘
                                           │
                                           │ Sync to human tools
                                           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NOTION HUB                                             │
│                                                                                          │
│   ┌────────────────────────────────────────────────────────────────────────────────┐   │
│   │  8 Synchronized Databases:                                                       │   │
│   │  ├── Opportunities: Full pipeline with all agent analysis                       │   │
│   │  ├── Partners: Teaming partner database                                          │   │
│   │  ├── Activity Log: All agent actions                                             │   │
│   │  ├── Decisions: Go/No-Go with outcomes                                           │   │
│   │  └── ... (4 more databases)                                                      │   │
│   │                                                                                  │   │
│   │  Bidirectional sync: Human edits flow back to agents                            │   │
│   └────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Event-Driven Architecture

### Event System Components

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    EVENT BUS                                             │
│                                                                                          │
│   ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐        │
│   │   publishEvent()   │────▶│  agent_events      │────▶│  claimEvents()     │        │
│   │                    │     │  (Supabase table)  │     │                    │        │
│   └────────────────────┘     └────────────────────┘     └────────────────────┘        │
│                                       │                          │                      │
│                                       │                          │                      │
│   ┌────────────────────┐              │              ┌────────────────────┐            │
│   │ agent_subscriptions│◀─────────────┘              │  EventProcessor    │            │
│   │ (routing rules)    │                             │  (polling loop)    │            │
│   └────────────────────┘                             └─────────┬──────────┘            │
│                                                                │                        │
│                                                                ▼                        │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                           AGENT HANDLERS                                         │  │
│   │                                                                                  │  │
│   │   maya.handlers.ts    │  david.handlers.ts   │  rosa.handlers.ts                │  │
│   │   james.handlers.ts   │  patricia.handlers.ts│  marcus.handlers.ts              │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│   Event Statuses: pending → claimed → processing → completed/failed/expired             │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Default Event Subscriptions

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              EVENT SUBSCRIPTIONS                                         │
│                                                                                          │
│   Event Type                    │  Subscribed Agents                                     │
│   ─────────────────────────────────────────────────────────────────────────────────     │
│   NEW_OPPORTUNITY               │  David                                                │
│   RESEARCH_COMPLETE             │  Marcus, Rosa, James                                  │
│   TECH_ASSESSMENT_COMPLETE      │  James                                                │
│   RELATIONSHIP_CHECK_COMPLETE   │  James                                                │
│   GO_NO_GO_DECISION             │  Patricia, Marcus (if GO)                             │
│   DEADLINE_WARNING              │  Patricia                                             │
│   PIPELINE_HEALTH_CHECK         │  Patricia                                             │
│   SYSTEM_HEALTH_CHECK           │  Marcus                                               │
│   PURSUIT_DECISION_FEEDBACK     │  Maya (learning)                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Chain Reaction Example

```
Maya posts opportunity (score: 78)
    │
    └──▶ NEW_OPPORTUNITY published
              │
              └──▶ David claims event (10-30s delay)
                        │
                        ├── Researches incumbent (Booz Allen)
                        ├── Finds GAO protest news
                        ├── Gets VA spending trends
                        │
                        └──▶ RESEARCH_COMPLETE published
                                  │
                                  ├──▶ Marcus claims (tech review)
                                  │         └──▶ TECH_ASSESSMENT_COMPLETE
                                  │
                                  ├──▶ Rosa claims (teaming check)
                                  │         └──▶ RELATIONSHIP_CHECK_COMPLETE
                                  │
                                  └──▶ James waits for both...
                                              │
                                              └── Synthesizes all inputs
                                                      │
                                                      └──▶ GO_NO_GO_DECISION
                                                                │
                                                                └──▶ @Lapedra in thread
                                                                          │
                                                                          └── Human decides GO
                                                                                    │
                                                                                    └──▶ Patricia schedules
```

---

## Database ERD

### Core Tables

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  CORE OPERATIONS                                         │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐         ┌──────────────────┐      │
│   │   opportunities  │          │     agencies     │         │    companies     │      │
│   │──────────────────│          │──────────────────│         │──────────────────│      │
│   │ sam_id (PK)      │          │ abbreviation(PK) │         │ id (PK)          │      │
│   │ title            │          │ tech_stack       │         │ name             │      │
│   │ agency           │──────────│ pain_points      │         │ certifications[] │      │
│   │ fit_score        │          │ key_personnel    │         │ naics_codes[]    │      │
│   │ status           │          │ our_history      │         │ relationship_    │      │
│   │ decision         │          │ research_notes   │         │   status         │      │
│   └──────────────────┘          └──────────────────┘         └──────────────────┘      │
│                                                                         │               │
│   ┌──────────────────┐          ┌──────────────────┐                   │               │
│   │     outreach     │          │conversation_     │                   │               │
│   │──────────────────│          │    threads       │                   │               │
│   │ id (PK)          │          │──────────────────│                   │               │
│   │ company_id (FK)  │──────────│ slack_thread_ts  │                   │               │
│   │ opportunity_id   │          │ opportunity_id   │◀──────────────────┘               │
│   │ status           │          │ agents_involved[]│                                    │
│   │ draft_content    │          │ context_summary  │                                    │
│   └──────────────────┘          └──────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Agent Coordination Tables

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               AGENT COORDINATION                                         │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐         ┌──────────────────┐      │
│   │  message_claims  │          │   agent_memory   │         │   agent_queue    │      │
│   │──────────────────│          │──────────────────│         │──────────────────│      │
│   │ message_ts (PK)  │          │ id (PK)          │         │ id (PK)          │      │
│   │ thread_ts        │          │ agent            │         │ agent            │      │
│   │ agent            │          │ message_ts       │         │ action           │      │
│   │ claimed_at       │          │ response_text    │         │ scheduled_for    │      │
│   │ responded        │          │ sources[]        │         │ status           │      │
│   └──────────────────┘          │ confidence_level │         │ payload (JSONB)  │      │
│                                 └──────────────────┘         └──────────────────┘      │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐         ┌──────────────────┐      │
│   │  research_cache  │          │ agent_availability│        │ cron_job_runs    │      │
│   │──────────────────│          │──────────────────│         │──────────────────│      │
│   │ cache_key (PK)   │          │ agent (PK)       │         │ job_name (PK)    │      │
│   │ source           │          │ status           │         │ last_run         │      │
│   │ data (JSONB)     │          │ reason           │         │ next_run         │      │
│   │ created_at       │          │ until_time       │         │ status           │      │
│   └──────────────────┘          └──────────────────┘         └──────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Memory & Learning Tables

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                MEMORY & LEARNING                                         │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐         ┌──────────────────┐      │
│   │   user_context   │          │decision_patterns │         │conversation_     │      │
│   │──────────────────│          │──────────────────│         │    memory        │      │
│   │ id (PK)          │          │ id (PK)          │         │──────────────────│      │
│   │ user_name        │          │ decision         │         │ id (PK)          │      │
│   │ context_type     │          │ agency           │         │ memory_type      │      │
│   │ content          │          │ key_factors[]    │         │ summary          │      │
│   │ mentioned_by     │          │ reasoning        │         │ importance       │      │
│   │ still_relevant   │          │ created_at       │         │ participants[]   │      │
│   └──────────────────┘          └──────────────────┘         └──────────────────┘      │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐                                    │
│   │   team_playbook  │          │playbook_         │                                    │
│   │──────────────────│          │  applications    │                                    │
│   │ id (PK)          │          │──────────────────│                                    │
│   │ rule_type        │          │ id (PK)          │                                    │
│   │ category         │          │ rule_id (FK)     │                                    │
│   │ condition        │          │ opportunity_id   │                                    │
│   │ confidence       │          │ applied/overridden│                                   │
│   │ status           │          │ reason           │                                    │
│   └──────────────────┘          └──────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Intelligence Tables

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  INTELLIGENCE                                            │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐         ┌──────────────────┐      │
│   │ competitor_intel │          │   seen_awards    │         │ agency_forecasts │      │
│   │──────────────────│          │──────────────────│         │──────────────────│      │
│   │ id (PK)          │          │ contract_id (PK) │         │ id (PK)          │      │
│   │ company_name     │          │ vendor_name      │         │ agency           │      │
│   │ intel_type       │          │ agency_code      │         │ title            │      │
│   │ summary          │          │ amount           │         │ relevance_score  │      │
│   │ source_url       │          │ seen_at          │         │ posted_on_sam    │      │
│   │ discovered_by    │          └──────────────────┘         └──────────────────┘      │
│   └──────────────────┘                                                                  │
│                                                                                          │
│   ┌──────────────────┐          ┌──────────────────┐                                    │
│   │   far_sections   │          │    documents     │                                    │
│   │──────────────────│          │──────────────────│                                    │
│   │ id (PK)          │          │ id (PK)          │                                    │
│   │ part             │          │ filename         │                                    │
│   │ section          │          │ content          │                                    │
│   │ title            │          │ document_type    │                                    │
│   │ full_text        │          │ embedding        │ ◀── pgvector                      │
│   │ embedding        │ ◀── pgvector                │                                    │
│   └──────────────────┘          └──────────────────┘                                    │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## API Integration Map

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               API INTEGRATION MAP                                        │
│                                                                                          │
│                                 ┌─────────────────┐                                     │
│                                 │   Maya (Scout)  │                                     │
│                                 └────────┬────────┘                                     │
│                                          │                                               │
│                          ┌───────────────┼───────────────┐                              │
│                          ▼               ▼               ▼                              │
│                   ┌───────────┐   ┌───────────┐   ┌───────────┐                        │
│                   │ SAM.gov   │   │  SerpAPI  │   │  Notion   │                        │
│                   │ Opps API  │   │   News    │   │   Hub     │                        │
│                   └───────────┘   └───────────┘   └───────────┘                        │
│                                                                                          │
│                                 ┌─────────────────┐                                     │
│                                 │ David (Analyst) │                                     │
│                                 └────────┬────────┘                                     │
│                                          │                                               │
│              ┌───────────────┬───────────┼───────────┬───────────────┐                  │
│              ▼               ▼           ▼           ▼               ▼                  │
│       ┌───────────┐   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐          │
│       │USASpending│   │ Contract  │ │  SerpAPI  │ │    FAR    │ │ Supabase  │          │
│       │   API     │   │   Data    │ │   News    │ │  pgvector │ │   Intel   │          │
│       └───────────┘   └───────────┘ └───────────┘ └───────────┘ └───────────┘          │
│                                                                                          │
│                                 ┌─────────────────┐                                     │
│                                 │Rosa (Connector) │                                     │
│                                 └────────┬────────┘                                     │
│                                          │                                               │
│                          ┌───────────────┼───────────────┐                              │
│                          ▼               ▼               ▼                              │
│                   ┌───────────┐   ┌───────────┐   ┌───────────┐                        │
│                   │ SAM.gov   │   │  SerpAPI  │   │ companies │                        │
│                   │ Entity    │   │   News    │   │   table   │                        │
│                   └───────────┘   └───────────┘   └───────────┘                        │
│                                                                                          │
│                                 ┌─────────────────┐                                     │
│                                 │Marcus (Engineer)│                                     │
│                                 └────────┬────────┘                                     │
│                                          │                                               │
│                                          ▼                                               │
│                                   ┌───────────┐                                         │
│                                   │  GitHub   │                                         │
│                                   │ @octokit  │                                         │
│                                   └───────────┘                                         │
│                                                                                          │
│                                 ┌─────────────────┐                                     │
│                                 │   All Agents    │                                     │
│                                 └────────┬────────┘                                     │
│                                          │                                               │
│                          ┌───────────────┼───────────────┐                              │
│                          ▼               ▼               ▼                              │
│                   ┌───────────┐   ┌───────────┐   ┌───────────┐                        │
│                   │ Anthropic │   │   Slack   │   │ Supabase  │                        │
│                   │  Claude   │   │   Bolt    │   │   DB      │                        │
│                   └───────────┘   └───────────┘   └───────────┘                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
ai-bd-team/
├── src/
│   ├── live/                          # Real-time Slack agents
│   │   ├── agent.ts                   # Base LiveAgent class (2000 lines)
│   │   ├── maya.ts                    # Scout agent
│   │   ├── david.ts                   # Analyst agent
│   │   ├── rosa.ts                    # Connector agent
│   │   ├── james.ts                   # Strategist agent
│   │   ├── patricia.ts                # PM agent
│   │   ├── jodie.ts                   # Writer agent (partial)
│   │   ├── marcus.ts                  # Engineering Lead
│   │   ├── run-team.ts                # Starts all agents
│   │   ├── warmups.ts                 # Personality textures
│   │   └── types.ts                   # Type definitions
│   │
│   ├── integrations/                  # External API integrations
│   │   ├── sam-gov.ts                 # SAM.gov opportunities
│   │   ├── sam-entity.ts              # SAM.gov entity lookup
│   │   ├── usaspending.ts             # USASpending API
│   │   ├── contract-data.ts           # FPDS/contract data
│   │   ├── news-search.ts             # SerpAPI news
│   │   ├── far-search.ts              # FAR semantic search
│   │   ├── github.ts                  # GitHub repo analysis
│   │   ├── notion-hub.ts              # Notion integration
│   │   ├── agency-forecasts.ts        # 12-agency scraping
│   │   ├── award-monitor.ts           # Award detection
│   │   ├── research-context.ts        # Unified research
│   │   ├── claude.ts                  # Anthropic API
│   │   ├── slack.ts                   # Slack utilities
│   │   └── supabase.ts                # Database operations
│   │
│   ├── events/                        # Event-driven system
│   │   ├── eventTypes.ts              # Event definitions
│   │   ├── eventBus.ts                # Publish/subscribe
│   │   ├── eventProcessor.ts          # Event routing
│   │   └── handlers/                  # Agent handlers
│   │       ├── maya.handlers.ts
│   │       ├── david.handlers.ts
│   │       ├── rosa.handlers.ts
│   │       ├── james.handlers.ts
│   │       ├── patricia.handlers.ts
│   │       └── marcus.handlers.ts
│   │
│   ├── playbook/                      # Self-organizing rules
│   │   ├── types.ts                   # Rule types
│   │   ├── database.ts                # DB operations
│   │   ├── rules.ts                   # Rule consultation
│   │   └── retrospective.ts           # Monthly analysis
│   │
│   ├── context/                       # Company context
│   │   └── company-context.ts         # Knowledge base loader
│   │
│   ├── prompts/                       # Agent system prompts
│   │   ├── scout.ts
│   │   ├── analyst.ts
│   │   ├── connector.ts
│   │   ├── strategist.ts
│   │   └── pm.ts
│   │
│   ├── scripts/                       # Utility scripts
│   │   ├── maya-scanner.ts            # Opportunity scanner
│   │   ├── patricia-checkin.ts        # Morning standup
│   │   ├── david-news-digest.ts       # News digest
│   │   ├── import-notion.ts           # Notion import
│   │   └── ...
│   │
│   └── cron/                          # Scheduled jobs
│       ├── event-triggers.ts          # Autonomous events
│       └── patricia-retrospective.ts  # Monthly analysis
│
├── supabase/                          # Database migrations
│   ├── schema.sql                     # Main schema
│   ├── migrations/
│   │   ├── 20260212_agent_events.sql
│   │   ├── 20260212_team_playbook.sql
│   │   └── ...
│   └── ...
│
├── docs/                              # Documentation
└── data/                              # Generated data (gitignored)
```

---

## Key Design Decisions

### 1. Socket Mode for Slack
- Works behind firewalls
- No public URL required
- Real-time bidirectional communication
- Simpler local development

### 2. Separate Bot Tokens per Agent
- Appears as distinct users in Slack
- Unique profile pictures/names
- Independent rate limits
- Realistic multi-user feel

### 3. Message Claiming System
- Prevents pile-ons (multiple agents responding)
- Uses Supabase `message_claims` table
- UNIQUE constraint enforces exclusivity
- Auto-cleanup after 1 hour

### 4. Event-Driven + Polling Hybrid
- Events for agent-to-agent reactivity
- Cron jobs for scheduled autonomous behavior
- Additive design: events enhance, don't replace

### 5. Claude claude-sonnet-4-20250514 for Response Generation
- Best balance of speed and quality
- Strong instruction following
- Reliable JSON output
- Good personality maintenance

### 6. Research Context Orchestration
- Detects topics from message text
- Calls only necessary APIs
- Runs API calls in parallel
- Assembles unified context for prompt

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   RAILWAY                                                │
│                                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                           Node.js Application                                    │  │
│   │                                                                                  │  │
│   │   ┌─────────────────────────┐    ┌─────────────────────────────────────────┐   │  │
│   │   │     Live Agents         │    │         Scheduled Jobs                   │   │  │
│   │   │     (Socket Mode)       │    │         (node-cron)                      │   │  │
│   │   │                         │    │                                           │   │  │
│   │   │  Maya    David   Rosa   │    │  8am:   Maya scan                        │   │  │
│   │   │  James   Patricia       │    │  8am:   David news (MWF)                 │   │  │
│   │   │  Marcus                 │    │  11am:  Patricia standup                 │   │  │
│   │   │                         │    │  2pm:   Patricia nudge                   │   │  │
│   │   │  (Jodie disabled)       │    │  6hr:   Notion sync                      │   │  │
│   │   └─────────────────────────┘    └─────────────────────────────────────────┘   │  │
│   │                                                                                  │  │
│   │   ┌─────────────────────────────────────────────────────────────────────────┐   │  │
│   │   │                        Event Processor                                   │   │  │
│   │   │                        (polling loop)                                    │   │  │
│   │   └─────────────────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│   Config: Dockerfile + railway.json                                                     │
│   Auto-deploy: Push to main branch                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              SECURITY LAYERS                                             │
│                                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  Authentication                                                                  │  │
│   │  ├── 7 separate Slack bot tokens                                                │  │
│   │  ├── 7 separate Slack app tokens                                                │  │
│   │  ├── Supabase service role key (server-side only)                               │  │
│   │  └── All API keys in environment variables                                      │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  Row-Level Security (RLS)                                                        │  │
│   │  ├── All 30+ tables have RLS enabled                                            │  │
│   │  ├── service_role only access (no anon key)                                     │  │
│   │  ├── Views use security_invoker = true                                          │  │
│   │  └── Functions have search_path = public                                        │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  Data Protection                                                                 │  │
│   │  ├── No PII stored beyond user names                                            │  │
│   │  ├── Research cache auto-expires (2-24 hours)                                   │  │
│   │  ├── Message claims cleaned weekly                                              │  │
│   │  └── Competitor intel marked stale after 180 days                               │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

*Architecture last updated: February 2026*
