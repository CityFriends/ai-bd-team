# AI BD Team: A Case Study

*Applying Human-Centered Design Principles to AI Agent Team Architecture*

---

## Executive Summary

The AI BD Team is a multi-agent AI system that provides small government contractors with enterprise-grade business development capabilities. Seven AI agents - each with distinct expertise, personality, and collaborative behaviors - work together in Slack to find, research, and evaluate federal contracting opportunities using real government data.

This case study documents how human-centered design (HCD) principles were applied not to a user interface, but to the architecture of an AI team itself. The result is a system that feels less like a tool and more like a capable team of colleagues.

---

## The Problem

### The Small Contractor Disadvantage

Large government contractors maintain dedicated business development teams:
- **Scouts** monitoring SAM.gov, agency forecasts, and industry signals
- **Analysts** researching incumbents, agency budgets, and competitive dynamics
- **Capture Managers** assessing win probability and teaming strategies
- **Project Managers** tracking deadlines and pipeline progress

Small contractors cannot afford these specialized roles. A 15-person firm might have one person doing BD part-time alongside billable work. The result:
- Opportunities discovered too late
- Insufficient research on incumbents and competition
- Reactive rather than strategic pursuit decisions
- Pipeline chaos and missed deadlines

### The Gap in Existing Solutions

Existing tools address pieces of the problem:
- **GovWin/BGov:** Good data, but expensive ($15K+/year) and still requires human analysis
- **SAM.gov alerts:** Notify about opportunities but provide no context
- **CRM systems:** Track pipeline but don't provide intelligence
- **General AI assistants:** Lack domain expertise and can't maintain consistent strategic thinking

What's missing: **An intelligent team that synthesizes information, maintains context, and collaborates on pursuit decisions.**

---

## The Approach

### Human-Centered Design for AI Teams

We applied HCD principles typically used for user interfaces to a different problem: designing an AI team architecture.

#### 1. Journey Mapping the BD Process

Before building agents, we mapped the actual business development journey:

```
Discover → Research → Assess → Decide → Pursue → Submit → Learn
```

At each stage, we asked:
- What expertise is needed?
- What data sources are relevant?
- What decisions must be made?
- Who needs to be involved?

This mapping revealed natural role boundaries that became our agents.

#### 2. Persona Development for Agents

Each AI agent was designed as a complete persona, not just a function:

| Agent | Role | Background | Voice |
|-------|------|------------|-------|
| Maya | Scout | Former GSA TTS, 27, Atlanta | Gen-Z, gets hype about good finds |
| David | Analyst | Former GAO auditor, 42, NJ | Jersey directness, spots red flags |
| Rosa | Connector | Industry associations, 44, San Antonio | Warm, relationship-first |
| James | Strategist | Ex-Booz capture lead, 52, Chicago | Executive, doesn't sugarcoat |
| Patricia | PM | Federal contractor PM, 31, DC | Persistent, keeps things moving |
| Marcus | Engineer | Ex-Leidos, 38, Baltimore | Measured, technical precision |

These aren't just names - each agent has detailed backstory, expertise areas, speech patterns, and quirks that inform every response.

#### 3. Collaborative Dynamics

Real teams have interaction patterns:
- Handoffs: Maya finds → David researches → Rosa checks partners → James synthesizes
- Debates: Agents can disagree ("David, I hear you, but in my experience...")
- References: "Like Maya said, this timeline is tight"
- Boundaries: Each agent knows what they don't know

We designed these dynamics explicitly, including pile-on prevention (only one agent responds to each message) and natural turn-taking.

---

