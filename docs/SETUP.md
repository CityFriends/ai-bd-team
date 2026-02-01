# AI BD Team - Setup Guide

This guide walks through setting up a complete AI BD Team installation for a new client.

## Prerequisites

### Required Software
- Node.js 18+ (LTS recommended)
- npm or yarn
- Git

### Required Accounts
- Slack workspace (admin access)
- Supabase account (free tier works)
- Anthropic API account
- SAM.gov API key
- SerpAPI account

## Step 1: Clone and Install

```bash
git clone <repository-url>
cd ai-bd-team
npm install
```

## Step 2: Create Slack Apps (5 agents)

You need to create 5 separate Slack apps, one for each agent. Repeat these steps for Maya, David, Rosa, James, and Patricia.

### 2.1 Create the App
1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: `Maya` (or the agent name)
4. Select your workspace
5. Click "Create App"

### 2.2 Configure OAuth Scopes
Go to "OAuth & Permissions" and add these Bot Token Scopes:
- `app_mentions:read` - Receive @mentions
- `channels:history` - Read channel messages
- `channels:read` - Access channel info
- `chat:write` - Send messages
- `reactions:write` - Add emoji reactions
- `users:read` - Read user info

### 2.3 Enable Socket Mode
1. Go to "Socket Mode" in sidebar
2. Enable Socket Mode
3. Create an app-level token with `connections:write` scope
4. Save the token (starts with `xapp-`)

### 2.4 Enable Events
1. Go to "Event Subscriptions"
2. Enable Events
3. Subscribe to bot events:
   - `app_mention`
   - `message.channels`

### 2.5 Install to Workspace
1. Go to "Install App"
2. Click "Install to Workspace"
3. Authorize the app
4. Copy the Bot Token (starts with `xoxb-`)

### 2.6 Get the Tokens
For each agent, you need:
- **Bot Token**: `xoxb-...` (from "OAuth & Permissions")
- **App Token**: `xapp-...` (from "Socket Mode")

### 2.7 Create the Slack Channel
1. Create a channel called `#ai-bd-team`
2. Invite all 5 agent bots to the channel
3. Copy the channel ID (from channel details or URL)

## Step 3: Set Up Supabase

### 3.1 Create Project
1. Go to https://supabase.com
2. Create a new project
3. Note your project URL and API keys

### 3.2 Enable pgvector
In the SQL Editor, run:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 3.3 Create Tables
Run the following SQL scripts in order:

**Core tables:**
```sql
-- Message claims (prevents duplicate responses)
CREATE TABLE message_claims (
  message_ts TEXT PRIMARY KEY,
  thread_ts TEXT,
  agent TEXT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  responded BOOLEAN DEFAULT FALSE
);

-- Agent memory (response logging)
CREATE TABLE agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent TEXT NOT NULL,
  message_ts TEXT NOT NULL,
  thread_ts TEXT,
  response_text TEXT NOT NULL,
  sources TEXT[],
  confidence_level TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Research cache
CREATE TABLE research_cache (
  cache_key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Memory tables:**
```sql
-- User context
CREATE TABLE user_context (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_name TEXT NOT NULL,
  context_type TEXT NOT NULL,
  content TEXT NOT NULL,
  mentioned_by TEXT,
  mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  still_relevant BOOLEAN DEFAULT TRUE
);

-- Conversation memory
CREATE TABLE conversation_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  full_context TEXT,
  participants TEXT[],
  importance INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inside jokes
CREATE TABLE inside_jokes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference TEXT NOT NULL,
  full_context TEXT NOT NULL,
  origin_story TEXT,
  times_used INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Decision patterns
CREATE TABLE decision_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  decision TEXT NOT NULL,
  reasoning TEXT,
  agency TEXT,
  opportunity_type TEXT,
  key_factors TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Award monitoring:**
