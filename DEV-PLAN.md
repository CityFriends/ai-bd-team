# AI BD Team - Development Plan

## What We've Built

### Core Infrastructure
- [x] 6 Slack agents with separate bot tokens (Maya, David, Rosa, James, Patricia, Jodie)
- [x] Socket Mode for real-time message handling
- [x] Message deduplication to prevent double responses
- [x] Message claiming system to prevent pile-ons
- [x] Thread context loading for conversation awareness

### External API Integrations
- [x] SAM.gov opportunity search
- [x] FPDS incumbent/contract data
  - Fixed: uses RSS `<item>` tags, not Atom `<entry>`
  - Added: contract number (PIID) direct lookup
  - Added: agency code filtering for precision (VA=036, DOL=012, etc.)
  - Improved: stopword filtering for cleaner search queries
- [x] USASpending agency budgets
- [x] SerpAPI for news search
  - Added: time filtering (last 30 days default)
  - Reduced cache to 2 hours for fresher results
  - Added: GovCon-specific sources (OrangeSlices, GovConWire, WashTech, etc.)
- [x] Award Monitor (like OrangeSlices)
  - Polls FPDS for new awards across VA, HHS, DOL, DHS, GSA
  - Tracks seen awards in `seen_awards` table to avoid duplicates
  - Maya posts new awards to Slack automatically
  - Run manually: `npm run check-awards`
  - Run scheduled (Mon/Thu 9am): `npm run award-scheduler`
- [x] Agency Forecast Scraper
  - Scrapes 12 agency procurement forecast pages (CMS, VA, HHS, GSA, FEMA, DOL, State, ED, DHS, SBA, USDA, DOT)
  - Relevance scoring based on HCD/UX/digital services keywords
  - Stores forecasts in `agency_forecasts` table
  - Matches SAM.gov opps to previously forecasted opportunities
  - Run manually: `npm run forecast:scan`
  - Weekly schedule: `npm run forecast:schedule` (Sunday 10pm scan, Monday 8:15am brief)
- [x] SAM.gov entity verification for partners
- [x] FAR lookup (semantic search + direct citation lookup via Supabase)

### API Assignments by Agent
| Agent | APIs Wired Up | Use Case |
|-------|---------------|----------|
| Maya | SAM.gov opportunities, SerpAPI news | Scouts new opps, finds relevant news |
| David | FPDS, USASpending, FAR | Researches incumbents, budgets, cites regulations |
| Rosa | SAM.gov entity verification | Verifies potential partners |
| James | FAR, FPDS | Strategic analysis, regulatory guidance |
| Patricia | (none yet) | Tracks action items, manages workflow |
| Jodie | (none yet) | Proposal writing, compliance matrices, executive summaries |

### Agent Personalities (Distinct Voices)

| Agent | Role | Background | Voice |
|-------|------|------------|-------|
| Maya | Scout | 27, Spelman, Atlanta, civic tech | Gen-Z AAVE, "lowkey", "not gonna lie", hype energy |
| David | Analyst | 42, Korean American, NJ/Rutgers, Fairfax | Jersey direct, dad energy, dry humor, "Here's the thing..." |
| Rosa | Connector | 44, Mexican American, San Antonio, Silver Spring | Warm, Spanglish, "Mira", relationship-first |
| James | Strategist | 52, Black, Chicago South Side, Arlington | Executive presence, old school, "I've seen this before" |
| Patricia | PM | 31, Black, PG County/Howard, Petworth | Very online, millennial, emoji-friendly, TikTok references |
| Jodie | Writer | 33, Vietnamese American, UC Berkeley, Columbia Heights | Quiet confidence, word nerd, "Where's the 'so what'?", night owl |

### Conversational Features
- [x] Mood detection (busy, engaged, relaxed, stressed, uncertain)
- [x] Emotional intelligence (reads subtext, checks in when things seem off)
- [x] Casual banter triggers (weekend, shows, pop culture, etc.)
- [x] Emoji reactions support
- [x] Date awareness (knows what day it is)
- [x] Short phrase handling ("yes", "let's roll", etc.)
- [x] Personality quirks that persist
- [x] Non-work opinions (restaurants, Metro, weather - not politics)

