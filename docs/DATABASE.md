# AI BD Team - Database Schema

All data is stored in Supabase (PostgreSQL). The database uses the `pgvector` extension for semantic search on FAR sections.

## Tables Overview

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `message_claims` | Prevents duplicate agent responses | `message_ts` |
| `agent_memory` | Logs all agent responses | `id` (UUID) |
| `research_cache` | Caches API responses | `cache_key` |
| `user_context` | Personal info about users | `id` (UUID) |
| `conversation_memory` | Key moments to reference | `id` (UUID) |
| `inside_jokes` | Shared references over time | `id` (UUID) |
| `decision_patterns` | Go/no-go decision history | `id` (UUID) |
| `seen_awards` | Tracks reported contract awards | `contract_id` |
| `competitor_intel` | Competitive intelligence | `id` (UUID) |
| `far_sections` | FAR regulation text + embeddings | `id` (UUID) |

---

## Core Tables

### message_claims

Prevents multiple agents from responding to the same message.

```sql
CREATE TABLE message_claims (
  message_ts TEXT PRIMARY KEY,        -- Slack message timestamp
  thread_ts TEXT,                     -- Thread timestamp (if in thread)
  agent TEXT NOT NULL,                -- Agent that claimed: 'maya', 'david', etc.
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  responded BOOLEAN DEFAULT FALSE      -- Did they actually respond?
);
```

**Example Data:**
| message_ts | thread_ts | agent | claimed_at | responded |
|------------|-----------|-------|------------|-----------|
| 1706812345.123456 | 1706812300.000000 | david | 2024-02-01T15:30:00Z | true |

---

### agent_memory

Logs all agent responses for auditing and context.

```sql
CREATE TABLE agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent TEXT NOT NULL,                -- Agent name
  message_ts TEXT NOT NULL,           -- Message responded to
  thread_ts TEXT,                     -- Thread context
  response_text TEXT NOT NULL,        -- What the agent said
  sources TEXT[],                     -- Sources cited: ['FPDS', 'SAM.gov']
  confidence_level TEXT,              -- 'HIGH', 'MEDIUM', 'LOW'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agent_memory_agent ON agent_memory (agent);
CREATE INDEX idx_agent_memory_thread ON agent_memory (thread_ts);
CREATE INDEX idx_agent_memory_created ON agent_memory (created_at DESC);
```

**Example Data:**
| id | agent | message_ts | response_text | sources | confidence_level |
|----|-------|------------|---------------|---------|------------------|
| uuid... | david | 1706812345... | "The incumbent is Booz Allen with $45M over 3 years..." | {FPDS, GovConWire} | HIGH |

---

### research_cache

Caches expensive API calls to reduce costs and latency.

```sql
CREATE TABLE research_cache (
  cache_key TEXT PRIMARY KEY,         -- Unique key for this query
  source TEXT NOT NULL,               -- 'news', 'fpds', 'usaspending', etc.
  data JSONB NOT NULL,                -- Cached response data
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Cache Key Format:** `{source}:{query}:{params}`
- `news:Department of Veterans Affairs:30d`
- `fpds:036:cloud services`

**TTL:** Enforced in application code (2 hours for news, 6 hours for FPDS)

---

## Memory Tables

### user_context

Stores personal information about team members (Lapedra, Tamara) that agents can reference.

```sql
CREATE TABLE user_context (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_name TEXT NOT NULL,            -- 'lapedra', 'tamara'
  context_type TEXT NOT NULL,         -- 'personal', 'preference', 'pattern', 'family', 'mood'
  content TEXT NOT NULL,              -- What was mentioned
  mentioned_by TEXT,                  -- Which agent recorded this
  mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  still_relevant BOOLEAN DEFAULT TRUE -- Can be marked stale
);

CREATE INDEX idx_user_context_user ON user_context (user_name);
CREATE INDEX idx_user_context_relevant ON user_context (still_relevant) WHERE still_relevant = TRUE;
```

**Example Data:**
| user_name | context_type | content | mentioned_by |
|-----------|--------------|---------|--------------|
| lapedra | personal | Has a big presentation next week | patricia |
| tamara | preference | Prefers VA opportunities over DOD | james |

---

### conversation_memory

Stores key moments from conversations that agents can reference later.

```sql
CREATE TABLE conversation_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  memory_type TEXT NOT NULL,          -- 'milestone', 'decision', 'joke', 'frustration', 'win', 'loss'
  summary TEXT NOT NULL,              -- Brief description
  full_context TEXT,                  -- Full context if needed
  participants TEXT[],                -- Who was involved
  importance INTEGER DEFAULT 5,       -- 1-10 scale
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_memory_importance ON conversation_memory (importance DESC);
```

**Example Data:**
| memory_type | summary | importance |
|-------------|---------|------------|
| win | Won the VA HCD contract after 3 months of pursuit | 10 |
| decision | Passed on DOD opportunity due to timeline | 6 |

---

### inside_jokes

Tracks shared references that build team culture.

```sql
CREATE TABLE inside_jokes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference TEXT NOT NULL,            -- Short reference: "The printer incident"
  full_context TEXT NOT NULL,         -- What actually happened
  origin_story TEXT,                  -- How it started
  times_used INTEGER DEFAULT 0,       -- How often referenced
  last_used TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### decision_patterns

Tracks go/no-go decisions to learn preferences.