```sql
-- Seen awards (prevents duplicate reports)
CREATE TABLE seen_awards (
  contract_id TEXT PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  agency_code TEXT,
  amount NUMERIC,
  seen_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Competitor intel:**
```sql
CREATE TABLE competitor_intel (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  agency_code TEXT,
  intel_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  confidence TEXT DEFAULT 'MEDIUM',
  discovered_by TEXT,
  still_relevant BOOLEAN DEFAULT TRUE,
  discovered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_competitor_intel_company ON competitor_intel (LOWER(company_name));
```

**FAR sections (for FAR lookup):**
```sql
CREATE TABLE far_sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  part TEXT NOT NULL,
  subpart TEXT,
  section TEXT NOT NULL,
  title TEXT NOT NULL,
  full_text TEXT NOT NULL,
  citation TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_far_embedding ON far_sections
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

## Step 4: Get API Keys

### SAM.gov API
1. Go to https://sam.gov/content/entity-information
2. Register for API access
3. Get your API key

### SerpAPI
1. Go to https://serpapi.com
2. Create account
3. Get your API key from dashboard

### Anthropic
1. Go to https://console.anthropic.com
2. Create account
3. Generate API key

## Step 5: Configure Environment

Create a `.env` file in the project root:

```bash
# Slack Channel
SLACK_CHANNEL_ID=C0XXXXXXXXX

# Maya (Scout)
MAYA_BOT_TOKEN=xoxb-...
MAYA_APP_TOKEN=xapp-...

# David (Analyst)
DAVID_BOT_TOKEN=xoxb-...
DAVID_APP_TOKEN=xapp-...

# Rosa (Connector)
ROSA_BOT_TOKEN=xoxb-...
ROSA_APP_TOKEN=xapp-...

# James (Strategist)
JAMES_BOT_TOKEN=xoxb-...
JAMES_APP_TOKEN=xapp-...

# Patricia (PM)
PATRICIA_BOT_TOKEN=xoxb-...
PATRICIA_APP_TOKEN=xapp-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# External APIs
SAM_API_KEY=...
SERPAPI_KEY=...
```

## Step 6: Load FAR Data (Optional)

If you want FAR lookup capability:

```bash
# Clone FAR repository
git clone https://github.com/GSA/GSA-Acquisition-FAR data/far

# Parse and load into Supabase
npm run parse-far
```

## Step 7: First Run

### Start the agents
```bash
npm run live
```

You should see:
```
═══════════════════════════════════════════════════════════
  AI BD Team - Live Mode
═══════════════════════════════════════════════════════════

Starting agents:
  - Maya (Scout)
  - David (Analyst)
  - Rosa (Connector)
  - James (Strategist)
  - Patricia (PM)

Maya: Connected as <@U0XXXXXXXX>
David: Connected as <@U0XXXXXXXX>
...

═══════════════════════════════════════════════════════════
  Team is live! Listening for messages...
═══════════════════════════════════════════════════════════
```

### Test in Slack
Go to your `#ai-bd-team` channel and try:
- `@Maya what opportunities are there at VA?`
- `@David who's the incumbent on VA IT services?`
- `@Rosa do you know anyone at Booz Allen?`

## Step 8: Optional - Award Monitoring

To enable automatic award monitoring:

```bash
# Manual check
npm run check-awards

# Scheduled (Monday & Thursday at 9am)
npm run award-scheduler
```

## Troubleshooting

### Agents not responding
1. Check that all tokens are correct in `.env`
2. Verify agents are invited to the channel
3. Check console for error messages
4. Ensure Socket Mode is enabled for each app

### API errors
1. Verify API keys are valid
2. Check rate limits haven't been exceeded
3. Look for specific error messages in console

### Database errors
1. Verify Supabase URL and key
2. Check that all tables exist
3. Ensure pgvector extension is enabled

## Running in Production

For production deployment:

1. Use a process manager like PM2:
```bash
npm install -g pm2
pm2 start npm --name "ai-bd-team" -- run live
```

2. Set up monitoring and alerting
3. Configure log rotation
4. Set up automatic restarts on failure
