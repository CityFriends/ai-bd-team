# AI BD Team - Configuration Guide

This guide explains how to customize the AI BD Team for different companies and use cases.

## Changing Agent Personalities

Each agent's personality is defined in their respective file in `src/live/`:

```
src/live/maya.ts      # Scout
src/live/david.ts     # Analyst
src/live/rosa.ts      # Connector
src/live/james.ts     # Strategist
src/live/patricia.ts  # PM
```

### Personality Components

Each agent has a `systemPrompt` with these sections:

```typescript
systemPrompt = `You are [Name], the [role] for [Company]'s BD team.

BACKGROUND:
- Age, ethnicity, background
- Education and career path
- Current location and life situation
- Personal details that humanize them

WHAT YOU DO:
- Core responsibilities
- What they're expert at
- Their lane vs other agents

[EXPERTISE SECTION]:
- Deep domain knowledge
- What they know how to interpret
- Industry-specific skills

REALITY CHECK - BE HONEST:
- What they can/cannot claim
- Grounding in research vs experience

VOICE & SPEECH PATTERNS:
- Speech style, catchphrases
- Cultural/regional influences
- What they DON'T say

EXAMPLE MESSAGES:
- 4-6 examples of their voice

BE PROACTIVE:
- How they connect dots
- What they surface unprompted

WHEN TO RESPOND / STAY QUIET:
- Their lane and boundaries

PERSONALITY QUIRKS:
- Recurring themes/interests
- Non-work life

NON-WORK OPINIONS:
- Safe topics they have opinions on
`;
```

### Customization Examples

**Change company name:**
Replace all instances of "Friends From The City" with your company name.

**Change personality:**
Modify BACKGROUND, VOICE, and EXAMPLE MESSAGES to match desired persona.

**Change expertise:**
Update the expertise section with domain-specific knowledge.

## Adding or Removing Agents

### Adding a New Agent

1. Create a new file `src/live/newagent.ts`:
```typescript
import { LiveAgent } from './agent.js';
import type { LiveAgentName } from './types.js';

export class NewAgent extends LiveAgent {
  name: LiveAgentName = 'newagent';
  displayName = 'NewAgent';

  systemPrompt = `...`;

  protected getBotToken(): string | undefined {
    return process.env.NEWAGENT_BOT_TOKEN;
  }

  protected getAppToken(): string | undefined {
    return process.env.NEWAGENT_APP_TOKEN;
  }
}

export const newagent = new NewAgent();
```

2. Update `src/live/types.ts`:
```typescript
export type LiveAgentName = 'maya' | 'david' | 'rosa' | 'james' | 'patricia' | 'newagent';
```

3. Update `src/live/run-team.ts`:
```typescript
import { newagent } from './newagent.js';
const agents = [maya, david, rosa, james, patricia, newagent];
```

4. Create Slack app and add tokens to `.env`

### Removing an Agent

1. Remove from `run-team.ts` agents array
2. Delete the agent file
3. Update types if needed

## Adjusting NAICS Codes and Filters

### Agency Patterns
In `src/integrations/research-context.ts`, modify `AGENCY_PATTERNS`:

```typescript
const AGENCY_PATTERNS: Record<string, { code: string; name: string; keywords: string[] }> = {
  VA: { code: '036', name: 'Department of Veterans Affairs', keywords: ['va', 'veterans'] },
  // Add or modify agencies here
  NEWAGENCY: { code: 'XXX', name: 'New Agency Name', keywords: ['keyword1', 'keyword2'] },
};
```

### Award Monitoring Agencies
In `src/integrations/award-monitor.ts`, modify `MONITORED_AGENCIES`:

```typescript
const MONITORED_AGENCIES = [
  { code: '036', name: 'Department of Veterans Affairs', abbrev: 'VA' },
  // Add agencies to monitor
];
```

### Minimum Award Value
In `src/integrations/award-monitor.ts`:
```typescript
const MIN_AWARD_VALUE = 50000; // Change minimum contract value to report
```

### Known Competitors
In `src/integrations/research-context.ts`, modify `KNOWN_COMPETITORS`:

```typescript
const KNOWN_COMPETITORS = [
  'Booz Allen', 'Deloitte', 'SAIC',
  // Add competitors your company cares about
];
```

## Setting Bid/No-Bid Criteria

Currently, bid/no-bid logic is embedded in James's expertise. To make it data-driven:

1. Create a `bid_criteria` table:
```sql
CREATE TABLE bid_criteria (
  id UUID PRIMARY KEY,
  criterion TEXT NOT NULL,
  weight INTEGER DEFAULT 5,
  go_threshold INTEGER,
  no_go_threshold INTEGER
);
```

2. Load criteria and reference in James's prompt
3. Agents can then reference stored criteria

## Adding Custom Integrations

### New API Integration

1. Create `src/integrations/newapi.ts`:
```typescript
export async function fetchFromNewAPI(params: {...}): Promise<Result> {
  const apiKey = process.env.NEWAPI_KEY;
  const response = await fetch('https://api.example.com/...', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  return response.json();
}
```

2. Wire into research context in `src/integrations/research-context.ts`:
```typescript
import { fetchFromNewAPI } from './newapi.js';

// In gatherResearchContext:
if (shouldFetchNewAPI) {
  promises.push(
    (async () => {
      const result = await fetchFromNewAPI({...});
      context.newapi = { data: result, source: 'NewAPI' };
    })()
  );
}
```

3. Update `formatResearchContext` to include new data

4. Add API key to `.env`

## Configuring Response Behavior

### Response Delay
In `src/live/agent.ts`, modify the delay calculation:
```typescript
const baseDelay = 2000 + Math.random() * 6000; // 2-8 seconds
```

### Confidence Thresholds
Agents self-report confidence. To adjust prompting:
```
CONFIDENCE LEVELS - indicate how sure you are:
- HIGH confidence: "The solicitation says..." (official source)
- MEDIUM confidence: "Based on patterns..." (inference)
- LOW confidence: "My gut says..." (speculation)
```

### Forbidden Phrases
In `src/live/agent.ts`, the system prompt includes forbidden phrases:
```
FORBIDDEN phrases: "give me 20 minutes", "let me pull", "I'll check"...
```
Add or remove as needed.

## Environment-Specific Configuration

### Development
```bash
# Use different Slack workspace for dev
SLACK_CHANNEL_ID=C0DEV...

# Use test API keys
SAM_API_KEY=test-key
```

### Production
```bash
# Production workspace
SLACK_CHANNEL_ID=C0PROD...

# Production keys with higher rate limits
SAM_API_KEY=prod-key
```

### Feature Flags
Add feature flags to `.env`:
```bash
ENABLE_AWARD_MONITORING=true
ENABLE_COMPETITOR_INTEL=true
ENABLE_FAR_LOOKUP=true
```

Then check in code:
```typescript
if (process.env.ENABLE_FAR_LOOKUP === 'true') {
  // Enable FAR lookup
}
```

## Tuning for Different Industries

The system is built for government contracting but can be adapted:

### Healthcare Contracting
- Change NAICS codes to healthcare focus
- Add CMS, NIH-specific terminology
- Modify competitor list to healthcare companies

### Defense Contracting
- Add security clearance awareness
- ITAR/export control considerations
- Defense-specific agencies (DoD components)

### IT Services
- Focus on STARS, Alliant, CIO-SP vehicles
- Cloud/cyber certifications (FedRAMP, CMMC)
- IT modernization keywords

### Professional Services
- Management consulting focus
- Organizational change expertise
- Different contract types (T&M heavy)
