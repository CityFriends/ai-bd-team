# AI BD Team - System Audit

*Last Updated: February 2026*

This document provides a comprehensive audit of everything built in the AI BD Team system. Each item is marked as BUILT, PARTIAL, or PLANNED.

---

## Executive Summary

The AI BD Team is a production-grade multi-agent AI system that simulates a government contracting Business Development team. Seven specialized AI agents with distinct personalities collaborate in Slack to find, research, and evaluate federal opportunities using real government data APIs.

**Technology Stack:**
- Runtime: Node.js 20 + TypeScript
- AI: Anthropic Claude (claude-sonnet-4-20250514)
- Database: Supabase (PostgreSQL + pgvector)
- Messaging: Slack Bolt SDK (Socket Mode)
- Deployment: Railway (always-on)

**Codebase Size:** ~10,400 lines of TypeScript across 30+ integration modules

---

## 1. Agents Inventory

### Live Agents (6/7 Operational)

| Agent | Role | Status | File Location |
|-------|------|--------|---------------|
| Maya | Scout - Opportunity hunter | **BUILT** | `src/live/maya.ts` |
| David | Analyst - Deep research & intel | **BUILT** | `src/live/david.ts` |
| Rosa | Connector - Teaming & partners | **BUILT** | `src/live/rosa.ts` |
| James | Strategist - Capture & decisions | **BUILT** | `src/live/james.ts` |
| Patricia | PM - Pipeline & deadlines | **BUILT** | `src/live/patricia.ts` |
| Marcus | Engineering Lead - Tech review | **BUILT** | `src/live/marcus.ts` |
| Jodie | Writer - Proposal content | **PARTIAL** | `src/live/jodie.ts` |

### Agent Capabilities Matrix

| Agent | SAM.gov | FPDS | News | FAR | GitHub | Slack DM | Scheduled Jobs |
|-------|---------|------|------|-----|--------|----------|----------------|
| Maya | Read | - | Read | - | - | - | Daily scan, Weekly summary |
| David | - | Read | Read | Read | - | - | News digest (MWF) |
| Rosa | Entity verify | - | Read | - | - | - | - |
| James | - | Read | - | Read | - | - | - |
| Patricia | - | - | - | - | - | - | Standup (11am), Nudge (2pm) |
| Marcus | - | - | - | - | Read | - | - |
| Jodie | - | - | - | - | - | - | (Disabled) |

---

## 2. Database Tables (30+ Tables)

### Core Operations Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `opportunities` | SAM.gov opportunities with fit scores | **BUILT** |
| `agencies` | Agency research and intel | **BUILT** |
| `companies` | Teaming partner database | **BUILT** |
| `outreach` | Email drafts and approvals | **BUILT** |
| `conversation_threads` | Slack thread tracking | **BUILT** |
| `agent_queue` | Task scheduling | **BUILT** |
| `agent_memory` | Response logging | **BUILT** |
| `message_claims` | Prevents duplicate responses | **BUILT** |
| `research_cache` | API response caching | **BUILT** |

### Memory & Context Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `user_context` | Personal info about Lapedra/Tamara | **BUILT** |
| `decision_patterns` | Go/no-go patterns | **BUILT** |
| `conversation_memory` | Key moments | **BUILT** |
| `inside_jokes` | Team references | **BUILT** |
| `agent_availability` | Agent schedules | **BUILT** |

### Company Knowledge Base - BUILT (11 tables)

| Table | Purpose | Status |
|-------|---------|--------|
| `company_profile` | Core company info, certifications | **BUILT** |
| `past_performance` | Contract history with CPAR | **BUILT** |
| `teaming_partners` | Partner relationships | **BUILT** |
| `labor_rates` | Pricing by category | **BUILT** |
| `case_studies` | Project case studies (pgvector) | **BUILT** |
| `key_personnel` | Team qualifications | **BUILT** |
| `proposal_content` | Reusable language | **BUILT** |
| `lessons_learned` | Bid/project lessons | **BUILT** |
| `documents` | Embedded docs (pgvector) | **BUILT** |
| `contacts` | Agency/industry contacts | **BUILT** |

### Intelligence Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `competitor_intel` | Competitive intelligence | **BUILT** |
| `seen_awards` | Award deduplication | **BUILT** |
| `seen_ebuy_opportunities` | GSA eBuy tracking | **BUILT** |
| `agency_forecasts` | 12-agency forecasts | **BUILT** |
| `far_sections` | FAR with pgvector | **BUILT** |

### Event System Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `agent_events` | Event bus scratchpad | **BUILT** |
| `agent_subscriptions` | Event routing | **BUILT** |
| `agent_event_metrics` | Performance tracking | **BUILT** |

### Playbook Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `team_playbook` | Self-discovered rules | **BUILT** |
| `playbook_applications` | Rule usage tracking | **BUILT** |
| `retrospective_runs` | Monthly analysis | **BUILT** |

### System Tables - BUILT

| Table | Purpose | Status |
|-------|---------|--------|
| `system_feedback` | Bug/improvement tracking | **BUILT** |
| `sync_log` | Notion sync audit | **BUILT** |
| `cron_job_runs` | Job execution tracking | **BUILT** |

