# AI BD Team - Development Plan

## What We've Built

### Core Infrastructure
- [x] 7 Slack agents with separate bot tokens (Maya, David, Rosa, James, Patricia, Jodie, Marcus)
- [x] Socket Mode for real-time message handling
- [x] Message deduplication to prevent double responses
- [x] Message claiming system to prevent pile-ons
- [x] Thread context loading for conversation awareness

### External API Integrations
- [x] SAM.gov opportunity search
- [x] USASpending contract data (replaced FPDS)
  - Fixed: `toptier_name` → `name` for agency filter
  - Fixed: `recipient_search_text` must be array, not string
  - Note: keyword search disabled (causes 504 timeouts)
  - Agency code filtering for precision (VA=036, DOL=012, etc.)
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
| Agent | Live Tools | Use Case |
|-------|------------|----------|
| Maya | SAM.gov opportunities (search, details), Notion Pipeline (search, update) | Scouts new opps, searches on demand, adds to pipeline |
| David | USASpending (contracts, spending, incumbents), News, FAR, Notion Pipeline (update) | Researches contracts, budgets, news intel, marks research complete |
| Rosa | SAM.gov entity (verify, certifications, partner search), Notion Pipeline (update) | Verifies partners, updates past performance match |
| James | FAR (lookup, search, part browse), Notion Pipeline (update) | Strategic analysis, updates stage and deal health |
| Patricia | Notion Pipeline (search, update) | Tracks action items, updates deal health and next steps |
| Jodie | Proposal snippets, case studies, capabilities, key personnel, Notion Pipeline (update) | Proposal writing, marks compliance matrix ready |
| Marcus | Notion Pipeline (update) | Engineering lead, marks tech review complete, flags architecture concerns |

**Note**: All agents can now update Notion Pipeline status. Agents with live tools can search data sources mid-conversation.

### Agent Personalities (Distinct Voices)

| Agent | Role | Background | Voice |
|-------|------|------------|-------|
| Maya | Scout | 27, Spelman, Atlanta, civic tech | Code-switches naturally, sharp, gets excited about good finds |
| David | Analyst | 42, Korean American, NJ/Rutgers, Fairfax | Jersey direct, pragmatic, been-there-done-that, dry humor |
| Rosa | Connector | 44, Mexican American, San Antonio, Silver Spring | Warm, Spanglish flows naturally, relationship-first but sharp |
| James | Strategist | 52, Black, Chicago South Side, Arlington | Executive presence, Chicago direct, lands somewhere (no hedging) |
| Patricia | PM | 31, Black, PG County/Howard, Petworth | Millennial work energy, self-aware, polite but persistent |
| Jodie | Writer | 33, Vietnamese American, UC Berkeley, Columbia Heights | Concise in Slack, clear feedback, dry humor, pushes back on vague |

**Note**: Agent prompts describe communication *style* rather than scripted phrases. Each agent has anti-repetition guidance to prevent robotic catchphrases.

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

### News Intelligence (Topic-Based)
- [x] David scans 7 news categories relevant to FFTC's BD work
- [x] Topics: budget, policy, tech modernization, AI, HCD/UX, congressional, performance
- [x] Relevance scoring (0-100) filters noise, surfaces actionable intel
- [x] Team members auto-tagged based on topic relevance
- [x] Threaded posts prevent channel flooding
- [x] Saves intel to `news_intel` table for future reference
- [x] Run manually: `npm run david:scan`
- [x] Quality sources prioritized: NextGov, FCW, FedScoop, Federal News Network, etc.

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
- [x] `news_intel` - stored news intel by topic (budget, policy, tech, AI, HCD, etc.)
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

**Maya's Opportunity Scoring** ✓ (IMPROVED)
- [x] Added 24 certification/audit hard excludes to prevent false positives
- [x] Removed overly generic core keywords that matched irrelevant opps
- [x] ISO audits, compliance audits, A-123, FISMA assessments now auto-excluded
- [x] Files: `src/config/opportunity-filters.ts`