## Technical Implementation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       SLACK WORKSPACE                            │
│                                                                  │
│   Maya    David    Rosa    James    Patricia    Marcus          │
│   ─────   ─────    ────    ─────    ────────    ──────          │
│     │       │        │       │          │          │            │
│     └───────┴────────┴───────┴──────────┴──────────┘            │
│                         │                                        │
│              WebSocket (Socket Mode)                            │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  NODE.JS APPLICATION                             │
│                                                                  │
│   Live Agent System          Event System        Scheduled Jobs  │
│   ─────────────────          ────────────        ──────────────  │
│   Message handling           Chain reactions     Daily scans     │
│   Research context           Agent coordination  Morning standups│
│   Response generation        Event routing       News digests    │
│                                                                  │
│   Integration Layer                                              │
│   ─────────────────                                              │
│   SAM.gov  FPDS  USASpending  SerpAPI  FAR  GitHub  Notion     │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SUPABASE                                     │
│                                                                  │
│   30+ tables: opportunities, agencies, partners, research       │
│   pgvector: semantic search for FAR and documents               │
│   Row-level security: service role only access                  │
└─────────────────────────────────────────────────────────────────┘
```

### Event-Driven Coordination

Agents coordinate through an event system that creates natural chain reactions:

```
Maya finds opportunity (8am scan)
    │
    └── NEW_OPPORTUNITY event
              │
              └── David receives, researches incumbent
                        │
                        └── RESEARCH_COMPLETE event
                                  │
                                  ├── Marcus: tech assessment
                                  ├── Rosa: teaming check
                                  └── James: waits, then synthesizes
                                              │
                                              └── GO_NO_GO_DECISION
                                                        │
                                                        └── @Lapedra for final call