---

## 3. API Integrations (12 External APIs)

### Government APIs - BUILT

| API | Status | File | Used By |
|-----|--------|------|---------|
| SAM.gov Opportunities | **BUILT** | `src/integrations/sam-gov.ts` | Maya |
| SAM.gov Entity Verification | **BUILT** | `src/integrations/sam-entity.ts` | Rosa |
| USASpending | **BUILT** | `src/integrations/usaspending.ts` | David |
| FPDS (via USASpending) | **BUILT** | `src/integrations/contract-data.ts` | David |

### Intelligence APIs - BUILT

| API | Status | File | Used By |
|-----|--------|------|---------|
| SerpAPI (News) | **BUILT** | `src/integrations/news-search.ts` | David, Maya |
| FAR Search (pgvector) | **BUILT** | `src/integrations/far-search.ts` | David, James |
| GitHub (@octokit) | **BUILT** | `src/integrations/github.ts` | Marcus |

### Platform Integrations - BUILT

| API | Status | File | Purpose |
|-----|--------|------|---------|
| Slack (Bolt SDK) | **BUILT** | `src/integrations/slack.ts` | All agents |
| Anthropic Claude | **BUILT** | `src/integrations/claude.ts` | Response generation |
| Supabase | **BUILT** | `src/integrations/supabase.ts` | Database |
| Notion | **BUILT** | `src/integrations/notion-hub.ts` | Human oversight |

### Specialized Integrations - BUILT

| Integration | Status | File | Purpose |
|-------------|--------|------|---------|
| Agency Forecasts | **BUILT** | `src/integrations/agency-forecasts.ts` | 12 agency scraping |
| Award Monitor | **BUILT** | `src/integrations/award-monitor.ts` | New award detection |

---

## 4. Event System - BUILT

### Event Types (20+)

```
Opportunity Lifecycle:
- NEW_OPPORTUNITY
- OPPORTUNITY_UPDATED

Research Chain:
- RESEARCH_COMPLETE
- TECH_ASSESSMENT_COMPLETE
- RELATIONSHIP_CHECK_COMPLETE

Strategy:
- GO_NO_GO_DECISION
- PURSUIT_SCHEDULED
- PURSUIT_DECISION_FEEDBACK

Autonomous:
- DEADLINE_WARNING
- PIPELINE_HEALTH_CHECK
- SYSTEM_HEALTH_CHECK
- RISK_ALERT
- OUTCOME_RECORDED
```

### Event Flow

```
Maya (NEW_OPPORTUNITY)
  └─> David (research)
        └─> RESEARCH_COMPLETE
              ├─> Marcus (tech assessment)
              ├─> Rosa (teaming check)
              └─> James (waits for both)
                    └─> GO_NO_GO_DECISION
                          └─> Patricia (pursuit tracking)
```

### Event System Files

| File | Purpose | Status |
|------|---------|--------|
| `src/events/eventTypes.ts` | Event definitions | **BUILT** |
| `src/events/eventBus.ts` | Publish/subscribe | **BUILT** |
| `src/events/eventProcessor.ts` | Event routing | **BUILT** |
| `src/events/handlers/*.ts` | Agent handlers | **BUILT** |

---

## 5. Scheduled Jobs

### Production Schedule (Railway)

| Job | Schedule | Agent | Status |
|-----|----------|-------|--------|
| SAM.gov scan | 8am Mon-Fri | Maya | **BUILT** |
| Weekly summary | 8:30am Monday | Maya | **BUILT** |
| Morning standup | 11am Mon-Fri | Patricia | **BUILT** |
| Pending nudge | 2pm Mon-Fri | Patricia | **BUILT** |
| News digest | 8am MWF | David | **BUILT** |
| Award monitor | 9am Mon/Thu | Maya | **BUILT** |
| Forecast scan | Sunday 10pm | System | **BUILT** |
| Forecast brief | Monday 8:15am | Maya | **BUILT** |
| Notion sync | Every 6 hours | System | **BUILT** |

---

## 6. Notion Hub Integration - BUILT

### 8 Synchronized Databases

| Database | Purpose | Sync Direction |
|----------|---------|----------------|
| Opportunities | Full pipeline | Bidirectional |
| Partners | Teaming partners | Bidirectional |
| Contacts | Agency/industry | Supabase → Notion |
| Past Performance | Contract history | Notion → Supabase |
| Forecasts | Agency forecasts | Supabase → Notion |
| Activity Log | Agent actions | Supabase → Notion |
| Feedback Log | Bugs/suggestions | Supabase → Notion |
| Decisions | Go/No-Go tracking | Bidirectional |

---

## 7. Self-Organizing Playbook - BUILT

### Playbook System

| Component | Purpose | Status |
|-----------|---------|--------|
| Rule discovery | Agents propose rules from patterns | **BUILT** |
| Rule adoption | Human approval workflow | **BUILT** |
| Rule application | James consults before decisions | **BUILT** |
| Rule health | Auto-retire underperforming rules | **BUILT** |
| Monthly retrospective | Patricia analyzes outcomes | **BUILT** |

### Rule Types