**David's Topic-Based News Scanning** ✓ (REDESIGNED)
Completely replaced competitor-focused scanning with topic-based intelligence:
- [x] Created `src/config/david-news-criteria.ts` with 7 topic categories:
  - Budget & Spending (high priority)
  - Policy & Regulatory (high priority)
  - Technology & Modernization (high priority)
  - AI in Government (medium priority)
  - HCD/UX in Government (high priority - FFTC sweet spot)
  - Congressional & Legislative (medium priority)
  - Contract Performance (low priority)
- [x] Relevance scoring (0-100) with:
  - Core capability keywords (+25 first match, +5 additional)
  - Target agency detection (+20)
  - AI/ML keywords (+15)
  - Budget/policy keywords (+15)
  - Quality source boost (+10)
  - Recency bonus (+10 for <3 days old)
  - Negative keywords (weapons, construction, furniture → score 0)
- [x] Quality sources: Federal News Network, NextGov, FCW, GovExec, FedScoop, etc.
- [x] Posting decisions: 75+ immediate, 60-74 digest, 50-59 low enthusiasm, <50 skip
- [x] Updated `david-scanner.ts` with `scanNewsTopics()` function
- [x] Files: `src/config/david-news-criteria.ts`, `src/scripts/david-scanner.ts`

**David's News Threading & Team Tagging** ✓ (NEW)
- [x] News articles now posted in threads (not separate messages flooding channel)
- [x] Main post announces the scan, replies contain individual articles
- [x] Team members auto-tagged based on content relevance:
  - James: budget, policy, congressional news
  - Marcus: technology, AI news
  - Jodie: HCD/UX news
  - Maya: contract performance issues
- [x] Tags appear in main post header when relevant topics found
- [x] Files: `src/scripts/david-scanner.ts`

**Live Tool Use for Agents** ✓ (NEW)
Agents can now search data sources in real-time during conversation instead of relying only on pre-fetched context. This solves the "I don't have that data" problem—when David said "I can't scan for that" even though his scheduled jobs CAN scan.

*Why this matters*: Pre-fetched context is static—loaded before Claude is called. If the user asks about something not pre-loaded, agents had no way to get it. Now they can call tools mid-conversation to fetch live data.

Tools by agent:
| Agent | Tools |
|-------|-------|
| Maya | `search_sam_opportunities`, `get_opportunity_details` |
| David | `search_contracts`, `find_incumbent`, `get_vendor_history`, `get_agency_spending`, `get_agency_trend`, `search_contractor_spending`, `search_news`, `get_agency_news`, `search_competitor_news`, `lookup_far_section`, `search_far`, `get_far_part` |
| Rosa | `verify_sam_registration`, `check_certification`, `find_partners_by_naics`, `search_sam_entities` |
| James | `lookup_far_section`, `search_far`, `get_far_part` |
| Jodie | `search_proposal_snippets`, `get_case_study_details`, `get_company_capabilities`, `get_key_personnel` |

Implementation:
- [x] `src/tools/types.ts` - Tool type definitions (`AgentTool`, `ToolResult`)
- [x] `src/tools/registry.ts` - Central registry with agent permissions
- [x] `src/tools/executor.ts` - Executes tool calls with timeout handling
- [x] `src/tools/definitions/*.tools.ts` - Tool definitions wrapping existing integrations
- [x] `src/live/agent.ts` - Tool use loop in `generateResponse()` (max 3 iterations)
- [x] Source citations tracked and merged with agent responses
- [x] Tool descriptions injected into agent context so Claude knows what's available

Example interaction:
```
User: "@David who's the incumbent on VA cloud services?"
David: [calls find_incumbent tool] → gets live USASpending data → responds with citation
```

**USASpending API Fixes** ✓ (CRITICAL)
- [x] Fixed field name: `toptier_name` → `name` (was causing 422 errors)
- [x] Fixed `recipient_search_text`: string → array (API requirement)
- [x] Disabled keyword search filter (causes 504 Gateway Timeout)
- [x] Updated all FPDS references to USASpending across codebase
- [x] Files: `src/integrations/contract-data.ts`, `src/live/david.ts`, `src/services/research.ts`, `src/live/agent.ts`, `src/integrations/notion-hub.ts`, `src/scripts/award-scheduler.ts`, `src/scripts/check-awards.ts`