```

All responses appear in the same Slack thread, creating a visible audit trail of team reasoning.

### Real Government Data Integration

The system integrates with actual government APIs, not simulated data:

| API | Purpose | Agent |
|-----|---------|-------|
| SAM.gov Opportunities | Federal opportunity search | Maya |
| SAM.gov Entity | Partner verification | Rosa |
| USASpending | Agency budgets and spending | David |
| Contract Data | Incumbent history | David |
| FAR (pgvector) | Acquisition regulation | David, James |
| SerpAPI | News and competitive intel | All |
| GitHub | Repository analysis | Marcus |

### Anti-Hallucination Safeguards

AI systems can fabricate information. We implemented strict guardrails:

- **Validation before posting:** Maya validates noticeId, title, and postedDate before posting any opportunity
- **URL generation, not invention:** SAM.gov URLs are constructed from noticeId, never invented
- **Source requirements:** David must cite actual URLs for news
- **Confidence levels:** All research marked HIGH/MEDIUM/LOW confidence
- **Relationship verification:** Rosa cannot claim to "know someone" without verification

---

## Methodology: HCD Applied to Agent Design

### 1. Empathy Research

We interviewed government contractors to understand:
- What information do you wish you had for bid decisions?
- Where do you spend the most time in BD?
- What makes a great BD teammate?

Insights drove agent expertise areas and personality traits.

### 2. Co-Design with Stakeholders

Agent personalities were developed iteratively:
- Initial character sketches
- Feedback on voice and expertise
- Refinement based on real conversations
- Continuous tuning of response patterns

### 3. Prototype and Test

Each agent capability was tested in real scenarios:
- "Can Maya correctly identify a wired RFP?"
- "Will David actually find the incumbent?"
- "Does James's recommendation match what a capture manager would say?"

### 4. Iterate on Interaction Patterns

Early versions had issues:
- **Pile-ons:** Multiple agents responding to the same message
- **Hallucinations:** Invented SAM.gov URLs, fake relationships
- **Personality drift:** Agents losing character mid-conversation

Each issue led to explicit fixes in architecture and prompts.

---

## Results

### Current Capabilities

**Automated Discovery:**
- Daily SAM.gov scans for relevant opportunities
- 12-agency forecast monitoring
- Award monitoring for competitive intelligence
- Relevance scoring (0-100) based on company fit

**Research Depth:**
- Incumbent analysis with contract history
- Agency budget trends and spending patterns
- News and competitive intelligence
- FAR regulation citations
- GitHub repository technical assessment

**Collaborative Assessment:**
- Multi-agent research chains
- Go/no-go recommendations with win probability
- Teaming strategy suggestions
- Pipeline tracking and deadline warnings

**Human Oversight:**
- Notion Hub with 8 synchronized databases
- Bidirectional sync (human decisions flow back to agents)
- Explicit human approval for outreach and decisions

### System Statistics

| Metric | Value |
|--------|-------|
| Active Agents | 6 (7th pending) |
| Database Tables | 30+ |
| API Integrations | 12 |
| Event Types | 20+ |
| Scheduled Jobs | 8 |
| Test Coverage | 229 tests |

### Self-Organizing Playbook

The system learns from decisions:
- Agents propose rules based on observed patterns
- Humans approve before rules become active
- Underperforming rules are retired
- Example: "VA HCD opportunities have higher win rates - prioritize"

---

## Key Innovations

### 1. Persona-Driven Agent Architecture

Traditional chatbots have consistent but bland personalities. Our agents have:
- Detailed biographical backgrounds
- Consistent speech patterns and vocabulary
- Quirks and preferences
- Expertise boundaries (know what they don't know)

### 2. Event-Driven Team Coordination

Agents don't just respond to humans - they respond to each other:
- Chain reactions feel like natural team workflow
- Visible reasoning in single Slack thread
- Graceful degradation (still works without events)

### 3. Real Data Validation

No simulated responses:
- Every opportunity is verifiable on SAM.gov
- Every contract citation can be checked
- Every news link actually exists

### 4. Explicit Anti-Hallucination

AI systems can fabricate convincingly. Our guardrails:
- Validation before posting
- URL construction (not invention)
- Source citation requirements
- Confidence level transparency

---

## Lessons for AI System Design

### What Worked

1. **Personality First:** Define characters before features. It's easier to add capabilities to a well-defined persona than to add personality to a feature set.

2. **Real Data:** Using actual government APIs built immediate trust. Users can verify what agents say.

3. **Meet Users Where They Work:** Slack integration meant no new tool to learn. Agents joined existing workflow.

4. **Human in the Loop:** Agents recommend, humans decide. Critical for high-stakes business decisions.

5. **Visible Reasoning:** All agent analysis in threaded conversations. Users see how recommendations emerged.

### What We'd Do Differently

1. **Earlier Guardrails:** Anti-hallucination measures should be day-one requirements, not retrofits.

2. **Comprehensive Logging:** More observability from the start for debugging and improvement.

3. **Documentation as You Go:** Design decisions should be documented when made, not reconstructed later.

---

## What's Next

### Immediate Roadmap

- **Writer Agent (Jodie):** Proposal content drafting and compliance review
- **Design Lead Agent:** UX/UI expertise for technical assessments
- **Enhanced Learning:** More sophisticated pattern recognition from outcomes

### Future Vision

**Multi-Client Support:**
- Separate workspaces per client
- Shared (anonymized) intelligence across deployments
- Continuous improvement from aggregate outcomes

**Premium Data Integration:**
- GovWin/BGov for pre-RFP intelligence
- Enhanced pricing intelligence
- Industry contact databases

**Full Proposal Support:**
- Draft generation
- Compliance matrix automation
- Section L/M analysis

---

## Conclusion

The AI BD Team demonstrates that human-centered design principles can be applied beyond traditional user interfaces. By treating AI agents as team members rather than tools - with authentic personalities, collaborative dynamics, and explicit expertise boundaries - we created a system that feels like a capable BD team, not just another chatbot.

For small government contractors, this means access to the kind of business development intelligence previously available only to large primes. For the field of AI design, it suggests a model for building AI teams that work alongside humans rather than replacing them.

The system is live, deployed on Railway, processing real federal opportunities, and continuously learning from outcomes. The agents are working. The team is operational.

---

## About

**Built by:** Friends Innovation Lab

**Technology Stack:**
- Node.js 20 + TypeScript
- Anthropic Claude (claude-sonnet-4-20250514)
- Supabase (PostgreSQL + pgvector)
- Slack Bolt SDK
- Railway deployment

**Contact:** [Contact information]

---

*Case study prepared: February 2026*
