# AI BD Team - Product Roadmap

## Current Status: 7 Agents Live

The AI BD Team is functional with seven agents providing real-time BD support in Slack.

---

## What's Built and Working

### Core Functionality
- [x] 7 distinct AI agents with unique personalities (Maya, David, Rosa, James, Patricia, Jodie, Marcus)
- [x] Real-time Slack integration (Socket Mode)
- [x] Message deduplication and claim system
- [x] Thread context awareness
- [x] Emoji reactions support

### Research Capabilities
- [x] SAM.gov opportunity search
- [x] FPDS incumbent/contract lookup
- [x] USASpending agency budgets
- [x] SerpAPI news search (with GovCon sources)
- [x] FAR semantic search and citation
- [x] Competitor intelligence gathering
- [x] SAM.gov entity verification
- [x] GitHub repository analysis (Marcus)

### Agent Intelligence
- [x] Proactive behavior (connect the dots)
- [x] Domain expertise per agent
- [x] Mood detection and emotional intelligence
- [x] Source citation requirements
- [x] Confidence level reporting
- [x] Follow-up response handling

### Monitoring
- [x] Award monitoring (manual + scheduled)
- [x] Competitor news tracking
- [x] Intel persistence to database

---

## In Progress

### New Agents
- [ ] **Jodie (Writer)** - Proposal writing, exec summaries, compliance matrices
  - Character defined, needs Slack app setup and deployment
  - Will integrate with proposal_content and case_studies tables
- [ ] **Design Lead** - UX/UI review, accessibility assessment, design system expertise
  - Character and expertise TBD
  - Will complement Marcus's technical architecture reviews

### Memory & Context
- [ ] Auto-save user context when shared
- [ ] Surface relevant memories in responses
- [ ] Decision pattern learning
- [ ] Inside joke tracking

### Company Profile
- [x] Load company capabilities into context
- [x] Reference past performance in assessments
- [x] Know contract vehicles and certifications

---

## Planned: Near-Term (1-3 months)

### Proactive Check-ins
Patricia can proactively nudge:
- "We haven't discussed that DOL opportunity in a week"
- "Q&A deadline is tomorrow - are we submitting questions?"
- "That opportunity we passed on just got re-posted"

**Implementation:**
- Scheduled Supabase function or external cron
- Query for stale tracked opportunities
- Post to Slack on schedule

### Full Opportunity Workflow
Automated pipeline:
1. Maya finds opportunity → Posts to channel
2. David auto-researches incumbent and agency
3. Rosa checks partner database
4. James synthesizes for go/no-go
5. Patricia tracks through submission

**Implementation:**
- Opportunity tracking table
- Pipeline stages with triggers
- Automatic research on new opportunities

### Better Cross-Agent Collaboration
- "Like David said earlier..."
- Agent-to-agent handoffs
- Debate between agents (James vs David on risk)

---

## Planned: Mid-Term (3-6 months)

### Realistic Availability
Agents occasionally "away":
- "Sorry, just seeing this - was in a meeting"
- "David is out today, but I can try to help"
- Staggered response times based on "availability"

### GovWin/BGov Integration
Premium data sources for:
- Deeper opportunity intelligence
- Pre-RFP tracking
- Contact database

**Blockers:**
- API access negotiation
- Cost ($1,000+/month)

### Proposal Assistance
Patricia helps with:
- Compliance matrix generation
- Section outline suggestions
- Review schedule management

### Mobile/Email Interface
- Email digests of daily activity
- Mobile-friendly summary views
- Push notifications for urgent items

---

## Planned: Long-Term (6-12 months)

### Multi-Workspace Support
- Separate workspaces per client
- Shared intelligence across (anonymized)
- Admin dashboard for management

### Voice Interface
- Voice memos to agents
- Audio summaries of research
- Meeting transcription integration

### Pricing Intelligence
- Historical pricing database
- Price-to-win suggestions
- Competitive rate analysis

### Proposal Writing Assistance
- Draft section generation
- Past performance write-ups
- Compliance checking

---

## Known Limitations

### Technical
- FPDS keyword search can't find contract vehicles by name (needs number)
- FAR embeddings require OpenAI API (not Anthropic)
- Socket Mode requires persistent connection

### Data
- No real-time SAM.gov updates (manual refresh)
- Historical FPDS data limited by RSS feed
- No CPAR access (requires agency relationship)

### Scope
- Agents can research, not write full proposals
- No document generation (yet)
- No calendar/scheduling integration

---

## Feature Request Process

### Prioritization Criteria
1. **User impact**: How many users benefit?
2. **Frequency**: How often is this needed?
3. **Effort**: How complex to implement?
4. **Dependencies**: What else needs to be built first?

### Submission
- Create GitHub issue with feature request
- Include use case and expected behavior
- Tag with `enhancement` label

---

## Technical Debt

### Code Quality
- [ ] Add unit tests for integrations
- [ ] Add integration tests for agent responses
- [ ] Document all API response formats
- [ ] Type all Slack event handlers

### Infrastructure
- [ ] Add error monitoring (Sentry)
- [ ] Add usage analytics
- [ ] Add health check endpoint
- [ ] Improve logging consistency

### Database
- [ ] Add automated backup script
- [ ] Add data retention policies
- [ ] Optimize vector search indexes
- [ ] Add database migrations

---

## Version History

### v1.0.0 (Initial)
- Initial release
- 5 agents with distinct personalities
- Core API integrations
- Basic memory system

### v1.1.0 (Current - Feb 2026)
- Refactored prompt architecture:
  - Personality prompts now use Claude's `system` parameter
  - Operational rules consolidated into compact `buildOperationalContext` method
  - Reduced prompt bloat by ~300 lines while preserving functionality
- Added personality texture system (`warmups.ts`):
  - Random daily "vibes" injected per agent (e.g., "Maya's training for a half marathon")
  - Warmup conversation pairs for natural tone
- Slack formatting enforcement:
  - Agents now use bold headers, bullets, numbered lists
  - Consistent formatting across all responses
- Maya prompt condensed from ~180 lines to ~25 lines
- Same refactor applied to David, Rosa, James, Patricia, Jodie

### v1.2.0 (Current - Feb 2026)
- Added Marcus (Engineering Lead) agent:
  - GitHub repository analysis via @octokit/rest
  - Tech stack detection, compliance concerns, architecture notes
  - FedRAMP/ATO/Section 508 expertise
- GitHub integration for repo analysis
- Company profile integration complete
- Updated all documentation for 7-agent team

### Planned v1.3.0
- Jodie (Writer) agent fully deployed
- Design Lead agent added
- Proactive check-ins
- Memory persistence improvements

### Planned v1.4.0
- Full opportunity workflow
- Better cross-agent collaboration
- Award monitoring improvements
