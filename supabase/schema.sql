-- BD Team AI Agents Database Schema
-- Run this in your Supabase SQL editor

-- Opportunities from SAM.gov
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sam_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  agency TEXT,
  office TEXT,
  type TEXT, -- RFI, RFQ, RFP, Sources Sought
  naics_codes TEXT[],
  posted_date DATE,
  due_date DATE,
  est_value TEXT,
  description TEXT,
  sam_url TEXT,
  attachments JSONB DEFAULT '[]',

  -- Scout's analysis
  fit_score INTEGER,
  fit_reasoning TEXT,
  keywords_matched TEXT[],

  -- Status
  status TEXT DEFAULT 'new', -- new, researching, pursuing, passed, submitted, won, lost
  decision TEXT, -- go, no_go, pending
  decision_date TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agency intelligence
CREATE TABLE IF NOT EXISTS agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  abbreviation TEXT UNIQUE,
  key_offices TEXT,
  tech_stack TEXT,
  pain_points TEXT,
  key_personnel JSONB DEFAULT '[]',
  our_history TEXT,
  research_notes TEXT,
  last_researched TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teaming partners
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  duns TEXT,
  cage_code TEXT,
  sam_uei TEXT,
  website TEXT,
  size TEXT, -- small, large
  certifications TEXT[], -- 8a, WOSB, SDVOSB, HUBZone
  naics_codes TEXT[],
  capabilities TEXT,
  past_agencies TEXT[],
  primary_contact JSONB,
  relationship_status TEXT DEFAULT 'none', -- none, researched, contacted, met, teamed
  relationship_notes TEXT,
  last_contact_date DATE,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Outreach tracking