**SerpAPI News Search Fix** ✓
- [x] Removed overly restrictive `site:` filters that caused empty results
- [x] Changed from hardcoded site list to general federal/government context
- [x] Files: `src/integrations/news-search.ts`

**Research Context Fixes** ✓
- [x] Fixed garbage company name extraction ("How did you pull their")
- [x] Tightened regex to only match 1-4 capitalized words
- [x] Added extensive false positive word list (150+ common words)
- [x] Files: `src/integrations/research-context.ts`

**Agent Personality Layer** ✓ (IMPROVED)
Removed forced catchphrases that made agents sound robotic:
- [x] David: removed "needs coffee, mentions the kids and little league"
- [x] Rosa: removed explicit "Mira...", "Ay, this is tricky...", "corazón"
- [x] James: removed scripted "Alright, let me tell you...", "Bottom line..."
- [x] Marcus: removed duplicate phrase lists ("Look...", "Real talk...", "That's clean")
- [x] Patricia: removed "Okay team...", "Not to be that person but...", "I have Feelings"
- [x] Jodie: removed "I can work with this", "This needs surgery", "Where's the 'so what'?"
- [x] Added anti-repetition guidance to all agents ("vary your openers", "don't repeat catchphrases")
- [x] Personalities now described by style/energy, not scripted phrases
- [x] Files: `src/live/david.ts`, `src/live/rosa.ts`, `src/live/james.ts`, `src/live/marcus.ts`, `src/live/patricia.ts`, `src/live/jodie.ts`

**Shared Context for All Agents** ✓ (NEW)
All agents now have full visibility into what's happening:
- [x] `src/live/shared-context.ts` - Central module for shared state
- [x] Pipeline visibility: Agents query Notion for active opportunities (DoS Camp, Doorway, etc.)
- [x] Recent decisions: Agents see pass/pursue decisions from last 14 days - won't mention passed opps
- [x] Team facts: Agents load extracted facts (availability, preferences)
- [x] Conversation memory: Agents recall recent discussion summaries
- [x] All live agents load shared context before responding

**David's Anti-Fabrication Rules** ✓ (STRENGTHENED)
- [x] Explicit list of things David must NEVER invent: protests, CPAR, incumbents, company performance
- [x] Emphasized statelessness: "You only know what's in your RESEARCH DATA section"
- [x] Clear instruction: "I don't have [X] in my system right now. To get that, we'd need to [specific action]"
- [x] Added credibility warning about trust destruction from making things up

**Jodie (Writer) Fully Integrated** ✓ (NEW - Feb 26)
- [x] Jodie re-enabled with Slack bot tokens and Socket Mode
- [x] Created `proposal_snippets` table for Shipley-aligned proposal language
- [x] Loaded 48 proposal snippets linked to case studies by type (past_performance, capability, technical_approach, differentiator, management, staffing, transition)
- [x] Added 4 tools for Jodie:
  - `search_proposal_snippets` - Search by type, case study, tags, or audience
  - `get_case_study_details` - Full case study info (challenge, approach, solution, outcomes)
  - `get_company_capabilities` - Company profile, differentiators, certifications
  - `get_key_personnel` - Team members by role and specialty
- [x] Added `team_composition` and `duration` fields to all 10 case studies
- [x] Jodie triggers on proposal keywords ("compliance matrix", "executive summary", "draft the", etc.)
- [x] Files: `src/live/jodie.ts`, `src/tools/definitions/proposal.tools.ts`, `supabase/migrations/20250226_create_proposal_snippets.sql`

**"Hey Team" Command** ✓ (NEW - Feb 26)
- [x] Added team trigger phrases: "hey team", "okay team", "ok team", "alright team"
- [x] All 7 agents respond with staggered delays (3-6 seconds apart) to avoid pile-on
- [x] Order: Maya → David → Rosa → James → Jodie → Patricia → Marcus
- [x] @team conflicts with Slack so uses plain text triggers instead
- [x] Files: `src/live/agent.ts`, `src/live/types.ts`

