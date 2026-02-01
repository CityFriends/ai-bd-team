# AI BD Team - Architecture

## System Overview

The AI BD Team is a multi-agent system that simulates a government contracting business development team. Five AI agents with distinct personalities collaborate in a Slack workspace to find, research, and evaluate federal opportunities.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SLACK WORKSPACE                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│  │  Maya   │ │  David  │ │  Rosa   │ │  James  │ │Patricia │               │
│  │ (Scout) │ │(Analyst)│ │(Connect)│ │(Strat)  │ │  (PM)   │               │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘               │
│       │           │           │           │           │                     │
│       └───────────┴───────────┴───────────┴───────────┘                     │
│                               │                                              │
│                    Socket Mode Connection                                    │
└───────────────────────────────┼─────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NODE.JS APPLICATION                                │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                         Live Agent System                             │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │ Message    │  │ Research   │  │ Response   │  │ Memory     │     │  │
│  │  │ Handler    │──│ Context    │──│ Generator  │──│ Manager    │     │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Integration Layer                              │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │  │
│  │  │ SAM.gov │ │  FPDS   │ │USASpend │ │ SerpAPI │ │   FAR   │       │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL SERVICES                               │
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  Supabase   │  │  Anthropic  │  │   SAM.gov   │  │   SerpAPI   │       │
│  │  (Postgres) │  │   Claude    │  │    APIs     │  │   (News)    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Message Reception
```
User @mentions agent in Slack
        │
        ▼
Slack sends event via Socket Mode
        │
        ▼
Agent's event handler receives message
        │
        ▼
Deduplication check (processedMessages Set)
        │
        ▼
Other agent mention check (prevents pile-ons)
        │
        ▼
Message claiming (Supabase message_claims table)
```

### 2. Research Phase
```
Message parsed and cleaned
        │
        ▼
Topic detection (detectTopics)
  - Agency mentioned?
  - Company mentioned?
  - Competitor mentioned?
  - FAR question?
  - FPDS/spending query?
        │
        ▼
Parallel API calls based on topics
  - News search (SerpAPI)
  - FPDS contract data
  - USASpending budgets
  - SAM.gov entity verification
  - FAR section lookup
  - Competitor intel search
        │
        ▼
Research context assembled
```

### 3. Response Generation
```
Research context + Thread history + Memory
        │
        ▼
Agent system prompt + expertise
        │
        ▼
Claude API call (claude-sonnet-4-20250514)
        │
        ▼
JSON response parsed
  {
    shouldRespond: boolean,
    response: string,
    sources: string[],
    confidenceLevel: "HIGH"|"MEDIUM"|"LOW",
    reaction: string (optional)
  }
        │
        ▼
Natural delay (2-8 seconds)
        │
        ▼
Post to Slack thread
        │
        ▼
Log to agent_memory table
```

## Component Relationships

### Agent Classes
```
LiveAgent (abstract base)
    │
    ├── MayaAgent (Scout)
    ├── DavidAgent (Analyst)
    ├── RosaAgent (Connector)
    ├── JamesAgent (Strategist)
    └── PatriciaAgent (PM)
```

### Integration Modules
```
research-context.ts
    │
    ├── news-search.ts (SerpAPI)
    ├── fpds.ts (contract data)
    ├── usaspending.ts (budgets)
    ├── sam-entity.ts (entity verification)
    ├── far-search.ts (FAR citations)
    └── supabase.ts (competitor intel)
```

## File Structure

```
ai-bd-team/
├── src/
│   ├── live/                    # Real-time Slack agents
│   │   ├── agent.ts             # Base LiveAgent class
│   │   ├── maya.ts              # Scout agent
│   │   ├── david.ts             # Analyst agent
│   │   ├── rosa.ts              # Connector agent
│   │   ├── james.ts             # Strategist agent
│   │   ├── patricia.ts          # PM agent
│   │   ├── run-team.ts          # Starts all agents
│   │   └── types.ts             # Type definitions
│   │
│   ├── integrations/            # External API integrations
│   │   ├── supabase.ts          # Database operations
│   │   ├── claude.ts            # Anthropic API client
│   │   ├── slack.ts             # Slack utilities
│   │   ├── sam-gov.ts           # SAM.gov opportunities
│   │   ├── sam-entity.ts        # SAM.gov entity lookup
│   │   ├── fpds.ts              # FPDS contract data
│   │   ├── usaspending.ts       # USASpending API
│   │   ├── news-search.ts       # SerpAPI news search
│   │   ├── far-search.ts        # FAR semantic search
│   │   ├── research-context.ts  # Unified research orchestration
│   │   └── award-monitor.ts     # FPDS award polling
│   │
│   ├── scripts/                 # Utility scripts
│   │   ├── parse-far.ts         # Parse FAR XML
│   │   ├── update-far.ts        # Refresh FAR data
│   │   ├── check-awards.ts      # Manual award check
│   │   └── award-scheduler.ts   # Scheduled award checks
│   │
│   ├── agents/                  # Legacy agent implementations
│   ├── coordination/            # Legacy coordination layer
│   └── types/                   # Shared type definitions
│
├── supabase/                    # Database migrations
│   ├── far-sections.sql
│   ├── seen-awards.sql
│   └── competitor-intel.sql
│
├── docs/                        # Documentation
└── data/                        # Generated data (gitignored)
```

## Key Design Decisions

### 1. Socket Mode for Slack
We use Socket Mode instead of HTTP webhooks because:
- Works behind firewalls
- No public URL required
- Real-time bidirectional communication
- Simpler local development

### 2. Separate Bot Tokens per Agent
Each agent has its own Slack bot token because:
- Appears as distinct users in Slack
- Can have unique profile pictures/names
- Independent rate limits
- Realistic multi-user feel

### 3. Message Claiming System
Prevents multiple agents responding to the same message:
- First agent to claim wins
- Uses Supabase `message_claims` table
- Unique constraint prevents duplicates

### 4. Research Context Orchestration
Unified research layer that:
- Detects relevant topics from message text
- Calls only necessary APIs
- Runs API calls in parallel
- Assembles context for agent prompt

### 5. Claude for Response Generation
Using Claude claude-sonnet-4-20250514 because:
- Best balance of speed and quality
- Strong instruction following
- Good at maintaining personality
- Reliable JSON output
