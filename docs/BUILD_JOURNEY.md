# AI BD Team - Build Journey

*A narrative timeline of how the AI BD Team evolved from concept to production system.*

---

## The Vision

Build an AI-powered business development team for government contractors. Not a chatbot, not a search tool, but a team of specialized agents with authentic personalities who collaborate to find, research, and evaluate federal opportunities.

The insight: Small government contractors can't afford a full BD team (scouts, analysts, capture managers), but they need the same intelligence that large primes have. What if AI agents could fill these roles?

---

## Phase 1: Foundation (Initial Commit → Core Agents)

### The First Commit

The project began with a clear architecture: multiple AI agents, each with a distinct personality and role, working together in Slack.

**First Agents Built:**
- Maya (Scout) - Find opportunities
- David (Analyst) - Research incumbents
- Rosa (Connector) - Teaming strategy
- James (Strategist) - Go/no-go decisions

### Key Early Decisions

**Separate Bot Tokens:** Each agent got their own Slack app. This wasn't the easy path (more configuration), but it meant each agent appeared as a real person in Slack with their own name, photo, and presence.

**Real Government APIs:** From day one, agents used real SAM.gov and FPDS data. No mocks, no simulations. If Maya said there was a VA opportunity, users could verify it.

**Personality First:** Before building features, each agent got a detailed backstory. Maya's Gen-Z voice, David's Jersey dad energy, Rosa's warm Spanglish - these weren't afterthoughts, they were the foundation.

---

## Phase 2: Adding Patricia & Conversational Memory

### The Missing Role

The four agents could find, research, and recommend. But who tracked progress? Who followed up on decisions? Who kept the pipeline moving?

**Patricia joined the team** - the PM agent. She brought:
- Pipeline tracking
- Morning standups
- Deadline warnings
- The persistence to actually follow up

### Memory Systems

Agents needed to remember things:
- **User context:** Lapedra mentioned her daughter's recital
- **Decision patterns:** We always pass on DOD without clearances
- **Inside jokes:** References the team could share

Database tables were added: `user_context`, `conversation_memory`, `inside_jokes`, `decision_patterns`.

---

## Phase 3: Live Agent System & External Research

### Going Real-Time

The original architecture had agents responding to commands. But that's not how teams work. Teams have real-time conversations.

**Socket Mode Integration:** Agents connected via WebSocket, receiving messages instantly. No webhooks, no delays. Just like real Slack users.

**Research Context:** When you asked David about an incumbent, he didn't just answer from memory. He actually searched:
- USASpending for agency budgets
- Contract data for incumbent history
- News sources for recent developments

### SerpAPI & News Integration

Competitive intelligence requires news. Added SerpAPI to search:
- GovCon sources (GovConWire, Washington Technology, FCW)
- Agency news and leadership changes
- Competitor protests and performance issues

**Key Fix:** Early versions would cite news without links. Users couldn't verify. Now agents must include actual URLs.

---

## Phase 4: FAR Lookup & Domain Expertise

### Regulations Matter

Government contracting is governed by the Federal Acquisition Regulation (FAR). Agents needed to cite it correctly.

**FAR with pgvector:** Downloaded the full FAR from GSA's GitHub repo, parsed it into sections, and created vector embeddings for semantic search. Now David could say "FAR 15.304 covers source selection" and actually be right.

### Domain Expertise Prompts

Each agent got deep domain knowledge embedded in their system prompt:
- Maya: Wired RFPs, set-aside codes, NAICS games
- David: FPDS patterns, protest dynamics, pricing
- Rosa: Teaming structures, partner red flags
- James: Win probability, discriminators, debriefs

**Proactive Behavior:** Agents started connecting dots unprompted. "I've seen 3 HCD solicitations from VA this month - they're on a kick."

---

## Phase 5: Company Knowledge Base & Notion Integration

### Knowing Ourselves

Agents needed to know the company they worked for:
- Past performance and CPAR ratings
- Teaming partners and relationships
- Key personnel and certifications
- Labor rates and contract vehicles