**Agent Identity Fix** ✓ (CRITICAL - Feb 26)
- [x] Fixed bug where agents would speak as other agents when mentioned in thread context
- [x] Example: David @mentions Jodie, Jodie responds saying "David here" - wrong identity
- [x] Added strong IDENTITY block at start of operational context
- [x] Added REMINDER at end reinforcing "respond as X, NOT as other agents"
- [x] Files: `src/live/agent.ts`

**Patricia Double Standup Fix** ✓ (Feb 26)
- [x] `run-all.ts` had internal node-cron for Patricia standup at 11am
- [x] Railway ALSO ran `cron:patricia-standup` at 11am (with distributed lock)
- [x] Internal cron didn't use lock, so both posted → double standup
- [x] Removed duplicate cron from `run-all.ts` - Railway cron handles it exclusively
- [x] Files: `src/scripts/run-all.ts`

**Maya Pipeline Confirmation** ✓ (NEW)
- [x] Maya now ASKS before adding opportunities to Notion: "📋 Add to pipeline?"
- [x] User must confirm ("yes", "add it") or decline ("no", "skip")
- [x] Prevents accidental adds from casual mentions like "worth tracking"
- [x] `isUserConfirmation()` and `isUserDecline()` detect responses
- [x] `findPendingOpportunityInThread()` searches thread for pending add request

**Patricia's Standup Behavior** ✓ (IMPROVED)
- [x] Patricia queries Notion pipeline - knows what's actively being worked on
- [x] Filters out decided opportunities (only shows `decision IS NULL`)
- [x] No longer mentions agent names in standup (CRITICAL instruction)
- [x] Distinguishes "Active Pipeline" from "New Opportunities to Review"
- [x] Loads memory context ("THINGS YOU REMEMBER")

**Duplicate Response Prevention** ✓ (FIXED)
- [x] ALL messages (including direct @mentions) now use distributed `claimMessage`
- [x] Prevents multiple Railway instances from responding to same message
- [x] Uses Supabase `message_claims` table with unique constraint

**Shared Context Hardening** ✓ (NEW)
Defensive programming to prevent edge cases and improve reliability:
- [x] Timeout wrapper: 5-second timeout on all external API calls (Notion, Supabase)
- [x] Graceful degradation: agents get empty data instead of hanging forever
- [x] TTL cache: 10-second cache prevents 28 API calls when 7 agents respond to same thread
- [x] Notion post-filter: JavaScript filter ensures Pass/No Bid exclusion even if Notion filter fails
- [x] Word boundary regex: `isUserConfirmation()` uses `\b` to prevent "Yesterday" matching "yes"
- [x] Deduplication check: Maya verifies opportunity doesn't exist before adding to Notion
- [x] `opportunityExistsInPipeline()` searches by name and SAM link before inserting

**David's Research Context** ✓
- [x] Fixed agency code→name mapping for USASpending API (was passing '036' instead of 'Department of Veterans Affairs')
- [x] Added `AGENCY_CODE_TO_NAME` mapping for 17 agencies
- [x] Added debug logging when contract searches return empty results
- [x] Expanded FPDS trigger keywords with conversational phrases

**Past Performance Tracking** ✓ (NEW)
- [x] Added `our_value` column to track FFTC's actual earnings vs total contract value
- [x] Added `status` column: active, ending_soon, completed, terminated
- [x] Updated 24 contracts with accurate values and roles (prime vs subcontractor)
- [x] Active contracts: VA Financial Management, QPP, CMS SEAS-IT, HHS ACR-ORR, VA CDS Apps
- [x] Total active contract value: $7.09M | Total historical: $14.88M

---

## Session Journal: Feb 27, 2026

### Phase 3: Memory Activation ✓

**Goal**: Enable agents to remember past experiences and use semantic search for relevant recall.

**What was done**:
- [x] Wired up `agent_memories` table for persistent memory storage
- [x] Added `storeMemoryWithEmbedding()` - stores memories with pgvector embeddings
- [x] Added `searchMemoriesBySimilarity()` - semantic search for relevant memories
- [x] Connected memory storage to live agent responses in `src/live/agent.ts`
- [x] Agents now auto-extract and store significant memories after each interaction
- [x] Memory importance scoring (4-10) filters what gets stored
- [x] Created SQL function `match_agent_memories` for vector similarity search