### Agent Behavior Guardrails
- [x] No pile-ons: when one agent is @mentioned, others stay quiet
- [x] No false promises: agents don't say "give me 20 minutes" or "I'll check" - they use data they have NOW or say they don't have it
- [x] Source everything: agents cite FPDS, USASpending, FAR sections, news links
- [x] Confidence levels: HIGH (official source), MEDIUM (inference), LOW (guess)
- [x] Article links required: when citing news, must include actual URL
- [x] Follow-up responses: agents respond to thread questions with substance, not just emoji reactions
- [x] Short reply follow-through: when user says "yes" to agent offer, uses thread context for research
- [x] Current time awareness: agents know the current date/time for appropriate greetings

### Anti-Hallucination System ✓
- [x] SAM.gov validation: requires noticeId, title, postedDate for all opportunities
- [x] URL generation: `getSAMOpportunityURL()` creates real links from notice IDs
- [x] Post validation: blocks posts without real SAM.gov URLs
- [x] Maya verification command: "Maya, verify that opportunity" re-queries API
- [x] Personality variation: different openers based on score (90+, 70-89, 60-69)
- [x] Score threshold: won't post opportunities below score 60
- [x] Logging: shows raw API responses for debugging

### Feedback Logging System ✓
- [x] Patricia logs feedback via Slack commands: "Patricia, bug: [issue]"
- [x] Feedback types: bug, wrong_answer, great_catch, suggestion, annoying, missing_info
- [x] Auto-extracts agent name from feedback text
- [x] Severity levels: minor, medium, major
- [x] Weekly summary for Monday check-ins
- [x] Tracks resolved vs unresolved issues

### Competitor Intelligence
- [x] Automatic competitor news search when incumbents/competitors mentioned
- [x] Searches for: protests, GAO decisions, performance issues, recent wins
- [x] Knows major GovCon competitors: Booz Allen, Deloitte, SAIC, Leidos, GDIT, etc.
- [x] Saves intel to `competitor_intel` table for future reference
- [x] David reports findings naturally with strategic implications

### Proactive Behavior (Connect the Dots)
All agents now:
- [x] Surface relevant info beyond the literal question asked
- [x] Connect patterns and intel across conversations
- [x] Ask strategic follow-up questions
- [x] Tag teammates when their input would help
- [x] Think about timing, dependencies, and next steps

### Domain Expertise Prompts
Each agent has deep expertise they apply to interpret situations:
- [x] Maya: Spots wired RFPs, interprets SOW red flags, reads set-aside codes
- [x] David: Reads FPDS patterns, spots vulnerable incumbents, knows protest dynamics
- [x] Rosa: Knows prime vs sub strategy, structures teaming agreements, identifies partner red flags
- [x] James: Assesses win probability, knows bid/no-bid criteria, architects discriminators
- [x] Patricia: Runs compliance matrices, sets realistic schedules, knows proposal failures
- [x] Jodie: Section L/M analysis, compliance matrices, win theme integration, proposal editing

### Strategic Context & Reasoning ✓
Company profile now includes strategic intelligence:
- [x] `strategic_goals` - What we're building toward (Innovation Lab, dev past performance)
- [x] `capability_gaps` - Honest about weaknesses (limited dev PP, no cloud migration yet)
- [x] `growth_areas` - Where we want contracts to build muscle
- [x] `innovation_initiatives` - AI BD Team, Qori, Truebid, Innovation Lab
- [x] `risk_tolerance` - Willing to sub, take lower margins for strategic value

Agent-specific strategic reasoning:
- [x] Maya: Distinguishes "core fit" vs "strategic fit", flags capability builders
- [x] David: Honest about gaps, recommends teaming/subbing for stretch opportunities
- [x] Rosa: Identifies partners to fill gaps, looks for mentor-protégé opportunities
- [x] James: Weighs strategic value vs win probability, considers Innovation Lab alignment
- [x] Patricia: Tracks progress on strategic goals, different metrics for capability builders

