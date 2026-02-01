# AI BD Team - API Integrations

This document describes all external services integrated with the AI BD Team.

---

## Anthropic Claude API

### What It Provides
- AI response generation for all agents
- Natural language understanding
- Personality and expertise simulation

### How to Get Access
1. Go to https://console.anthropic.com
2. Create account and verify
3. Add payment method
4. Generate API key

### Configuration
```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### Usage in System
- **Model**: `claude-sonnet-4-20250514` (Sonnet for speed/cost balance)
- **Max tokens**: 500 per response
- **File**: `src/integrations/claude.ts`

### Rate Limits
- Tier 1: 60 requests/minute
- Tier 2+: Higher limits based on usage

### Costs (Approximate)
- Input: $3.00 per million tokens
- Output: $15.00 per million tokens
- Typical agent response: ~$0.002-0.005

---

## SAM.gov API

### What It Provides
- Federal opportunity search
- Entity registration verification
- Contract award data (limited)

### How to Get Access
1. Go to https://sam.gov
2. Create account
3. Request API key at https://open.gsa.gov/api/sam-api/
4. Wait for approval (may take days)

### Configuration
```bash
SAM_API_KEY=your-key-here
```

### Usage in System

**Opportunity Search** (`src/integrations/sam-gov.ts`)
```typescript
searchOpportunities({
  keywords: ['cloud', 'modernization'],
  agency: 'Department of Veterans Affairs',
  postedFrom: '2024-01-01',
  limit: 20
})
```

**Entity Verification** (`src/integrations/sam-entity.ts`)
```typescript
verifyRegistration('Company Name')
// Returns: UEI, CAGE, certifications, status
```

### Rate Limits
- 10,000 requests/day (standard)
- Higher limits available on request

### Costs
- Free (government API)

---

## FPDS (Federal Procurement Data System)

### What It Provides
- Contract award history
- Incumbent contractor data
- Contract modifications and values
- Vendor information

### How to Get Access
- No API key required
- Public RSS/Atom feed

### Configuration
- No environment variables needed

### Usage in System (`src/integrations/fpds.ts`)

**Search Contracts:**
```typescript
searchFPDS({
  keyword: 'Department of Veterans Affairs',
  agencyCode: '036',
  limit: 20
})
```

**Find Incumbent:**
```typescript
findIncumbent({
  agencyCode: '036',
  agencyName: 'Department of Veterans Affairs',
  keywords: ['IT services', 'cloud']
})
```

**Contract Number Lookup:**
```typescript
searchByContractNumber('36C10B18D0003')
```

### Rate Limits
- No official limits
- Be respectful (cache results)

### Costs
- Free (government data)

### Notes
- Uses RSS feed at `https://www.fpds.gov/ezsearch/FEEDS/...`
- Results are XML, parsed into structured data
- Agency codes must be exact (VA=036, HHS=075, etc.)

---

## USASpending API

### What It Provides
- Agency spending data
- Budget information
- Award amounts by fiscal year
- Contract counts

### How to Get Access
- No API key required
- Public API

### Configuration
- No environment variables needed

### Usage in System (`src/integrations/usaspending.ts`)
```typescript
getAgencySpending({
  agencyName: 'Department of Veterans Affairs'
})
// Returns: fiscal year, total obligations, contract count
```

### Rate Limits
- 1,000 requests/minute (generous)

### Costs
- Free (government data)

---

## SerpAPI (News Search)

### What It Provides
- Google News search results
- Time-filtered news
- GovCon-specific source filtering

### How to Get Access
1. Go to https://serpapi.com
2. Create account
3. Get API key from dashboard

### Configuration
```bash
SERPAPI_KEY=your-key-here
```

### Usage in System (`src/integrations/news-search.ts`)

**General News:**
```typescript
searchNews({
  query: 'Department of Veterans Affairs',
  limit: 5,
  daysBack: 30
})
```