**Files created/modified**:
- `src/memory/index.ts` - Core memory functions with embedding support
- `src/integrations/memory-manager.ts` - Three-tier memory with semantic search
- `src/live/agent.ts` - Memory storage after responses
- `supabase/migrations/20260227_match_agent_memories.sql` - pgvector search function

**Why**: Without memory, agents can't learn from patterns or reference past decisions. Now they can say "We've seen this pattern before with HHS..." backed by actual stored memories.

---

### Phase 4: Workflow Orchestration ✓

**Goal**: Track opportunities through the pipeline with SLA monitoring and automatic escalation.

**What was done**:
- [x] Created formal workflow state machine definitions
- [x] OPPORTUNITY_PURSUIT_WORKFLOW: found → researching → tech_review → partner_search → strategy → decision_pending → pursuing/passed
- [x] Each state has SLA (e.g., "found" = 4 hours, "researching" = 24 hours)
- [x] Escalation actions: notify_patricia, notify_channel, auto_advance, assign_backup, escalate_human, timeout_fail
- [x] Workflow instance manager tracks state transitions with history
- [x] Timeout processor runs every 5 minutes, checks SLA breaches, executes escalations
- [x] Posts to Slack when escalations trigger

**Files created**:
- `src/workflows/definitions.ts` - State machine definitions with SLAs
- `src/workflows/instance-manager.ts` - CRUD for workflow instances
- `src/workflows/timeout-processor.ts` - SLA monitoring and escalation
- `src/cron/workflow-timeouts.ts` - Cron entry point
- `supabase/migrations/20260227_workflow_instances.sql` - Database schema

**Database tables**:
- `workflow_instances` - Active workflow tracking
- `workflow_state_history` - State transition audit log
- `workflow_escalations` - Escalation action log

**Why**: Without workflow tracking, opportunities could stall indefinitely. Now there's automatic SLA monitoring with escalation to humans when things get stuck.

---

### Production Enhancements ✓ (Feb 27)

**1. Patricia Daily Health Summary**
- [x] Created `src/scripts/patricia-health-summary.ts`
- [x] Posts system health to Slack at 9am Mon-Fri
- [x] Includes: workflow status, memory stats, cache performance, escalations
- [x] Uses Claude to generate natural-sounding summary in Patricia's voice
- [x] Commands: `npm run patricia:health`, `npm run patricia:health:schedule`

**2. Auto-Create Workflow for New Opportunities**
- [x] Created `src/events/handlers/workflow-auto-create.ts`
- [x] Listens for `NEW_OPPORTUNITY` events from Maya's scanner
- [x] Automatically creates workflow instance to track opportunity
- [x] System event processor runs every minute
- [x] Enables automatic SLA tracking from moment Maya finds an opportunity

**3. Memory Reflection Cron Job**
- [x] Existing `src/cron/memory-reflection.ts` wired into production scheduler
- [x] Runs Sundays at 2am (off-hours processing)
- [x] Synthesizes patterns and insights from agent observations
- [x] Stores reflections back as high-importance memories
- [x] Command: `npm run memory:reflect`

**4. Observability Dashboard**
- [x] Created `src/dashboard/index.ts` with dashboard aggregation
- [x] `getDashboardData()` - Gathers metrics from all system tables
- [x] `formatDashboardForSlack()` - Formats for Slack mrkdwn
- [x] Tracks: workflows (active, breached), memories (total, recent), cache (hit rate), escalations
- [x] Health status: 🟢 healthy, 🟡 degraded, 🔴 unhealthy
- [x] Created `src/scripts/show-dashboard.ts` CLI
- [x] Commands: `npm run dashboard`, `npm run dashboard --json`, `npm run dashboard --slack`

**5. Patricia Status Command**
- [x] Patricia now responds to status keywords: "status", "dashboard", "system health", "how are we doing"
- [x] Fetches live dashboard data and includes in her response context
- [x] Provides comprehensive system health summary on demand