```sql
CREATE TABLE decision_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  decision TEXT NOT NULL,             -- 'go', 'no_go', 'passed'
  reasoning TEXT,                     -- Why
  agency TEXT,                        -- Which agency
  opportunity_type TEXT,              -- 'new', 'recompete', etc.
  key_factors TEXT[],                 -- What drove the decision
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_decision_agency ON decision_patterns (agency);
```

---

## Monitoring Tables

### seen_awards

Tracks contract awards that have been reported to avoid duplicates.

```sql
CREATE TABLE seen_awards (
  contract_id TEXT PRIMARY KEY,       -- FPDS contract ID
  vendor_name TEXT NOT NULL,
  agency_code TEXT,
  amount NUMERIC,
  seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_seen_awards_agency ON seen_awards (agency_code);
CREATE INDEX idx_seen_awards_date ON seen_awards (seen_at DESC);
```

---

### competitor_intel

Stores competitive intelligence discovered during research.

```sql
CREATE TABLE competitor_intel (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,         -- Competitor name
  agency_code TEXT,                   -- Related agency (if any)
  intel_type TEXT NOT NULL,           -- 'protest', 'performance', 'award', 'debarment', 'general'
  summary TEXT NOT NULL,              -- What was found
  source_url TEXT,                    -- Link to source
  source_name TEXT,                   -- 'GovConWire', 'FCW', etc.
  confidence TEXT DEFAULT 'MEDIUM',   -- 'HIGH', 'MEDIUM', 'LOW'
  discovered_by TEXT,                 -- Which agent found it
  still_relevant BOOLEAN DEFAULT TRUE,
  discovered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_competitor_intel_company ON competitor_intel (LOWER(company_name));
CREATE INDEX idx_competitor_intel_agency ON competitor_intel (agency_code);
CREATE INDEX idx_competitor_intel_discovered ON competitor_intel (discovered_at DESC);
CREATE INDEX idx_competitor_intel_relevant ON competitor_intel (still_relevant) WHERE still_relevant = TRUE;
```

**Example Data:**
| company_name | intel_type | summary | source_name |
|--------------|------------|---------|-------------|
| Booz Allen | protest | Lost GAO protest on VA $98M award | Washington Technology |
| Booz Allen | performance | Treasury cut ties over data breach | Federal News Network |

---

## FAR Reference Table

### far_sections

Stores FAR (Federal Acquisition Regulation) text with vector embeddings for semantic search.

```sql
CREATE TABLE far_sections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  part TEXT NOT NULL,                 -- 'Part 15'
  subpart TEXT,                       -- 'Subpart 15.3'
  section TEXT NOT NULL,              -- '15.305'
  title TEXT NOT NULL,                -- 'Proposal Evaluation'
  full_text TEXT NOT NULL,            -- Full section text
  citation TEXT NOT NULL,             -- 'FAR 15.305'
  embedding vector(1536),             -- OpenAI embedding vector
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Requires pgvector extension
CREATE INDEX idx_far_embedding ON far_sections
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_far_citation ON far_sections (citation);
CREATE INDEX idx_far_part ON far_sections (part);
```

**Semantic Search Query:**
```sql
SELECT section, title, citation, full_text
FROM far_sections
ORDER BY embedding <=> '[query_embedding]'::vector
LIMIT 5;
```

---

## Relationships Diagram

```
┌─────────────────┐     ┌─────────────────┐
│  message_claims │────▶│  agent_memory   │
│   (1 per msg)   │     │  (1+ per agent) │
└─────────────────┘     └─────────────────┘
                               │
                               │ thread_ts
                               ▼
                        ┌─────────────────┐
                        │  user_context   │
                        │ (referenced in  │
                        │    prompts)     │
                        └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│ competitor_intel│◀───▶│ research_cache  │
│  (persistent)   │     │  (temporary)    │
└─────────────────┘     └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│  seen_awards    │     │  far_sections   │
│ (deduplication) │     │ (reference)     │
└─────────────────┘     └─────────────────┘
```

---

## Maintenance

### Cleanup Queries

**Clear old cache:**
```sql
DELETE FROM research_cache
WHERE created_at < NOW() - INTERVAL '24 hours';
```

**Clear old message claims:**
```sql
DELETE FROM message_claims
WHERE claimed_at < NOW() - INTERVAL '7 days';
```

**Mark old intel as stale:**
```sql
UPDATE competitor_intel
SET still_relevant = FALSE
WHERE discovered_at < NOW() - INTERVAL '180 days';
```

### Backup Considerations

Priority tables to backup:
1. `competitor_intel` - accumulated intelligence
2. `user_context` - personal context
3. `conversation_memory` - institutional memory
4. `decision_patterns` - decision history
5. `far_sections` - takes time to regenerate embeddings

---

## Security

### Row Level Security (RLS)

All tables have RLS enabled with service_role-only access. This prevents unauthorized access via PostgREST/anon key.

**Policy pattern** (applied to all tables):
```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role has full access to table_name" ON table_name
  FOR ALL USING (auth.role() = 'service_role');
```

**Views** use `security_invoker = true` to use caller's permissions.

**Functions** have `search_path = public` set to prevent path injection attacks.

### Verify RLS Status

```sql
-- Check all tables have RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Check policies exist
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;
```

### Security Migration

If RLS is disabled on any table, run:
```sql
-- supabase/migrations/20260211_enable_rls_all_tables.sql
```
