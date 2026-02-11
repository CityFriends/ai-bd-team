# AI BD Team

An AI-powered Business Development team for government contracting. Five specialized agents collaborate in Slack to find, research, and evaluate federal opportunities.

## What Is This?

The AI BD Team simulates a complete BD department with:

| Agent | Role | Specialty |
|-------|------|-----------|
| **Maya** | Scout | Finds opportunities, interprets solicitations |
| **David** | Analyst | Researches incumbents, competitive intelligence |
| **Rosa** | Connector | Teaming strategy, partner relationships |
| **James** | Strategist | Go/no-go decisions, capture strategy |
| **Patricia** | PM | Tracks deadlines, manages the pipeline |

Each agent has a distinct personality, expertise, and voice. They research using real government APIs (SAM.gov, FPDS, USASpending) and respond naturally in Slack.

## Quick Start

```bash
# Clone and install
git clone <repository>
cd ai-bd-team
npm install --legacy-peer-deps

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run tests to verify setup
npm test

# Start the team
npm run live
```

Then in Slack:
```
@Maya what opportunities are there at VA?
@David who's the incumbent on this contract?
@Rosa do we need a teaming partner for this?
@James should we go for this opportunity?
```

## Features

### Real-Time Research
- **SAM.gov** - Federal opportunity search
- **FPDS** - Contract history and incumbents
- **USASpending** - Agency budgets
- **News** - GovCon news from OrangeSlices, GovConWire, etc.
- **FAR** - Federal Acquisition Regulation citations

### Intelligent Agents
- Distinct personalities and expertise
- Proactive insights (connect the dots)
- Source citations and confidence levels
- Natural conversation in threads

### Competitive Intelligence
- Automatic competitor research
- Protest and performance issue tracking
- Intel persistence for future reference

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design and data flow |
| [Setup Guide](docs/SETUP.md) | Installation and configuration |
| [Development Guide](docs/DEVELOPMENT.md) | Testing, linting, CI/CD workflow |
| [Configuration](docs/CONFIGURATION.md) | Customization options |
| [Agents](docs/AGENTS.md) | Agent reference and examples |
| [Database](docs/DATABASE.md) | Schema and table documentation |
| [Integrations](docs/INTEGRATIONS.md) | External API reference |
| [Onboarding](docs/ONBOARDING.md) | Client setup process |
| [Costs](docs/COSTS.md) | Pricing and billing breakdown |
| [Roadmap](docs/ROADMAP.md) | What's built and what's next |

## Requirements

- Node.js 20+
- Slack workspace with admin access
- Supabase account
- API keys: Anthropic, SAM.gov, SerpAPI

## Commands

```bash
# Live agents
npm run live              # Start all agents in Slack

# Development
npm test                  # Run tests
npm run lint              # Check code quality
npm run typecheck         # TypeScript type checking

# Operations
npm run cli -- agent maya scan    # Run Maya scanner
npm run cli -- workflow process   # Process workflow queue
```

## Architecture

```
User @mentions agent in Slack
         │
         ▼
Agent receives message via Socket Mode
         │
         ▼
Research context gathered (FPDS, news, FAR, etc.)
         │
         ▼
Claude generates response with personality
         │
         ▼
Response posted to Slack thread
```

## Example Conversation

```
User: @David what do you know about Booz Allen at VA?

David: Alright, here's what I found. Mixed signals on Booz at VA.

They lost a GAO protest on a $98M award last year - agency went with
Guidehouse instead. Here's the article: [link]

But here's the bigger picture - Treasury just cut ties with them over
a tax records breach. That's gonna follow them around.

If we're going up against them, the security angle might be our
opening - especially at VA where veteran data protection is critical.

What's the opportunity you're looking at?
```

## Cost Estimate

| Usage Level | Monthly Cost |
|-------------|--------------|
| Light (testing) | ~$10 |
| Normal (small team) | ~$150-200 |
| Heavy (active org) | ~$400-500 |

See [Costs](docs/COSTS.md) for detailed breakdown.

## License

Proprietary - All rights reserved.

## Support

For questions or issues, contact the development team.