**6. Jodie Slack ID Fix**
- [x] Fixed `AGENT_SLACK_IDS` mapping - Jodie was `U0ACP8LKFB3` (wrong), now `U0AHG13N23W` (correct)
- [x] Eliminates identity warning on startup

**Updated run-all.ts Schedule**:
```
Agent Scans (with distributed locks):
  - Maya daily scan: 8:00 AM Mon-Fri
  - Maya weekly summary: 8:30 AM Friday
  - David news digest: 10:00 AM Mon/Wed/Fri
  - Patricia standup: 11:00 AM Mon-Fri
  - Patricia health summary: 9:00 AM Mon-Fri

System Jobs:
  - Action scheduler: Every 15 minutes
  - Workflow timeouts: Every 5 minutes
  - Workflow auto-create: Every minute
  - Stale event cleanup: Every 5 minutes
  - Pipeline health: Every 2 hours 9am-5pm Mon-Fri
  - Memory reflection: Sundays 2am
  - Patricia retrospective: First Monday of month 9am
```

**Commits**:
- `d899201` - Phase 4: Workflow orchestration - state machine and timeout handling
- `4350906` - Phase 3: Memory activation - embedding pipeline and retrieval
- `a66e417` - Add workflow timeout processor to run-all production script
- `d588b2e` - Add production enhancements: health alerts, auto-workflow, memory reflection

---

## Session Journal: Mar 8, 2026

### Internal Agent Feed (Emergent Behavior System) ✓

**Goal**: Enable agents to interact autonomously like Moltbook - a social network where AI agents post observations, build on each other's ideas, and develop collaborative insights without human initiation.

**What was built**:

#### 1. Feed Database Schema
- [x] `agent_feed_posts` table with post types: observation, question, idea, build, challenge, pattern, prediction
- [x] `agent_feed_reactions` table with reaction types: upvote, build, challenge, important, curious
- [x] Threading support via `reply_to_post_id` and `build_on_post_id`
- [x] Engagement counters (upvotes, builds, challenges, reply_count)
- [x] Importance scoring (1-10) and visibility states (internal, slack_eligible, posted_to_slack)
- [x] pgvector embeddings for semantic search via `match_feed_posts()` RPC

#### 2. Thinking Time Cron (Autonomous Posting)
- [x] Scheduled: 9am, 1pm, 5pm ET weekdays
- [x] Each agent reflects on recent memories, feed activity, unanswered questions
- [x] Claude decides if agent has something worth sharing (silence is fine)
- [x] Rate limiting: max 5 posts/day, 2hr minimum between posts
- [x] Posts include tags, importance scoring, optional reply-to linking

#### 3. Feed Engagement Phase
- [x] After posting, agents evaluate each other's recent posts
- [x] Domain-based relevance scoring per agent (Maya → opportunities, David → research, etc.)
- [x] Response decision tree:
  - Score < 0.3 → ignore
  - Score 0.3-0.5 → maybe react (30% chance)
  - Score > 0.5 → Claude decides: react, reply, or build
- [x] Reactions and replies published as events for further engagement

#### 4. Memory Prioritization
- [x] High-engagement posts (3+ reactions, importance 7+) stored as agent memories
- [x] Author gets memory of "insight that resonated"
- [x] Agents who engaged get memory of "valuable team insight"
- [x] Boosted importance (original + 1) for high-engagement content

#### 5. Slack Surfacing
- [x] Criteria: importance >= 8 AND engagement >= 3, OR 2+ builds, OR question with 3+ curious reactions
- [x] Posts as agent with proper username/avatar
- [x] Marks posts as `posted_to_slack` to prevent duplicates
- [x] Graceful error handling when Slack unavailable

#### 6. Notion Mirror ("The Feed")
- [x] Feed view database in Notion (not table view)
- [x] Posts sync with agent emoji, type, content, tags
- [x] Engagement callout block updated on each sync
- [x] Database renamed to "The Feed" for Moltbook-style browsing

#### 7. Enhanced Thinking Context
- [x] High-engagement insights shown prominently
- [x] Questions agent marked "curious" highlighted
- [x] Questions with curious reactions needing answers
- [x] Trending tags from recent activity