- `process_rule` - How to handle situations
- `threshold` - Numeric criteria (e.g., "Don't bid < $500K")
- `preference` - User preferences
- `sop` - Standard operating procedures
- `lesson_learned` - What we learned from wins/losses

---

## 8. What's NOT Built (Planned Features)

### Near-Term Planned

| Feature | Description | Status |
|---------|-------------|--------|
| Jodie full deployment | Writer agent Slack app | **PARTIAL** |
| Auto-save context | When Lapedra shares info | **PLANNED** |
| Proactive check-ins | Spontaneous insights | **PLANNED** |
| Cross-agent banter | Without human prompt | **PLANNED** |
| Natural imperfections | Occasional typos | **PLANNED** |

### Mid-Term Planned

| Feature | Description | Status |
|---------|-------------|--------|
| GovWin/BGov integration | Premium data sources | **PLANNED** |
| Mobile/email interface | Digests and notifications | **PLANNED** |
| Realistic availability | Agent "away" states | **PLANNED** |
| Design Lead agent | UX/UI expertise | **PLANNED** |

### Long-Term Planned

| Feature | Description | Status |
|---------|-------------|--------|
| Multi-workspace | Separate client workspaces | **PLANNED** |
| Voice interface | Voice memos to agents | **PLANNED** |
| Pricing intelligence | Historical pricing DB | **PLANNED** |
| Full proposal writing | Draft generation | **PLANNED** |

---

## 9. Known Limitations

### Technical Limitations

- FPDS keyword search can't find contract vehicles by name (needs contract number)
- FAR embeddings require OpenAI API (not Anthropic) for vector generation
- Socket Mode requires persistent connection (Railway handles this)
- Agency forecast HTML parsing is generic - some complex pages may not parse

### Data Limitations

- No real-time SAM.gov updates (polls on schedule)
- Historical FPDS data limited to what USASpending provides
- No CPAR access (requires agency relationship)
- News limited to last 30-90 days

### Scope Limitations

- Agents research, not write full proposals (Jodie partial)
- No document generation
- No calendar/scheduling integration
- No voice/video processing

---

## 10. Security Posture

### Row-Level Security (RLS)

- All 30+ tables have RLS enabled
- Service role only access (no anon key access)
- Views use `security_invoker = true`
- Functions have `search_path = public` to prevent injection

### Authentication

- 7 separate Slack bot tokens (one per agent)
- 7 separate Slack app tokens
- Supabase service role key (server-side only)
- All API keys in environment variables

### Data Protection

- No PII stored beyond user names
- Research cache auto-expires (2-24 hours)
- Old message claims cleaned weekly
- Competitor intel marked stale after 180 days

---

## 11. Testing & Quality

### Test Coverage

| Category | Tests | Status |
|----------|-------|--------|
| Playbook rules | 56 tests | **BUILT** |
| Database modules | Unit tests | **BUILT** |
| Event types | Zod validation | **BUILT** |
| Event bus | Mock tests | **BUILT** |

### Code Quality

| Tool | Purpose | Status |
|------|---------|--------|
| TypeScript | Type checking | **BUILT** |
| ESLint | Code quality | **BUILT** |
| Prettier | Formatting | **BUILT** |
| Husky | Pre-commit hooks | **BUILT** |
| lint-staged | Staged file checks | **BUILT** |

### Pre-commit Pipeline

```
git commit
  └─> Prettier (format)
        └─> ESLint (fix)
              └─> TypeScript (noEmit check)
                    └─> Commit
```

---

## 12. Deployment

### Production Environment

| Component | Provider | Status |
|-----------|----------|--------|
| Application | Railway | **BUILT** |
| Database | Supabase | **BUILT** |
| Messaging | Slack | **BUILT** |
| Source Control | GitHub | **BUILT** |

### Deployment Configuration

- Auto-deploy on push to `main`
- Dockerfile-based build
- Node.js 20 runtime
- Socket Mode for Slack (no public URL needed)

### NPM Scripts (80+)

Key scripts:
- `npm run live` - Start all agents
- `npm run start:prod` - Production with all schedulers
- `npm run maya:scan` - Manual opportunity scan
- `npm run patricia:checkin` - Manual standup
- `npm run david:brief` - Manual news digest
- `npm test` - Run all tests
- `npm run typecheck` - TypeScript verification

---

## Appendix: File Structure

```
ai-bd-team/
├── src/
│   ├── live/                    # Real-time Slack agents (7 files)
│   ├── integrations/            # External APIs (12+ files)
│   ├── events/                  # Event system (10+ files)
│   │   └── handlers/            # Agent event handlers (6 files)
│   ├── playbook/                # Self-organizing rules (6 files)
│   ├── context/                 # Company context loading
│   ├── prompts/                 # Agent system prompts
│   ├── scripts/                 # Utility scripts
│   ├── cron/                    # Scheduled jobs
│   └── coordination/            # Agent coordination
├── supabase/                    # Database migrations
├── docs/                        # Documentation
└── data/                        # Generated data (gitignored)
```

---

*This audit reflects the system state as of February 2026. Run `git log --oneline | head -20` to see recent changes.*
