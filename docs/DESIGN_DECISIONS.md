# AI BD Team - Design Decisions Log

*This document captures the key architectural and design decisions made during the development of the AI BD Team, including the reasoning behind each choice and alternatives considered.*

---

## Overview

The AI BD Team was designed with several core principles:
1. **Human-centered design** applied to AI agent architecture
2. **Authentic personalities** that feel like real team members
3. **Real data** from government APIs, not simulated responses
4. **Event-driven coordination** for emergent team behavior
5. **Human oversight** at critical decision points

---

## 1. Why Multi-Agent Architecture?

### Decision
Build a team of 7 specialized AI agents rather than a single general-purpose assistant.

### Rationale

**The Real BD Team Model:**
- Real business development teams have specialists: scouts, analysts, connectors, strategists
- Each role requires different expertise, data sources, and decision frameworks
- A single agent trying to do everything would lack depth and authenticity

**Emergent Behavior:**
- Multiple agents can disagree, debate, and arrive at better decisions
- Each agent can maintain consistent personality and expertise
- Cross-agent references ("Like David said...") feel natural

**Technical Benefits:**
- Each agent has a focused system prompt (clearer, fewer conflicting instructions)
- Agents can be developed, tested, and improved independently
- Different agents can use different response strategies

### Alternatives Considered
- **Single agent with multiple "modes"**: Rejected because personality shifts would feel jarring
- **Command-based system**: Rejected because natural conversation is more useful
- **Workflow automation (no AI)**: Rejected because judgment and synthesis are the valuable parts

---

## 2. Why Slack as the Interface?

### Decision
Use Slack as the primary human interface, with each agent appearing as a separate Slack user.

### Rationale

**Where BD Teams Actually Work:**
- Government contractors already use Slack/Teams for daily communication
- Natural place for opportunity discussions, quick questions, async updates
- No new tool to learn - agents join existing workflow

**Real-Time Collaboration:**
- Thread-based conversations mirror how teams actually discuss opportunities
- @mentions for specific expertise feel natural
- Reactions provide quick feedback

**Technical Advantages:**
- Slack Bolt SDK is mature and well-documented
- Socket Mode works behind firewalls (common in gov contractors)
- No public URL required for local development or Railway deployment

### Alternatives Considered
- **Web dashboard**: Would require users to context-switch; less natural
- **Email**: Too slow for collaborative discussion
- **Custom chat app**: Unnecessary when Slack already exists
- **Microsoft Teams**: Possible future addition, but Slack SDK is more mature

---

## 3. Why Separate Bot Tokens Per Agent?

### Decision
Create 7 separate Slack apps, one for each agent, rather than a single bot with multiple personas.

### Rationale

**Authenticity:**
- Each agent appears as a distinct user in Slack
- Unique profile pictures and display names
- Users can @mention specific agents naturally

**Rate Limiting:**
- Each agent has independent rate limits
- One chatty agent doesn't block others
- Better fault isolation

**Future Flexibility:**
- Agents could potentially be deployed to different workspaces
- Easier to disable/enable individual agents
- Could add more agents without reconfiguring existing ones

### Alternatives Considered
- **Single bot, multiple personalities**: Would require complex message routing; less authentic
- **Single bot with emoji prefixes**: Maya: "message" - feels clunky

### Trade-offs Accepted
- More Slack apps to manage (7 bot tokens, 7 app tokens)
- More complex configuration
- Slightly more setup time

---

## 4. Why Claude for Response Generation?

### Decision
Use Anthropic Claude (claude-sonnet-4-20250514) for all agent response generation.

### Rationale

**Quality:**
- Excellent instruction following
- Strong at maintaining consistent personality
- Reliable JSON output for structured responses
- Good at "staying in character"

**Speed/Cost Balance:**
- claude-sonnet-4-20250514 provides good quality at reasonable cost
- Fast enough for real-time conversation
- ~$0.003 per response is sustainable

**Technical Fit:**
- Works well with detailed system prompts
- Handles complex research context
- Can be directed to cite sources accurately

### Alternatives Considered
- **GPT-4**: Similar capability but different pricing model
- **Open source models**: Inconsistent quality for persona maintenance
- **Claude Opus**: Higher quality but too expensive for conversational use

---

## 5. Why Supabase for Database?

### Decision
Use Supabase (hosted PostgreSQL) with pgvector extension.

### Rationale

**PostgreSQL Power:**
- Full relational database for complex queries
- JSONB for flexible schema evolution
- pgvector for semantic search (FAR sections, case studies)

**Developer Experience:**
- Supabase client is simple and well-documented
- Built-in Row Level Security (RLS)
- Good dashboard for debugging