**GovCon Sources Only:**
```typescript
searchNews({
  query: 'Booz Allen VA contract',
  limit: 5,
  daysBack: 90,
  govconOnly: true  // OrangeSlices, GovConWire, WashTech, etc.
})
```

**Competitor Intel:**
```typescript
searchCompetitorNews({
  companyName: 'Booz Allen',
  agencyName: 'Department of Veterans Affairs',
  daysBack: 180
})
// Searches for protests, performance issues, awards
```

### GovCon Sources
The system filters to these sources when `govconOnly: true`:
- orangeslices.com
- govconwire.com
- washingtontechnology.com
- federalnewsnetwork.com
- nextgov.com
- fcw.com
- executivegov.com

### Rate Limits
- Free tier: 100 searches/month
- Paid plans: 5,000+ searches/month

### Costs
- Free tier: 100 searches/month
- Developer: $75/month for 5,000 searches
- Production: $150+/month for higher volume

---

## Supabase

### What It Provides
- PostgreSQL database
- Vector search (pgvector)
- Row-level security
- Real-time subscriptions (unused currently)

### How to Get Access
1. Go to https://supabase.com
2. Create account
3. Create new project
4. Get URL and keys from Settings → API

### Configuration
```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

### Usage in System (`src/integrations/supabase.ts`)
- All CRUD operations
- Message claiming
- Memory storage
- Research caching
- FAR semantic search

### Rate Limits
- Free tier: Generous for most use cases
- Paid: Based on compute/storage

### Costs
- Free tier: 500MB database, 2 projects
- Pro: $25/month per project
- Storage and compute scale separately

---

## Slack (Bolt SDK)

### What It Provides
- Real-time message reception (Socket Mode)
- Message posting
- Emoji reactions
- Thread management

### How to Get Access
See SETUP.md for detailed Slack app creation.

### Configuration
```bash
# Per agent (5 total)
MAYA_BOT_TOKEN=xoxb-...
MAYA_APP_TOKEN=xapp-...
# ... repeat for each agent
```

### Usage in System (`src/live/agent.ts`)
- Socket Mode for real-time events
- `app_mention` event for @mentions
- `message.channels` event for thread replies
- `chat.postMessage` for responses
- `reactions.add` for emoji reactions

### Rate Limits
- Tier 1: 1 message/second per workspace
- Tier 3: 100 messages/minute per method
- Socket Mode: No specific limit

### Costs
- Free for most use cases
- Pro: $8.75/user/month (for advanced features)

---

## Integration Summary

| Service | Auth | Rate Limit | Cost | Primary Use |
|---------|------|------------|------|-------------|
| Anthropic | API Key | 60 req/min | ~$0.003/response | Response generation |
| SAM.gov | API Key | 10k/day | Free | Opportunities, entities |
| FPDS | None | Respectful | Free | Contract history |
| USASpending | None | 1k/min | Free | Agency budgets |
| SerpAPI | API Key | 100/month free | $75/5k | News search |
| Supabase | API Key | Generous | $25/month | Database |
| Slack | OAuth | 100/min | Free | Messaging |

---

## Error Handling

All integrations follow this pattern:

```typescript
try {
  const result = await apiCall();
  return result;
} catch (error) {
  console.warn(`${service} API failed:`, error);
  return fallbackValue; // Empty array, null, etc.
}
```

Agents gracefully degrade when APIs fail:
- Missing news → "I couldn't find recent news on this"
- FPDS down → "FPDS isn't responding right now"
- No data → "I don't have data on this specific query"

---

## Caching Strategy

| Data Type | Cache Duration | Reason |
|-----------|----------------|--------|
| News | 2 hours | Freshness matters |
| FPDS | 6 hours | Contracts don't change often |
| USASpending | 24 hours | Budgets are annual |
| FAR | Permanent | Rarely changes |
| Entity | 24 hours | Registration updates infrequent |