**11 Tables Created:** `company_profile`, `past_performance`, `teaming_partners`, `labor_rates`, `case_studies`, `key_personnel`, `proposal_content`, `lessons_learned`, `documents`, `contacts`.

### Notion Hub

Slack is great for conversation, but humans need dashboards. **Notion Hub** provided:
- 8 synchronized databases
- Full pipeline visibility
- Human decision tracking
- Bidirectional sync (changes flow back to agents)

---

## Phase 6: Production Deployment (Railway)

### Going Live

The system moved from local development to 24/7 production on Railway.

**Challenges Solved:**
- Socket Mode timeouts (increased ping timeout)
- Dockerfile optimization for Node.js 20
- Environment variable management for 7 agents
- Cron job scheduling with node-cron

### Scheduled Jobs

Agents started working autonomously:
- Maya's daily SAM.gov scan (8am Mon-Fri)
- Patricia's morning standup (11am)
- Patricia's pending nudge (2pm)
- David's news digest (8am MWF)
- Award monitoring (Mon/Thu)

---

## Phase 7: Anti-Hallucination Hardening

### The Problem

Early versions had concerning behaviors:
- Maya invented SAM.gov URLs that didn't exist
- David cited news articles without actual links
- Rosa claimed to "know people" she'd never met
- Agents made promises they couldn't keep ("I'll check and get back to you in 20 minutes")

### The Fix

**Validation Before Posting:**
- Maya validates noticeId, title, postedDate before any post
- SAM.gov URLs generated from noticeId (never invented)
- News citations require actual URLs
- Source confidence levels required

**No False Promises:**
- Agents can't say "I'll check" without actually checking
- No calendar promises (no calendar access)
- No email promises (no email access without approval)

**Rosa's Outreach Rule:**
- Rosa can only DRAFT outreach emails
- Must ask @Lapedra for approval before anything
- Never sends - only prepares

---

## Phase 8: Agency Forecasts & Award Monitoring

### Looking Ahead

SAM.gov shows current opportunities. But what's coming next?

**Agency Forecast Scraping:** Built scrapers for 12 agency forecast pages:
- CMS, VA, HHS, GSA, FEMA, DOL, State, ED, DHS, SBA, USDA, DOT

Maya could now say "VA forecast shows a modernization effort dropping in Q2 - this might be the pre-positioning opportunity."

### Award Monitoring

When contracts get awarded, teams need to know:
- Who won?
- For how much?
- What does it mean for future opportunities?

**Like OrangeSlices, but free:** Award monitor polls contract data for new awards, deduplicates via `seen_awards` table, and Maya reports to Slack.

---

## Phase 9: Marcus Joins (Engineering Lead)

### The Technical Gap

The team could evaluate opportunities, but technical assessment was shallow. When an RFP required FedRAMP or referenced a GitHub repo, agents were guessing.

**Marcus entered the chat** - 38, Baltimore, Howard CS grad, 6 years at Leidos on DoD logistics backend.

**GitHub Integration:** Marcus can actually analyze repositories:
- Tech stack detection
- Compliance tooling (axe-core, pa11y)
- Architecture patterns
- CI/CD configuration
- Open issues and code quality

**Technical SOW Review:** Marcus spots inflated requirements ("They're asking for multi-region active-active for a 100-user app - that's theater").

---

## Phase 10: Fixing Agent Coordination Issues

### The Pile-On Problem

Multiple agents responding to the same message broke the illusion of a real team.

**Message Claiming System:** Database table with UNIQUE constraint. First agent to claim wins. Others see the claim and stay quiet unless they have something new.

### The Double-Response Bug

Same agent responding twice to the same message.

**Fix:** In-memory `processedMessages` Set + database claims. Multiple layers of protection.

### Rosa's False Claims

Rosa would claim relationships that didn't exist.

**Fix:** Explicit guardrail in prompt: "Only mention relationships you can verify. Never say 'I know someone at ACT-IAC' unless you actually do."

---

## Phase 11: Event-Driven Architecture

### The Chain Reaction Vision

When Maya finds an opportunity, the team should automatically respond:
1. David researches incumbent and agency
2. Marcus assesses technical requirements
3. Rosa checks teaming options
4. James synthesizes and recommends