**Managed Service:**
- No database administration required
- Automatic backups
- Scales with usage

**Specific Needs Met:**
- pgvector for FAR semantic search (1536-dimension embeddings)
- UNIQUE constraints for message claiming
- Complex queries for pipeline reporting

### Alternatives Considered
- **Firebase**: NoSQL doesn't fit relational opportunity/company data
- **Self-hosted Postgres**: More maintenance burden
- **Pinecone for vectors + separate DB**: Unnecessary complexity when pgvector works

---

## 6. Why Event-Driven Architecture?

### Decision
Implement an event bus (agent_events table) for agent-to-agent coordination, layered on top of existing cron jobs.

### Rationale

**Chain Reactions:**
- When Maya finds an opportunity, David should automatically research
- When David finishes, Marcus and Rosa should analyze in parallel
- James should synthesize when all inputs are ready
- This creates natural team workflow without hardcoded sequences

**Visibility:**
- All events are in the same Slack thread
- Humans can see the chain of reasoning
- Easy to trace how a decision was reached

**Additive Design:**
- Events enhance existing behavior, don't replace it
- Cron jobs still work for scheduled tasks
- System degrades gracefully if events aren't processed

**Decoupling:**
- Agents don't need to know about each other directly
- New agents can subscribe to existing events
- Easy to add new event types

### Alternatives Considered
- **Direct agent-to-agent calls**: Creates tight coupling; hard to add new agents
- **Workflow orchestrator**: Adds complexity; events are simpler
- **Pure cron-based**: Misses the reactive intelligence that makes the team feel alive

---

## 7. Why Message Claiming System?

### Decision
Use a `message_claims` table with UNIQUE constraint to prevent multiple agents from responding to the same message.

### Rationale

**The Pile-On Problem:**
- Without claiming, multiple agents might all respond to "What do you think?"
- This is annoying and breaks the illusion of a real team
- Real teams have implicit turn-taking; agents need explicit coordination

**Implementation:**
- First agent to claim wins (race to INSERT)
- UNIQUE constraint on message_ts enforces exclusivity
- Claims auto-expire after 1 hour

**Result:**
- Only one agent responds to each message
- Other agents can add to the thread if they have new information
- Feels like natural team conversation

### Alternatives Considered
- **Agent-specific triggers only**: Too restrictive; misses relevant messages
- **Priority queue**: Adds latency; claiming is faster
- **Let Claude decide**: Unreliable; explicit claiming is more predictable

---

## 8. Why Real Government APIs?

### Decision
Integrate with real SAM.gov, USASpending, and FPDS data rather than simulated responses.

### Rationale

**Credibility:**
- Users can verify the data agents cite
- No risk of hallucinated opportunity details
- Builds trust in the system

**Practical Value:**
- Real opportunities, real deadlines, real incumbent data
- System becomes immediately useful for actual BD work
- Not just a demo - a working tool

**Learning:**
- Dealing with real API quirks (FPDS deprecation, SAM.gov rate limits)
- Forces robust error handling
- Exposes actual data quality issues

### Trade-offs Accepted
- API rate limits require caching
- Some APIs are unreliable (FPDS RSS has issues)
- More complex than mocked responses

---

## 9. Why Anti-Hallucination Guardrails?

### Decision
Implement strict validation and guardrails to prevent agents from inventing data.

### Key Guardrails:
- Maya validates noticeId, title, postedDate before posting
- Maya generates SAM.gov URLs from noticeId (never invents URLs)
- David requires source citations for all claims
- Rosa can't claim relationships she hasn't verified
- All agents required to provide confidence levels

### Rationale

**Trust:**
- BD decisions have real consequences (time, money, reputation)
- One false claim undermines all future agent output
- Better to say "I don't know" than to guess

**Legal/Compliance:**
- Government contracting has strict rules about representations
- Can't claim past performance that doesn't exist
- Can't promise capabilities you don't have

### Lessons Learned
- Early versions of Maya hallucinated SAM.gov URLs
- David invented competitor intel that didn't exist
- Rosa claimed to "know people" she'd never met
- Each issue was fixed with explicit validation + prompt engineering

---

## 10. Why Notion Hub for Human Oversight?

### Decision
Create a Notion workspace that syncs bidirectionally with Supabase, providing a human-friendly oversight layer.

### Rationale

**Human-Agent Collaboration:**
- Agents propose, humans decide
- Notion is where humans naturally work
- No need to make all decisions in Slack

**Full Pipeline Visibility:**
- All opportunities in one database
- All agent analysis aggregated
- Decision history with outcomes

**Bidirectional Sync:**
- Human updates flow back to agents
- If human marks "NO-GO" in Notion, agents see it
- Single source of truth with multiple views

