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

company-context.ts
    │
    ├── Loads company_profile
    ├── Loads past_performance
    ├── Loads teaming_partners
    ├── Loads key_personnel
    └── Loads case_studies
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
│   ├── context/                 # Company context loading
│   │   └── company-context.ts   # Loads company profile, past perf, partners
│   │
│   ├── scripts/                 # Utility scripts
│   │   ├── scrape-company.ts    # Website scraper for company data
│   │   ├── onboard-company.ts   # Patricia's onboarding CLI
│   │   ├── import-notion.ts     # Full Notion import (contracts, CRM, rates)
│   │   ├── sync-scheduler.ts    # Scheduled Notion sync
│   │   ├── update-company-data.ts # Manual data updates
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
│   ├── company-knowledge-base.sql    # Full company KB schema (11 tables)
│   ├── company-knowledge-base-novector.sql  # Version without pgvector
│   ├── sync-log.sql             # Sync audit logging
│   ├── far-sections.sql         # FAR with embeddings
│   ├── seen-awards.sql          # Award deduplication
│   └── competitor-intel.sql     # Competitor intelligence
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

---

## Agent Intelligence Features

### Domain Expertise
Each agent has deep domain knowledge embedded in their system prompt:

| Agent | Expertise Area |
|-------|---------------|
| Maya | Opportunity identification: wired RFPs, SOW red flags, set-asides, NAICS games |
| David | Competitive intelligence: FPDS patterns, incumbent vulnerability, protest dynamics |
| Rosa | Teaming strategy: prime vs sub, teaming agreements, JV structures, partner red flags |
| James | Capture strategy: win probability, bid/no-bid, price-to-win, discriminators |
| Patricia | Proposal process: compliance matrices, schedules, review cycles, common failures |

### Proactive Behavior (Connect the Dots)
Agents don't just answer literal questions—they surface relevant context:
- Maya: "I've seen 3 HCD solicitations from VA this month—they're on a kick"
- David: "They just had a breach at Treasury—that might affect their VA work too"
- Rosa: "If we team with them here, that opens doors at HHS"
- James: "The obvious play is X, but have we considered Y?"
- Patricia: "This overlaps with the HHS proposal—do we have bandwidth?"

### Competitor Intelligence Pipeline
```
Message mentions competitor/incumbent
        │
        ▼
Detect company name (known competitors or pattern match)
        │
        ▼
Parallel news searches:
  - "[company] protest GAO"
  - "[company] performance problems"
  - "[company] contract award"
  - "[company] federal contract"
        │
        ▼
Save significant findings to competitor_intel table
        │
        ▼
Include in research context for response
        │
        ▼
Agent interprets strategically:
  "They lost a GAO protest last year—agency might be gun-shy"
```

### Response Quality Controls
- **Source citations required**: Agents must cite FPDS, SAM.gov, news links
- **Article URLs required**: When citing news, include actual link
- **Confidence levels**: HIGH (official source), MEDIUM (inference), LOW (speculation)
- **No false promises**: Agents can't say "I'll check" or "give me 20 minutes"
- **Follow-up responses**: Must respond with substance, not just emoji reactions

---

## Database Tables

### Core Operations
| Table | Purpose |
|-------|---------|
| `message_claims` | Prevents duplicate agent responses |
| `agent_memory` | Logs all agent responses with sources |
| `research_cache` | Caches API responses (2-6 hour TTL) |

### Memory & Context
| Table | Purpose |
|-------|---------|
| `user_context` | Personal info about Lapedra/Tamara |
| `conversation_memory` | Key moments to reference later |
| `inside_jokes` | Shared references that build over time |
| `decision_patterns` | Go/no-go decision history |

### Intelligence
| Table | Purpose |
|-------|---------|
| `competitor_intel` | Stored intel on competitors |
| `seen_awards` | Tracks reported awards (deduplication) |
| `far_sections` | FAR text with vector embeddings |

### Company Knowledge Base
| Table | Purpose |
|-------|---------|
| `company_profile` | Core company info, capabilities, certifications, NAICS |
| `past_performance` | Contract history with CPAR ratings, key accomplishments |
| `contacts` | Agency and industry contacts with relationship strength |
| `teaming_partners` | Partner companies, capabilities, relationship status |
| `labor_rates` | Labor categories and pricing by contract vehicle |
| `case_studies` | Detailed project case studies with outcomes |
| `key_personnel` | Team members, qualifications, availability |
| `proposal_content` | Reusable proposal language with win rates |
| `lessons_learned` | Bid and project lessons by type |
| `documents` | Embedded documents for semantic search (pgvector) |

---

## API Integration Summary

| Service | Auth | Used By | Purpose |
|---------|------|---------|---------|
| SAM.gov | API Key | Maya, Rosa | Opportunities, entity verification |
| FPDS | None | David, James | Contract history, incumbents |
| USASpending | None | David | Agency budgets |
| SerpAPI | API Key | Maya, David | News search (GovCon sources) |
| FAR (Supabase) | API Key | David, James | Regulation citations |
| Anthropic | API Key | All | Response generation |

---

## Monitoring & Scheduling