### Event System Built

**20+ Event Types:**
- NEW_OPPORTUNITY, RESEARCH_COMPLETE, TECH_ASSESSMENT_COMPLETE
- RELATIONSHIP_CHECK_COMPLETE, GO_NO_GO_DECISION
- DEADLINE_WARNING, PIPELINE_HEALTH_CHECK

**Event Bus:** Supabase table with publish/subscribe pattern. Agents subscribe to events they care about. Events carry Slack thread context so all responses appear in the same conversation.

**Additive Design:** Events enhance existing behavior. Cron jobs still work. System degrades gracefully.

---

## Phase 12: Self-Organizing Playbook

### Learning from Experience

The team makes decisions. Some opportunities win, some lose. What patterns emerge?

**Team Playbook System:**
- Agents propose rules based on observed patterns
- Humans approve before rules become active
- Rules get retired if they don't perform

**Example Rules:**
- "Don't bid IT contracts > $10M without past performance at that agency"
- "VA HCD opportunities have 65% win rate - prioritize"
- "When timeline < 14 days and we have no incumbent relationship, recommend NO-GO"

**Patricia's Monthly Retrospective:** Analyze wins and losses, propose new rules, identify patterns.

---

## Phase 13: Code Quality & Testing

### Project Restructure

The codebase had grown organically. Time to professionalize:
- Modular architecture
- Unit tests with Vitest
- ESLint + Prettier formatting
- TypeScript strict mode
- Pre-commit hooks

**229 Tests Passing:** Playbook rules, database modules, event types, event bus.

### Pre-Commit Pipeline

Every commit now runs:
1. Prettier (format)
2. ESLint (fix)
3. TypeScript (noEmit check)

No more "works on my machine" issues.

---

## Key Milestones

| Date | Milestone |
|------|-----------|
| Initial | First commit - 4 agents with personalities |
| Week 2 | Patricia added as PM agent |
| Week 3 | Live agent system with Socket Mode |
| Week 4 | SAM.gov and FPDS integration working |
| Week 5 | News search and competitor intel |
| Week 6 | FAR lookup with vector search |
| Week 7 | Company knowledge base (11 tables) |
| Week 8 | Railway production deployment |
| Week 9 | Anti-hallucination hardening |
| Week 10 | Notion Hub for human oversight |
| Week 11 | Agency forecast scraping (12 agencies) |
| Week 12 | Marcus joins (GitHub analysis) |
| Week 13 | Event-driven chain reactions |
| Week 14 | Self-organizing playbook |
| Week 15 | Code quality restructure, 229 tests |

---

## Lessons Learned

### What Worked

1. **Personality First:** Defining characters before features made agents feel real
2. **Real APIs:** Using actual government data built trust immediately
3. **Slack Native:** Meeting users where they work, not forcing new tools
4. **Event-Driven:** Chain reactions make the team feel alive
5. **Human in the Loop:** Agents recommend, humans decide

### What We'd Do Differently

1. **Earlier Testing:** Should have added tests sooner
2. **Stricter Validation:** Anti-hallucination guardrails should have been day-one
3. **Better Logging:** More observability from the start
4. **Documentation:** Should have documented design decisions as they were made

### Surprises

1. **Personality Consistency is Hard:** Claude needs constant reinforcement to stay in character
2. **API Reliability Varies:** FPDS is flaky; USASpending is solid
3. **Users Treat Agents Like People:** They say "thanks" and ask about weekends
4. **Chain Reactions Feel Magical:** Watching agents coordinate automatically never gets old

---

## What's Next

### Near-Term
- Jodie (Writer) fully deployed
- Design Lead agent for UX expertise
- Auto-save user context
- Natural imperfections (occasional typos, self-corrections)

### Mid-Term
- GovWin/BGov integration for premium data
- Mobile/email interface
- Realistic agent availability ("David is out today")

### Long-Term
- Multi-workspace support for multiple clients
- Voice interface
- Full proposal writing capability
- Pricing intelligence database

---

*Build journey documented: February 2026*