### Memory System (Supabase Tables)
- [x] `user_context` - personal info about Lapedra/Tamara
- [x] `conversation_memory` - key moments to reference
- [x] `inside_jokes` - shared references that build over time
- [x] `decision_patterns` - go/no-go tendencies
- [x] `message_claims` - prevents multiple agents responding
- [x] `agent_memory` - response logging with sources/confidence
- [x] `seen_awards` - tracks reported awards (prevents duplicates)
- [x] `competitor_intel` - stored intel on competitors (protests, performance, wins)
- [x] `system_feedback` - tracks bugs, issues, suggestions for agent improvement
- [x] `agency_forecasts` - upcoming opportunities from agency forecast pages
- [x] `agent_memories` - persistent memory for emergent agent behavior (see below)

### Database Security (Row Level Security) ✓
All tables now have RLS enabled with service_role-only access:
- [x] All 24+ public tables have RLS enabled
- [x] Policies restrict access to `service_role` (backend only)
- [x] Fixed overly permissive policies (`USING (true)`) on `far_sections`, `cron_job_runs`
- [x] Views use `security_invoker = true` (caller's permissions, not creator's)
- [x] Functions have `search_path = public` to prevent path injection

**Migration**: `supabase/migrations/20260211_enable_rls_all_tables.sql`

**To verify RLS status**:
```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables WHERE schemaname = 'public';
```

### Notion Hub Integration ✓
Central command center for human oversight:
- [x] AI BD Team Hub page with 8 databases
- [x] Opportunities database with full pipeline tracking
- [x] Partners, Contacts, Past Performance databases
- [x] Forecasts database for agency procurement forecasts
- [x] Activity Log - tracks all agent actions
- [x] Feedback Log - tracks bugs, suggestions, improvements
- [x] Decisions database - Go/No-Go tracking with outcomes
- [x] Settings and Playbook pages
- [x] Bidirectional sync: Supabase ↔ Notion
- [x] Maya syncs new opportunities automatically
- [x] Decisions sync back from Notion to agents

### Product Documentation
Comprehensive docs for repeatable product deployment:
- [x] `docs/ARCHITECTURE.md` - System design, data flow, file structure
- [x] `docs/SETUP.md` - Step-by-step installation guide
- [x] `docs/CONFIGURATION.md` - Customization options
- [x] `docs/AGENTS.md` - Agent reference with examples
- [x] `docs/DATABASE.md` - Schema and table documentation
- [x] `docs/INTEGRATIONS.md` - External API reference
- [x] `docs/ONBOARDING.md` - Client setup process
- [x] `docs/COSTS.md` - Pricing and billing breakdown
- [x] `docs/ROADMAP.md` - What's built and what's next
- [x] `README.md` - Overview with links to all docs

---

## What's Next

### Priority 1: FAR Lookup Capability ✓
- [x] Clone/fetch GSA FAR repo: https://github.com/GSA/GSA-Acquisition-FAR
- [x] Parse XML files into chunks by section (part, subpart, section, title, full_text)
- [x] Create `far_sections` table in Supabase with pgvector for embeddings
- [x] Create `src/integrations/far-search.ts`:
  - Semantic search: "What does FAR say about past performance?"
  - Direct lookup: "FAR 15.304"
  - Returns sections with specific citations
- [x] David uses it: "Per FAR 15.305, they have to evaluate past performance..."
- [x] James uses it: "FAR 16.505 governs task order competitions..."
- [x] Keep citations specific: "FAR 9.505-2(b)(1)" not "the FAR says..."
- [x] Created `src/scripts/update-far.ts` to refresh FAR data when GSA publishes changes

### Recent Fixes (Feb 2026)

**David's Research Context** ✓
- [x] Fixed agency code→name mapping for USASpending API (was passing '036' instead of 'Department of Veterans Affairs')
- [x] Added `AGENCY_CODE_TO_NAME` mapping for 17 agencies
- [x] Added debug logging when contract searches return empty results
- [x] Expanded FPDS trigger keywords with conversational phrases ('current contractor', 'recompete', 'task order', 'prime', 'who holds', etc.)

