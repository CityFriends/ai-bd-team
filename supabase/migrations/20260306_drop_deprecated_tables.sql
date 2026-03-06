-- Migration: Drop deprecated/unused tables
-- These tables have been replaced by newer implementations and are no longer referenced in code

-- outreach: Never referenced in codebase, placeholder for future feature
DROP TABLE IF EXISTS outreach CASCADE;

-- conversation_threads: Replaced by agent_thread_participation
DROP TABLE IF EXISTS conversation_threads CASCADE;

-- agent_queue: Replaced by agent_events (event bus)
DROP TABLE IF EXISTS agent_queue CASCADE;

-- conversation_memory: Replaced by agent_memories
DROP TABLE IF EXISTS conversation_memory CASCADE;

-- Note: These tables were empty in production and not referenced by any code
-- Verified via:
-- 1. Database scan (src/scripts/scan-database.ts) showing 0 rows
-- 2. Code search showing no references to these table names