CREATE TABLE IF NOT EXISTS outreach (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  opportunity_id UUID REFERENCES opportunities(id),
  email_subject TEXT,
  email_draft TEXT,
  email_approved BOOLEAN DEFAULT FALSE,
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_date TIMESTAMPTZ,
  response_received BOOLEAN DEFAULT FALSE,
  response_summary TEXT,
  status TEXT DEFAULT 'draft', -- draft, approved, sent, responded, meeting, declined, agreed
  next_step TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation threads (for agent coordination)
CREATE TABLE IF NOT EXISTS conversation_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_thread_ts TEXT,
  slack_channel TEXT,
  opportunity_id UUID REFERENCES opportunities(id),
  topic TEXT, -- opportunity_review, partner_search, capture_planning, standup
  status TEXT DEFAULT 'active', -- active, resolved, stale
  agents_involved TEXT[],
  awaiting_response_from TEXT, -- lapedra, scout, analyst, etc.
  context_summary TEXT,
  key_decisions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent task queue (coordination + delays)
CREATE TABLE IF NOT EXISTS agent_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  opportunity_id UUID REFERENCES opportunities(id),
  thread_ts TEXT,
  payload JSONB DEFAULT '{}',
  scheduled_for TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed, cancelled
  result JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_due_date ON opportunities(due_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_sam_id ON opportunities(sam_id);
CREATE INDEX IF NOT EXISTS idx_agent_queue_status ON agent_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_agent_queue_agent ON agent_queue(agent);
CREATE INDEX IF NOT EXISTS idx_threads_opportunity ON conversation_threads(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_threads_slack_ts ON conversation_threads(slack_thread_ts);
CREATE INDEX IF NOT EXISTS idx_companies_naics ON companies USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_outreach_opportunity ON outreach(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_outreach_company ON outreach(company_id);

-- Enable Row Level Security (optional, but recommended)
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;

-- Create policies to allow service role full access
CREATE POLICY "Service role has full access to opportunities" ON opportunities
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to agencies" ON agencies
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to companies" ON companies
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to outreach" ON outreach
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to conversation_threads" ON conversation_threads
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role has full access to agent_queue" ON agent_queue
  FOR ALL USING (auth.role() = 'service_role');

-- Agent memory for tracking sources and confidence (auditing)
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  message_ts TEXT,
  thread_ts TEXT,
  response_text TEXT NOT NULL,
  sources TEXT[] DEFAULT '{}',
  confidence_level TEXT NOT NULL, -- HIGH, MEDIUM, LOW
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for agent_memory
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent ON agent_memory(agent);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created ON agent_memory(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_memory_confidence ON agent_memory(confidence_level);

-- RLS for agent_memory
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_memory" ON agent_memory
  FOR ALL USING (auth.role() = 'service_role');

-- Research cache for external API results (FPDS, USASpending, SAM, News)
CREATE TABLE IF NOT EXISTS research_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL, -- fpds, usaspending, sam-entity, news
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for research_cache
CREATE INDEX IF NOT EXISTS idx_research_cache_key ON research_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_research_cache_source ON research_cache(source);
CREATE INDEX IF NOT EXISTS idx_research_cache_created ON research_cache(created_at);

-- RLS for research_cache
ALTER TABLE research_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to research_cache" ON research_cache
  FOR ALL USING (auth.role() = 'service_role');

-- Message coordination (prevent multiple agents responding to same message)
CREATE TABLE IF NOT EXISTS message_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_ts TEXT NOT NULL,
  thread_ts TEXT,
  agent TEXT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  responded BOOLEAN DEFAULT FALSE,
  UNIQUE(message_ts) -- Only one agent can claim a message
);

-- Indexes for message_claims
CREATE INDEX IF NOT EXISTS idx_message_claims_ts ON message_claims(message_ts);
CREATE INDEX IF NOT EXISTS idx_message_claims_thread ON message_claims(thread_ts);
CREATE INDEX IF NOT EXISTS idx_message_claims_claimed ON message_claims(claimed_at);

-- RLS for message_claims
ALTER TABLE message_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to message_claims" ON message_claims
  FOR ALL USING (auth.role() = 'service_role');

-- Auto-cleanup old claims (messages older than 1 hour)
-- Run this periodically or set up a cron job
-- DELETE FROM message_claims WHERE claimed_at < NOW() - INTERVAL '1 hour';

-- ============================================
-- ADVANCED CONVERSATIONAL MEMORY
-- ============================================

-- Personal context about Lapedra and Tamara (things they share about their lives)
CREATE TABLE IF NOT EXISTS user_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name TEXT NOT NULL, -- 'lapedra' or 'tamara'
  context_type TEXT NOT NULL, -- 'personal', 'preference', 'pattern', 'family', 'mood'
  content TEXT NOT NULL, -- what was shared
  mentioned_by TEXT, -- which agent heard this
  mentioned_at TIMESTAMPTZ DEFAULT NOW(),
  still_relevant BOOLEAN DEFAULT TRUE,
  expires_at TIMESTAMPTZ -- optional expiry for temporary context
);

CREATE INDEX IF NOT EXISTS idx_user_context_user ON user_context(user_name);
CREATE INDEX IF NOT EXISTS idx_user_context_type ON user_context(context_type);

-- Decision patterns (what gets go/no-go and why)
CREATE TABLE IF NOT EXISTS decision_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision TEXT NOT NULL, -- 'go', 'no_go', 'passed'
  reasoning TEXT,
  agency TEXT,
  opportunity_type TEXT,
  key_factors TEXT[], -- what drove the decision
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_patterns_decision ON decision_patterns(decision);

-- Conversation memory (key moments to reference later)
CREATE TABLE IF NOT EXISTS conversation_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_type TEXT NOT NULL, -- 'milestone', 'decision', 'joke', 'frustration', 'win', 'loss'
  summary TEXT NOT NULL, -- short description
  full_context TEXT, -- longer context if needed
  participants TEXT[], -- who was involved
  thread_ts TEXT,
  importance INTEGER DEFAULT 5, -- 1-10, higher = more likely to reference
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_type ON conversation_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_importance ON conversation_memory(importance DESC);

-- Inside jokes and shared references
CREATE TABLE IF NOT EXISTS inside_jokes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL, -- the shorthand reference
  full_context TEXT NOT NULL, -- what it actually means
  origin_story TEXT, -- how it started
  times_used INTEGER DEFAULT 1,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inside_jokes_used ON inside_jokes(times_used DESC);

-- Agent availability (realistic schedules)
CREATE TABLE IF NOT EXISTS agent_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent TEXT NOT NULL,
  status TEXT NOT NULL, -- 'available', 'busy', 'away', 'offline'
  reason TEXT, -- 'dentist appointment', 'kid thing', 'heads down on something'
  until_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_agent ON agent_availability(agent);

-- RLS policies
ALTER TABLE user_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inside_jokes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to user_context" ON user_context
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to decision_patterns" ON decision_patterns
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to conversation_memory" ON conversation_memory
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to inside_jokes" ON inside_jokes
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role has full access to agent_availability" ON agent_availability
  FOR ALL USING (auth.role() = 'service_role');