### Award Monitor
Polls FPDS for new contract awards:
- Agencies: VA, HHS, DOL, DHS, GSA
- Minimum value: $50K
- Filters out government-to-government transfers
- Saves to `seen_awards` to prevent duplicates
- Maya posts new awards to Slack

### Scheduled Jobs
| Script | Schedule | Purpose |
|--------|----------|---------|
| `maya-scanner.ts` | 8am Mon-Fri | Scan SAM.gov for opportunities |
| `maya-scanner.ts` | 8:30am Monday | Weekly opportunity summary |
| `patricia-checkin.ts` | 9am Mon-Fri | Morning team check-in |
| `patricia-checkin.ts` | 2pm Mon-Fri | Nudge for pending items |
| `award-scheduler.ts` | Mon/Thu 9am | Check for new awards |
| `sync-scheduler.ts` | Every 6 hours | Sync Notion data |

---

## Deployment

### Production (Railway)
The system runs 24/7 on Railway with automatic deployments.

```
┌─────────────────────────────────────────────────────────────┐
│                         RAILWAY                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Node.js Application                     │   │
│  │                                                      │   │
│  │  ┌──────────────┐  ┌──────────────────────────┐    │   │
│  │  │ Live Agents  │  │   Scheduled Jobs          │    │   │
│  │  │ (Socket Mode)│  │   (node-cron)            │    │   │
│  │  │              │  │                           │    │   │
│  │  │ Maya         │  │ 8am:  Maya scan          │    │   │
│  │  │ David        │  │ 9am:  Patricia check-in  │    │   │
│  │  │ Rosa         │  │ 2pm:  Patricia nudge     │    │   │
│  │  │ James        │  │ 6hr:  Notion sync        │    │   │
│  │  │ Patricia     │  │                           │    │   │
│  │  └──────────────┘  └──────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  Config: railway.json, nixpacks.toml                        │
│  Auto-deploy on push to main branch                         │
└─────────────────────────────────────────────────────────────┘
```

### Configuration Files
- `railway.json` - Railway service configuration
- `nixpacks.toml` - Build settings (Node.js 20, npm ci)

### Repository
- **GitHub**: `friends-innovation-lab/ai-bd-team`
- **Branch**: `main`
- **Auto-deploy**: Yes (push triggers deploy)

---

## Company Data Pipeline

The company knowledge base is populated from multiple sources and stays in sync automatically.

### Data Sources

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCES                                       │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │  FFTC Website   │  │  Notion DBs     │  │  Manual Entry   │            │
│  │  (scrape)       │  │  (API sync)     │  │  (onboarding)   │            │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘            │
│           │                    │                    │                       │
│           ▼                    ▼                    ▼                       │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                     SUPABASE (PostgreSQL)                            │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │  │
│  │  │company_profile│ │past_perform. │ │teaming_partn.│                 │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘                 │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                 │  │
│  │  │key_personnel │ │ case_studies │ │ labor_rates  │                 │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                    company-context.ts                                │  │
│  │         Loads & formats context for each agent's prompt              │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Source → Table Mapping

| Source | Script | Tables Populated |
|--------|--------|------------------|
| FFTC Website | `scrape-company.ts` | `company_profile`, `key_personnel`, `case_studies`, `proposal_content` |
| Notion: Contracts Overview | `import-notion.ts` | `past_performance` |
| Notion: CRM | `import-notion.ts` | `teaming_partners` |
| Notion: GSA MAS Rates | `import-notion.ts` | `labor_rates` |
| Interactive CLI | `onboard-company.ts` | `company_profile` (fills gaps) |

### Sync Flow

```
Website Scrape (manual or scheduled)
        │
        ▼
npm run scrape-company
  - Fetches /work, /about/team, /services
  - Extracts case studies, team members, capabilities
  - Saves to Supabase
        │
        ▼
Notion Sync (every 6 hours)
        │
        ▼
npm run sync (or sync:schedule)
  - Fetches Contracts Overview database
  - Fetches CRM database
  - Fetches GSA MAS Rates database
  - Maps fields to our schema
  - Upserts to Supabase (no duplicates)
  - Logs to sync_log table
        │
        ▼
Agent Request
        │
        ▼
company-context.ts loads from Supabase
  - Caches for 30 minutes
  - Formats per agent role:
    - Maya: NAICS, set-asides, capabilities
    - David: past performance, agency experience
    - Rosa: teaming partners, relationships
    - James: no-bid criteria, differentiators
    - Patricia: key personnel, availability
        │
        ▼
Included in agent's Claude prompt
```

### Notion Database IDs

| Database | ID | Fields Used |
|----------|-----|-------------|
| Contracts Overview | `1b807a79...` | Contract Name, Prime Contract Number, Value, Dates, Status, Vehicle, Set-Aside, NAICS |
| CRM | `1bc07a79...` | Company, Core Capabilities, SBA Designations, Strengths, Weaknesses, POC |
| GSA MAS Rates | `1e607a79...` | Labor Category, Year 1-5 Rates, SIN |

### Data Refresh Commands

```bash
# One-time full refresh
npm run scrape-company    # Website data
npm run import-notion     # Notion data (full import)
npm run sync              # Notion data (incremental)

# Scheduled continuous sync
npm run sync:schedule     # Runs every 6 hours

# Interactive profile completion
npm run onboard           # Patricia guides through gaps
```