**Patricia's Standup Behavior** ✓
- [x] Fixed multiple agent responses to standup - Patricia no longer @mentions agents (was triggering 4 pile-on responses)
- [x] Patricia's standup cron now loads memory context ("THINGS YOU REMEMBER")
- [x] Added Marcus to team roles in standup prompt

### Known Limitations
- FPDS keyword search can't find contract vehicles by name (e.g., "SPRUCE IDIQ") - needs contract number
- ~~News sources are general~~ - Now includes GovCon sources: OrangeSlices, GovConWire, WashTech, FCW, Nextgov
- ~~Thread replies with short answers may not always trigger agent responses~~ - Fixed: agents respond to follow-ups
- ~~Maya hallucinating fake URLs~~ - Fixed: strict validation + verification command
- Agency forecast HTML parsing is generic - may need agency-specific parsers for complex pages
- Jodie (Writer) temporarily disabled - Slack app needs Socket Mode enabled and proper scopes configured
- ~~Patricia's standup had no memory~~ - Fixed: now loads extracted facts from database
- ~~Agents ignored each other's announcements~~ - Fixed: team-wide fact sharing via `subject: 'team'`

---

### Priority 2: Company Data Integration ✓
- [x] Create comprehensive company knowledge base schema (11 tables)
  - `company_profile` - core company info, capabilities, certifications
  - `past_performance` - contract history with CPAR ratings
  - `contacts` - agency and industry contacts
  - `teaming_partners` - partner companies and relationships
  - `labor_rates` - labor categories and pricing
  - `case_studies` - detailed project case studies
  - `key_personnel` - team members and qualifications
  - `proposal_content` - reusable proposal language
  - `lessons_learned` - bid and project lessons
  - `documents` - embedded documents for semantic search (with pgvector)
- [x] Create `src/context/company-context.ts` for loading company data
  - Caches context for 30 minutes
  - Formats differently per agent role (Rosa gets partners, Patricia gets personnel, etc.)
  - Includes fit-checking utilities (NAICS match, set-aside match, no-bid criteria)
- [x] All agents load company context into their prompts
  - Maya checks NAICS and set-aside fit
  - David references past performance for agency research
  - Rosa knows existing teaming partners
  - James uses no-bid criteria for go/no-go
  - Patricia knows key personnel for staffing
- [x] Create website scraper (`npm run scrape-company`)
  - Scrapes case studies from /work pages
  - Scrapes team members from /about
  - Scrapes capabilities from homepage/services
  - Saves to Supabase tables
- [x] Create Patricia's onboarding flow (`npm run onboard`)
  - Interactive CLI for filling in profile gaps
  - Prioritizes high-value fields first
  - Parses natural language into structured data
- [x] Populated FFTC company data from website
  - Company profile: NAICS (541511, 541512, 541519), GSA MAS 47QTCA23D0076
  - Certifications: 8(a), WOSB, SDVOSB, state M/WBEs
  - CAGE: 8T0K1, UEI: RA62AG44CFZ8
  - 12 team members with roles and specialties
  - 10 case studies (VA, CMS, Maryland, agency work)
  - 4 news items as proposal content
  - Agency experience: VA, CMS, IRS, HHS, Maryland, NY State Parks
