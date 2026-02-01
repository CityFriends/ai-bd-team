# AI BD Team - Development Plan

## What We've Built

### Core Infrastructure
- [x] 5 Slack agents with separate bot tokens (Maya, David, Rosa, James, Patricia)
- [x] Socket Mode for real-time message handling
- [x] Message deduplication to prevent double responses
- [x] Message claiming system to prevent pile-ons
- [x] Thread context loading for conversation awareness

### External API Integrations
- [x] SAM.gov opportunity search
- [x] FPDS incumbent/contract data (fixed: uses RSS `<item>` tags, not Atom `<entry>`)
- [x] USASpending agency budgets
- [x] SerpAPI for news search
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

### Agent Personalities (Distinct Voices)

| Agent | Role | Background | Voice |
|-------|------|------------|-------|
| Maya | Scout | 27, Spelman, Atlanta, civic tech | Gen-Z AAVE, "lowkey", "not gonna lie", hype energy |
| David | Analyst | 42, Korean American, NJ/Rutgers, Fairfax | Jersey direct, dad energy, dry humor, "Here's the thing..." |
| Rosa | Connector | 44, Mexican American, San Antonio, Silver Spring | Warm, Spanglish, "Mira", relationship-first |
| James | Strategist | 52, Black, Chicago South Side, Arlington | Executive presence, old school, "I've seen this before" |
| Patricia | PM | 31, Black, PG County/Howard, Petworth | Very online, millennial, emoji-friendly, TikTok references |

### Conversational Features
- [x] Mood detection (busy, engaged, relaxed, stressed, uncertain)
- [x] Emotional intelligence (reads subtext, checks in when things seem off)
- [x] Casual banter triggers (weekend, shows, pop culture, etc.)
- [x] Emoji reactions support
- [x] Date awareness (knows what day it is)
- [x] Short phrase handling ("yes", "let's roll", etc.)
- [x] Personality quirks that persist
- [x] Non-work opinions (restaurants, Metro, weather - not politics)

### Memory System (Supabase Tables)
- [x] `user_context` - personal info about Lapedra/Tamara
- [x] `conversation_memory` - key moments to reference
- [x] `inside_jokes` - shared references that build over time
- [x] `decision_patterns` - go/no-go tendencies
- [x] `message_claims` - prevents multiple agents responding
- [x] `agent_memory` - response logging with sources/confidence

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

### Priority 2: Company Data Integration
- [ ] Create `company_profile` table with FFTC capabilities, NAICS codes, past performance
- [ ] Load company data into agent context
- [ ] Agents can reference "what we're good at" when evaluating opportunities
- [ ] Agents know FFTC's certifications, contract vehicles, key differentiators

### Priority 2: Memory Persistence
- [ ] Auto-save personal context when Lapedra/Tamara share something
- [ ] Auto-save decision patterns after go/no-go decisions
- [ ] Surface relevant memories in responses ("You mentioned last week...")
- [ ] Inside jokes get referenced naturally over time

### Priority 3: Proactive Check-ins
- [ ] Scheduled agent messages (not just reactive)
- [ ] Patricia: "We haven't talked about that DOL thing in a week"
- [ ] Maya: "Slow morning on SAM but found this article..."
- [ ] David: "That opportunity we passed on got re-posted"
- [ ] Implement via Supabase cron or external scheduler

### Priority 4: Realistic Availability
- [ ] Agents occasionally "away" (dentist, kid thing, heads down)
- [ ] Stagger responses more naturally
- [ ] "Sorry, just seeing this - was in a meeting"

### Priority 5: Full Opportunity Workflow
- [ ] Maya finds opp → posts to channel
- [ ] David auto-researches incumbent, agency
- [ ] Rosa checks partner options
- [ ] James synthesizes for go/no-go
- [ ] Patricia tracks action items
- [ ] Store opportunity in Supabase, track through pipeline

### Priority 6: Refinements
- [ ] Better cross-agent references ("Like David said...")
- [ ] More natural thread ownership
- [ ] Occasional typos/self-corrections for realism
- [ ] Agent-to-agent banter without human prompt

---

## Tech Stack
- **Runtime**: Node.js + TypeScript (tsx)
- **Slack**: Bolt SDK with Socket Mode
- **AI**: Claude claude-sonnet-4-20250514 via Anthropic SDK
- **Database**: Supabase (PostgreSQL)
- **APIs**: SAM.gov, FPDS, USASpending, SerpAPI

## Running the Agents
```bash
npm run live          # Start all 5 agents
npm run full-cycle    # Run a demo opportunity cycle
```

## Environment Variables Required
```
SLACK_CHANNEL_ID
MAYA_BOT_TOKEN, MAYA_APP_TOKEN
DAVID_BOT_TOKEN, DAVID_APP_TOKEN
ROSA_BOT_TOKEN, ROSA_APP_TOKEN
JAMES_BOT_TOKEN, JAMES_APP_TOKEN
PATRICIA_BOT_TOKEN, PATRICIA_APP_TOKEN
ANTHROPIC_API_KEY
SUPABASE_URL, SUPABASE_SERVICE_KEY
SAM_API_KEY
SERPAPI_KEY
```