### 8 Synchronized Databases:
1. Opportunities
2. Partners
3. Contacts
4. Past Performance
5. Forecasts
6. Activity Log
7. Feedback Log
8. Decisions

---

## 11. Why Self-Organizing Playbook?

### Decision
Create a `team_playbook` table where agents can propose rules based on patterns they observe, with human approval before activation.

### Rationale

**Emergent Intelligence:**
- Rules come from the team's experience, not hardcoded by developers
- Patterns like "We don't bid DOD without clearances" emerge from decisions
- Over time, the system gets smarter

**Human in the Loop:**
- Agents propose rules, humans approve
- Bad rules can be retired based on performance
- Override mechanism for exceptions

**Example Rules:**
- "If ceiling < $500K and timeline < 14 days, recommend NO-GO"
- "VA HCD opportunities have 65% win rate - prioritize"
- "When incumbent has recent GAO protest, highlight vulnerability"

### Implementation:
- `team_playbook` table stores rules with confidence scores
- James consults playbook before go/no-go recommendations
- Patricia runs monthly retrospective to propose new rules

---

## 12. What We Tried That Didn't Work

### FPDS RSS Feed
**Issue:** FPDS RSS is unreliable, often returns stale data, doesn't support all query types
**Resolution:** Migrated to USASpending API which has better coverage

### Single Agent System Prompt
**Issue:** One massive prompt for all agent behavior became unwieldy (800+ lines)
**Resolution:** Split into personality prompt (system parameter) + operational context (user message)

### Emoji-Only Reactions
**Issue:** Agents would react with emoji but not add substance
**Resolution:** Required substantive follow-up responses, reactions only as supplement

### FPDS Keyword Search for Vehicles
**Issue:** Can't search for "SPRUCE IDIQ" - only finds by contract number
**Resolution:** Document limitation; users must provide contract numbers

### Agent Double-Responding
**Issue:** Same agent responding twice to same message
**Resolution:** In-memory processedMessages Set + database message_claims

### Rosa Fabricating Relationships
**Issue:** Rosa would claim to "know someone at ACT-IAC" without basis
**Resolution:** Explicit guardrail: only mention relationships that can be verified

---

## 13. Why These Specific Agent Personalities?

### Decision
Each agent has detailed biographical background, speech patterns, quirks, and expertise areas.

### Design Principles:

**Diversity:**
- Different ages (27-52), backgrounds, perspectives
- Mix of government (Maya at GSA, David at GAO) and industry experience
- Realistic DMV-area demographics

**Authentic Expertise:**
- Each background explains their expertise
- David's GAO experience → knows FPDS patterns
- Rosa's industry association work → knows who's who
- Marcus's Leidos experience → understands gov tech realities

**Voice Differentiation:**
- Maya: Gen-Z, "lowkey", gets hype
- David: Jersey, dad energy, "Here's the thing..."
- Rosa: Warm, Spanglish, relationship-first
- James: Executive, decisive, war stories
- Patricia: Millennial, emoji-friendly, persistent
- Jodie: Precise, editorial, dry wit
- Marcus: Measured, precise, Baltimore markers

**Avoiding Stereotypes:**
- Each character is a full person, not a type
- Backgrounds inform but don't determine personality
- Authentic without being cartoonish

---

## 14. Why Socket Mode Instead of HTTP Webhooks?

### Decision
Use Slack's Socket Mode (WebSocket connection) instead of traditional HTTP webhooks.

### Rationale

**Firewall-Friendly:**
- Government contractors often have strict network policies
- Socket Mode works behind firewalls without port forwarding
- No public URL required

**Development Experience:**
- Works on localhost without ngrok
- Instant message delivery (no webhook verification delays)
- Easier debugging

**Deployment:**
- Railway provides always-on connection
- No need to configure callback URLs
- Simpler infrastructure

### Trade-off Accepted:
- Requires persistent connection (Railway handles this)
- More sensitive to network interruptions
- Slightly more complex error handling

---

## 15. Future Decisions (Anticipated)

### Multi-Workspace Support
**When:** If/when multiple clients adopt the system
**Decision needed:** Separate deployments vs. shared infrastructure with tenant isolation

### Premium Data Sources (GovWin, BGov)
**When:** If basic APIs prove insufficient
**Decision needed:** Cost justification, API access negotiation

### Voice Interface
**When:** If users request voice memos or audio summaries
**Decision needed:** Transcription service, audio generation approach

### Full Proposal Writing
**When:** After Jodie is fully deployed and tested
**Decision needed:** Document generation format, review workflow, version control

---

*Design decisions log last updated: February 2026*