- [x] Notion integration (`npm run import-notion`)
  - Imports from Contracts Overview → past_performance (22 contracts)
  - Imports from CRM → teaming_partners (38 partners)
  - Imports from GSA MAS Rates → labor_rates (13 categories)
  - Infers agency from contract name, maps fields automatically
  - Supports incremental updates (won't duplicate on re-run)
- [x] Automated sync scheduler (`npm run sync:schedule`)
  - Syncs Notion data every 6 hours automatically
  - Logs syncs to `sync_log` table for auditing
  - Run `npm run sync` for one-time manual sync
  - Safe to run continuously in background

### Priority 3: Agent Memory System ✓
Persistent memory for emergent, autonomous agent behavior. Agents remember past experiences, form insights, and reference history in their decisions.

**Why this matters**: Without memory, each interaction is isolated. Agents can't learn from patterns, reference past outcomes, or develop institutional knowledge. This system enables agents to say "Based on past experience with HHS..." or "We've lost 3 similar bids this quarter—common theme: pricing."

**Team-Wide Fact Sharing** ✓
- [x] Facts with `subject: 'team'` are shared across ALL agents (e.g., "Marcus is offline")
- [x] Memory manager ALWAYS loads team announcements regardless of semantic search
- [x] Team updates shown first in agent prompts under "TEAM UPDATES (important - act on these)"
- [x] Fact extraction recognizes availability/status info and saves with `subject: 'team'`
- [x] Patricia's standup loads team facts from memory ("THINGS YOU REMEMBER")

**Database**: `agent_memories` table with RLS
- Memory types: `observation`, `reflection`, `insight`, `outcome`, `conversation`
- Links to opportunities via `related_opportunity_id`
- Importance scoring (1-10) for relevance ranking
- Tag-based querying for patterns
- Embedding support for semantic search

**Agent Integration**:
- [x] David stores observations after research (red/green flags, incumbent analysis)
- [x] James stores decisions and queries memories before deciding
- [x] Marcus stores tech assessments (compliance, blockers, fit)
- [x] Rosa stores relationship checks (teaming recommendations, partners)
- [x] Maya stores outcomes (win/loss/withdrawn with prediction accuracy)
- [x] Patricia stores pursuit scheduling observations

**Memory Retrieval**:
- [x] James queries relevant memories before go/no-go decisions
- [x] Retrieves insights from all agents + agency-specific observations
- [x] Includes memories in decision prompts for context

**Reflection System**:
- [x] Daily reflection cron (2am) synthesizes insights from observations
- [x] Generates patterns, insights, and recommendations per agent
- [x] Stores as `insight` and `reflection` memory types
- [x] Run manually: `npx tsx src/cron/memory-reflection.ts`

**Semantic Search**:
- [x] `searchMemoriesBySimilarity()` for natural language queries
- [x] `storeMemoryWithEmbedding()` for high-importance memories
- [x] Fallback search when RPC not available

**Files**:
- `src/memory/index.ts` - Core memory functions
- `src/memory/types.ts` - TypeScript types
- `src/cron/memory-reflection.ts` - Reflection job
- `supabase/migrations/20260223_agent_memories.sql` - Schema

**Future**:
- [ ] Auto-save personal context when Lapedra/Tamara share something
- [ ] Inside jokes get referenced naturally over time
- [x] Cross-agent memory sharing for team-level insights (via `subject: 'team'`)

### Priority 4: Proactive Check-ins ✓
- [x] Maya's automated SAM.gov scanner (`npm run maya:scan`)
  - Weekday scan at 8am (Mon-Fri only)
  - Posts opportunities 60+ score, immediate for 80+
  - Weekly summary on Mondays at 8:30am
  - Quiet morning message when nothing found
  - Personality variation: different openers based on score
  - Verification: "Maya, verify that opportunity" re-checks SAM.gov
  - Forecast matching: flags when SAM.gov opp matches a forecast
  - Run scheduled: `npm run maya:schedule`
- [x] Maya's forecast briefing (`npm run forecast:brief`)
  - Monday 8:15am forecast update
  - Lists high-relevance and medium-relevance upcoming opportunities
  - Tracks when forecasts hit SAM.gov
  - Run scheduled: `npm run forecast:schedule`
- [x] Patricia's team management (`npm run patricia:checkin`)
  - Morning check-in at 9am weekdays
  - Afternoon nudge check at 2pm for pending items
  - Tracks opportunities needing decisions
  - Feedback logging: "Patricia, bug: [issue]" saves to database
  - Weekly feedback summary on Mondays
  - Run scheduled: `npm run patricia:schedule`
- [x] Opportunity scoring system (`src/config/opportunity-filters.ts`)
  - 0-100 scoring based on NAICS, keywords, agency, set-aside, timeline
  - Comprehensive keyword lists for Design, Digital, Software, Strategy
  - Priority agencies and eligible set-asides
- [ ] David: "That opportunity we passed on got re-posted"
- [ ] Rosa: Proactive partner check-ins

### Priority 5: Realistic Availability
- [ ] Agents occasionally "away" (dentist, kid thing, heads down)
- [ ] Stagger responses more naturally
- [ ] "Sorry, just seeing this - was in a meeting"

### Priority 6: Full Opportunity Workflow ✓
- [x] Maya finds opp → posts to channel
- [x] David auto-researches incumbent, agency (FPDS, USASpending, news)
- [x] Rosa checks partner options
- [x] James synthesizes for go/no-go
- [x] Patricia tracks action items and summarizes for Lapedra
- [x] Full system test (`npm run full-system-test`)
  - 30-second delays between agents for realistic feel
  - Uses real company data from Supabase
  - Integrates all external APIs
- [ ] Store opportunity in Supabase, track through pipeline

### Priority 7: Refinements
- [ ] Better cross-agent references ("Like David said...")
- [ ] More natural thread ownership
- [ ] Occasional typos/self-corrections for realism
- [ ] Agent-to-agent banter without human prompt

---

## Tech Stack
- **Runtime**: Node.js 20 + TypeScript (tsx)
- **Hosting**: Railway (always-on, auto-deploy from GitHub)
- **Slack**: Bolt SDK with Socket Mode
- **AI**: Claude claude-sonnet-4-20250514 via Anthropic SDK
- **Database**: Supabase (PostgreSQL + pgvector)
- **APIs**: SAM.gov, FPDS, USASpending, SerpAPI, Notion

## Running the Agents
```bash
npm run live              # Start all 6 agents in Slack (Jodie currently disabled pending Slack app setup)
npm run full-system-test  # Run full BD team demo with real data

# Maya's Automated Scanner
npm run maya:scan         # One-time scan of SAM.gov
npm run maya:schedule     # Run on schedule (8am Mon-Fri, 8:30am Monday weekly)
npm run maya:weekly       # Weekly summary only

# Agency Forecast Scanner
npm run forecast:scan     # One-time scan of all agency forecasts
npm run forecast:brief    # Generate Maya's forecast briefing
npm run forecast:schedule # Weekly schedule (Sun 10pm scan, Mon 8:15am brief)

# Patricia's Team Management
npm run patricia:checkin  # Morning check-in
npm run patricia:nudge    # Check for pending items
npm run patricia:schedule # Run on schedule (9am/2pm weekdays)

# Notion Hub
npm run notion:setup <page-id>  # Create hub structure
npm run notion:sync             # One-time sync
npm run notion:watch            # Continuous sync (every 5 min)
npm run notion:check            # Check sync status
npm run notion:test             # Test with sample opportunity
```

## Deployment

### Railway (Production)
- **Repo**: `friends-innovation-lab/ai-bd-team`
- **Branch**: `main`
- **Auto-deploy**: Pushes to main trigger automatic deployment
- **Config files**: `railway.json`, `nixpacks.toml`

### Running Locally
```bash
npm run live              # Start all 5 agents
npm run start:prod        # Production mode (agents + schedulers)
```

## Environment Variables Required
```
SLACK_CHANNEL_ID
MAYA_BOT_TOKEN, MAYA_APP_TOKEN
DAVID_BOT_TOKEN, DAVID_APP_TOKEN
ROSA_BOT_TOKEN, ROSA_APP_TOKEN
JAMES_BOT_TOKEN, JAMES_APP_TOKEN
PATRICIA_BOT_TOKEN, PATRICIA_APP_TOKEN
JODIE_BOT_TOKEN, JODIE_APP_TOKEN
ANTHROPIC_API_KEY
SUPABASE_URL, SUPABASE_SERVICE_KEY
SAM_API_KEY
SERPAPI_KEY
NOTION_API_KEY
```