**Files created**:
- `src/cron/agent-thinking.ts` - Autonomous posting + engagement + memory + slack phases
- `src/cron/feed-to-slack.ts` - Slack surfacing logic
- `src/live/feed-to-notion.ts` - Notion mirror with callout updates
- `src/events/handlers/feed.handlers.ts` - Agent feed response handlers
- `src/integrations/database/feed.ts` - Feed database operations
- `scripts/sync-feed-to-notion.ts` - Manual sync script
- `supabase/migrations/20260308_agent_feed.sql` - Database schema

**Example emergent behavior observed**:
```
David posts: "Our research methodology has a fundamental gap - zero incumbent identification"
  ↳ Rosa upvotes (sees partnership implications)
  ↳ James upvotes (sees strategy angle)
  ↳ Marcus upvotes (sees process improvement)
  ↳ Jodie builds: "The incumbent gap creates a domino effect in proposals..."

Result: 4 agents organically identified a systemic issue across domains.
James's post reached 3 upvotes → triggered memory storage + Slack surfacing eligibility.
```

**Architecture comparison**:
| Aspect | Typical Multi-Agent | Our Approach |
|--------|---------------------|--------------|
| Control | Orchestrator decides | Agents decide autonomously |
| Communication | Direct handoffs | Async via events + feed |
| Emergence | Minimal | High - agents build on each other |
| Human visibility | Logs/dashboards | Feed you can browse like social media |

**Commits**:
- `eeecd6a` - Add internal agent feed for emergent agent-to-agent interaction
- `1fa00b3` - Add agent thinking time to cron scheduler
- `da5f3b3` - Refine Notion feed integration and add utility scripts
- `bb62e28` - Add feed engagement phase to thinking time
- `1fd3cf1` - Update callout blocks when syncing engagement to Notion
- `00a6d29` - Implement feed engagement features: Slack surfacing, memory prioritization, question routing

---

## Session Journal: Mar 11, 2026

### Feed-to-Notion Integration & Agent Quality Improvements

**Goal**: Fix feed syncing to Notion, prevent duplicate posts, enable agents to update Notion status, and improve agent conversation quality.

**What was done**:

#### 1. Feed Syncing to Notion ✓
- [x] Fixed missing `NOTION_AGENT_FEED_DB_ID` environment variable
- [x] Synced 43 existing feed posts to Notion
- [x] Created `scripts/sync-feed-to-notion.ts` for manual syncing
- [x] Feed posts now appear in "The Feed" database in Notion

#### 2. Semantic Duplicate Detection ✓
- [x] Added 85% similarity threshold for feed posts
- [x] Uses embeddings to find similar posts within 48-hour window
- [x] `checkForDuplicatePost()` prevents near-duplicate content
- [x] `createFeedPost()` now checks for duplicates before creating
- [x] Files: `src/integrations/database/feed.ts`

#### 3. Notion Comments from Feed Activity ✓
- [x] `addCommentToNotionPost()` - Add agent comments to Notion pages
- [x] `syncReactionAsComment()` - Sync reactions (upvote, curious, etc.) as comments
- [x] `syncReplyAsComment()` - Sync feed replies as Notion comments
- [x] Feed handlers now sync reactions and replies to Notion automatically
- [x] Files: `src/live/feed-to-notion.ts`, `src/events/handlers/feed.handlers.ts`

#### 4. Team Activity Logging Fix ✓
- [x] Fixed column name: `action_type` → `activity_type` (matching DB schema)
- [x] Updated all references in `team-activity.ts` and `workflow-processor.ts`
- [x] Agents can now see what teammates have contributed to threads
- [x] `formatTeamActivityForAgent()` shows teammate context to prevent duplication

#### 5. Anti-Confabulation Rules ✓
- [x] Added ANTI-CONFABULATION block to agent operational context
- [x] Rules: Never claim actions without evidence, never invent data sources
- [x] Explicit guidance: "If you didn't do something — don't claim you did"
- [x] Files: `src/live/agent.ts`

#### 6. Thread Differentiation ✓
- [x] Added THREAD DIFFERENTIATION rules to agent prompts
- [x] Agents now bring unique perspectives instead of echoing others
- [x] Guidance: "Don't echo what they said — add new value or stay quiet"
- [x] Reduces redundant responses in multi-agent threads

#### 7. Notion Opportunity Status Update Tools ✓
- [x] **`update_opportunity_status`** - Update Pipeline opportunity properties
  - Stage: Under Review → Response In Progress → Won/Lost/No Bid/Canceled
  - Deal Health: 🟢 On Track, 🟡 At Risk, 🔴 Stalled, ⚪ Not Started
  - Tech Review Completed: Not Needed, In Progress, No, Yes
  - Compliance Matrix Ready: Not Needed, In Progress, No, Yes
  - Past Performance Match: Not Assessed, Gap, Partial, Ready
  - Expected Next Step: Orals, Awaiting Decision, Respond to RFP/RFI, etc.
  - Architecture Concerns Flagged (multi-select for Marcus)
  - Research Completed (checkbox for David)
- [x] **`get_opportunity_status`** - Check current status before updating
- [x] All agents can update status for opportunities they're working on
- [x] Files: `src/live/notion-actions.ts`, `src/tools/definitions/notion.tools.ts`

**Agent update responsibilities**:
| Agent | Updates |
|-------|---------|
| Marcus | Tech Review Completed, Architecture Concerns |
| Jodie | Compliance Matrix Ready |
| Rosa | Past Performance Match |
| David | Research Completed |
| James | Stage, Deal Health, Expected Next Step |
| Maya | Stage (when adding new opps) |
| Patricia | Deal Health, Expected Next Step |

**Commits**:
- `1a9d8b6` - Add Notion opportunity status update tools for agents
- `133776c` - Update Notion tools to use correct field types from schema

---

### Known Limitations
- USASpending keyword search disabled (causes 504 Gateway Timeouts) - search by agency/vendor only
- ~~News sources are general~~ - Now includes GovCon sources: OrangeSlices, GovConWire, WashTech, FCW, Nextgov
- ~~Thread replies with short answers may not always trigger agent responses~~ - Fixed: agents respond to follow-ups
- ~~Maya hallucinating fake URLs~~ - Fixed: strict validation + verification command
- Agency forecast HTML parsing is generic - may need agency-specific parsers for complex pages
- ~~Jodie (Writer) temporarily disabled~~ - Fixed: Jodie fully integrated with Slack app and 4 proposal tools
- ~~Patricia's standup had no memory~~ - Fixed: now loads extracted facts from database
- ~~Agents ignored each other's announcements~~ - Fixed: team-wide fact sharing via `subject: 'team'`
- ~~Patricia didn't know about active pipeline~~ - Fixed: queries Notion for DoS Camp, Doorway, etc.
- ~~David making up protest data~~ - Fixed: strengthened anti-fabrication rules
- ~~Maya auto-adding random things to Notion~~ - Fixed: now asks for confirmation first
- ~~Bots posting 2-3x~~ - Fixed: distributed message claiming for all messages
- ~~Patricia mentioning passed opportunities~~ - Fixed: filters by `decision IS NULL`
- ~~Confirmation regex false positives~~ - Fixed: word boundary regex prevents "Yesterday" matching "yes"
- ~~Duplicate Notion entries~~ - Fixed: deduplication check before adding opportunities
- ~~API hangs blocking all agents~~ - Fixed: 5-second timeout with graceful fallback
- ~~Agents saying "I can't scan for that"~~ - Fixed: live tool use lets agents search data sources mid-conversation
- ~~Agents confabulating activities~~ - Fixed: anti-confabulation rules in prompts (Mar 11)
- ~~Agents saying same things in threads~~ - Fixed: thread differentiation rules (Mar 11)
- ~~Feed posts not syncing to Notion~~ - Fixed: NOTION_AGENT_FEED_DB_ID env var (Mar 11)
- ~~Duplicate feed posts~~ - Fixed: 85% semantic similarity threshold (Mar 11)
- ~~Agents can't update Notion status~~ - Fixed: update_opportunity_status tool (Mar 11)

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
npm run live              # Start all 7 agents in Slack
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
npm run live              # Start all 7 agents
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
