-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017: HR Knowledge Keyword Search
-- ═══════════════════════════════════════════════════════════════════════════
--
-- C8X-107BQ: Implements Guru-style keyword search across approved HR content.
--
-- Features:
--   1. Full-text search with GIN indexing
--   2. Title weighting (titles rank higher than body content)
--   3. Date-aware filtering (only currently effective approvals)
--   4. Page-level deduplication (best chunk per page)
--   5. Phrase query support
--   6. Privacy-conscious analytics
--
-- Security:
--   - SECURITY DEFINER with fixed search_path
--   - Minimal EXECUTE grants (hr_reader only)
--   - Reuses existing approval/access control rules
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Add tsvector columns for full-text search
-- ═══════════════════════════════════════════════════════════════════════════

-- Add generated tsvector column to chunks table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hr_knowledge_chunks'
      AND column_name = 'content_tsv'
  ) THEN
    ALTER TABLE hr_knowledge_chunks
    ADD COLUMN content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content_text)) STORED;

    RAISE NOTICE 'Added content_tsv column to hr_knowledge_chunks';
  ELSE
    RAISE NOTICE 'content_tsv column already exists';
  END IF;
END $$;

-- Add tsvector column to pages table for title search
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'hr_knowledge_pages'
      AND column_name = 'title_tsv'
  ) THEN
    ALTER TABLE hr_knowledge_pages
    ADD COLUMN title_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', title)) STORED;

    RAISE NOTICE 'Added title_tsv column to hr_knowledge_pages';
  ELSE
    RAISE NOTICE 'title_tsv column already exists';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Create GIN indexes for fast search
-- ═══════════════════════════════════════════════════════════════════════════

-- Index on chunk content
CREATE INDEX IF NOT EXISTS idx_hr_chunks_content_tsv
ON hr_knowledge_chunks USING GIN (content_tsv);

-- Index on page title
CREATE INDEX IF NOT EXISTS idx_hr_pages_title_tsv
ON hr_knowledge_pages USING GIN (title_tsv);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Create search analytics table (privacy-conscious)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_search_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  searched_at timestamptz NOT NULL DEFAULT NOW(),
  user_id text NOT NULL,              -- Slack user ID
  query_hash text NOT NULL,           -- SHA-256 of query (not raw query)
  query_length integer NOT NULL,
  result_count integer NOT NULL,
  latency_ms integer NOT NULL,
  is_phrase_query boolean NOT NULL DEFAULT false,

  -- Constraints
  CONSTRAINT chk_query_length CHECK (query_length >= 0 AND query_length <= 500),
  CONSTRAINT chk_result_count CHECK (result_count >= 0),
  CONSTRAINT chk_latency CHECK (latency_ms >= 0)
);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_hr_search_analytics_time
ON hr_search_analytics (searched_at DESC);

CREATE INDEX IF NOT EXISTS idx_hr_search_analytics_user
ON hr_search_analytics (user_id, searched_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create rate limiting table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_search_rate_limits (
  user_id text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT NOW(),
  request_count integer NOT NULL DEFAULT 1,

  CONSTRAINT chk_request_count CHECK (request_count >= 0)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Create helper function for safe tsquery parsing
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing function if it exists (for idempotency)
DROP FUNCTION IF EXISTS hr_safe_tsquery(text);

CREATE OR REPLACE FUNCTION hr_safe_tsquery(p_query text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cleaned text;
  v_result tsquery;
BEGIN
  -- Null/empty check
  IF p_query IS NULL OR trim(p_query) = '' THEN
    RETURN NULL;
  END IF;

  -- Check for phrase query (quoted)
  IF p_query ~ '^".*"$' THEN
    -- Phrase query: use phraseto_tsquery
    v_cleaned := trim(both '"' from p_query);
    v_cleaned := regexp_replace(v_cleaned, '[^\w\s]', ' ', 'g');
    v_cleaned := regexp_replace(v_cleaned, '\s+', ' ', 'g');
    v_cleaned := trim(v_cleaned);

    IF v_cleaned = '' THEN
      RETURN NULL;
    END IF;

    v_result := phraseto_tsquery('english', v_cleaned);
  ELSE
    -- Regular query: use plainto_tsquery
    v_cleaned := regexp_replace(p_query, '[^\w\s]', ' ', 'g');
    v_cleaned := regexp_replace(v_cleaned, '\s+', ' ', 'g');
    v_cleaned := trim(v_cleaned);

    IF v_cleaned = '' THEN
      RETURN NULL;
    END IF;

    v_result := plainto_tsquery('english', v_cleaned);
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    -- On any parsing error, return NULL (safe fallback)
    RETURN NULL;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Create rate limiting function
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS hr_check_search_rate_limit(text, integer, integer);

CREATE OR REPLACE FUNCTION hr_check_search_rate_limit(
  p_user_id text,
  p_max_requests integer DEFAULT 10,
  p_window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_request_count integer;
  v_now timestamptz := NOW();
BEGIN
  -- Get or create rate limit record
  SELECT window_start, request_count
  INTO v_window_start, v_request_count
  FROM hr_search_rate_limits
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    -- First request from this user
    INSERT INTO hr_search_rate_limits (user_id, window_start, request_count)
    VALUES (p_user_id, v_now, 1);
    RETURN true;
  END IF;

  -- Check if window has expired
  IF v_now - v_window_start > make_interval(secs => p_window_seconds) THEN
    -- Reset window
    UPDATE hr_search_rate_limits
    SET window_start = v_now, request_count = 1
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;

  -- Check if under limit
  IF v_request_count < p_max_requests THEN
    -- Increment counter
    UPDATE hr_search_rate_limits
    SET request_count = request_count + 1
    WHERE user_id = p_user_id;
    RETURN true;
  END IF;

  -- Rate limited
  RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Create main search function
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS hr_search_knowledge(text, text, integer);

CREATE OR REPLACE FUNCTION hr_search_knowledge(
  p_user_id text,
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  page_id uuid,
  page_title text,
  excerpt text,
  notion_url text,
  rank real
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_policy_date DATE := hr_policy_date();
  v_tsquery tsquery;
  v_start_time timestamptz := clock_timestamp();
  v_result_count integer := 0;
  v_is_phrase boolean := false;
  v_query_hash text;
BEGIN
  -- ═══════════════════════════════════════════════════════════════════════
  -- INPUT VALIDATION
  -- ═══════════════════════════════════════════════════════════════════════

  -- Check user_id
  IF p_user_id IS NULL OR trim(p_user_id) = '' THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  -- Check query length
  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION 'query must be at least 2 characters';
  END IF;

  IF length(p_query) > 500 THEN
    RAISE EXCEPTION 'query exceeds maximum length of 500 characters';
  END IF;

  -- Enforce limit
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 5;
  ELSIF p_limit > 20 THEN
    p_limit := 20;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- RATE LIMITING
  -- ═══════════════════════════════════════════════════════════════════════

  IF NOT hr_check_search_rate_limit(p_user_id, 10, 60) THEN
    RAISE EXCEPTION 'rate limit exceeded (max 10 searches per minute)';
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- PARSE QUERY
  -- ═══════════════════════════════════════════════════════════════════════

  v_is_phrase := p_query ~ '^".*"$';
  v_tsquery := hr_safe_tsquery(p_query);

  IF v_tsquery IS NULL THEN
    -- Log zero-result for empty/invalid query
    v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
    INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
    VALUES (p_user_id, v_query_hash, length(p_query), 0,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer, v_is_phrase);
    RETURN;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- EXECUTE SEARCH
  -- ═══════════════════════════════════════════════════════════════════════

  -- Search with:
  -- 1. Date-aware approval filtering (reuses hr_policy_date)
  -- 2. Active root filtering
  -- 3. Employee-safe access control
  -- 4. Page-level deduplication (best chunk per page)
  -- 5. Title weighting (title matches rank 2x higher)

  RETURN QUERY
  WITH ranked_chunks AS (
    SELECT
      c.page_id,
      p.title AS page_title,
      c.content_text,
      p.notion_page_id,
      -- Combined rank: title match (weight 2) + content match (weight 1)
      (
        COALESCE(ts_rank(p.title_tsv, v_tsquery) * 2.0, 0) +
        ts_rank(c.content_tsv, v_tsquery)
      ) AS combined_rank,
      -- Row number for deduplication (best chunk per page)
      ROW_NUMBER() OVER (
        PARTITION BY c.page_id
        ORDER BY ts_rank(c.content_tsv, v_tsquery) DESC
      ) AS chunk_rank
    FROM hr_knowledge_chunks c
    JOIN hr_knowledge_pages p ON p.id = c.page_id
    JOIN hr_page_approvals a ON a.knowledge_page_id = c.page_id
      AND a.approved_content_hash = c.page_content_hash
    JOIN hr_approved_roots ar ON ar.id = p.approved_root_id
    WHERE
      -- Content matches query
      (c.content_tsv @@ v_tsquery OR p.title_tsv @@ v_tsquery)
      -- Approval is not revoked
      AND a.revoked_at IS NULL
      -- Approval is currently effective (date-aware)
      AND a.valid_from <= v_policy_date
      AND (a.valid_until IS NULL OR a.valid_until >= v_policy_date)
      -- Page is synced and not excluded
      AND p.sync_status = 'synced'
      AND NOT p.is_excluded
      -- Root is active and employee-safe
      AND ar.is_active = true
      AND ar.access_classification = 'employee_safe'
  )
  SELECT
    rc.page_id,
    rc.page_title,
    -- Generate excerpt with highlighted terms
    ts_headline(
      'english',
      rc.content_text,
      v_tsquery,
      'MaxWords=35, MinWords=15, StartSel=*, StopSel=*, MaxFragments=1'
    ) AS excerpt,
    -- Direct Notion URL
    'https://notion.so/' || replace(rc.notion_page_id::text, '-', '') AS notion_url,
    rc.combined_rank AS rank
  FROM ranked_chunks rc
  WHERE rc.chunk_rank = 1  -- Only best chunk per page
  ORDER BY rc.combined_rank DESC
  LIMIT p_limit;

  -- Get result count for analytics
  GET DIAGNOSTICS v_result_count = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════════════
  -- LOG ANALYTICS (privacy-conscious)
  -- ═══════════════════════════════════════════════════════════════════════

  v_query_hash := encode(digest(p_query, 'sha256'), 'hex');

  INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
  VALUES (
    p_user_id,
    v_query_hash,
    length(p_query),
    v_result_count,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer,
    v_is_phrase
  );

END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8: Grant permissions
-- ═══════════════════════════════════════════════════════════════════════════

-- Revoke default PUBLIC execute (security hardening)
REVOKE ALL ON FUNCTION hr_safe_tsquery(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hr_check_search_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION hr_search_knowledge(text, text, integer) FROM PUBLIC;

-- Grant execute only to hr_reader role
GRANT EXECUTE ON FUNCTION hr_search_knowledge(text, text, integer) TO hr_reader;

-- Grant necessary table permissions for the functions
GRANT SELECT ON hr_knowledge_chunks TO hr_reader;
GRANT SELECT ON hr_knowledge_pages TO hr_reader;
GRANT SELECT ON hr_page_approvals TO hr_reader;
GRANT SELECT ON hr_approved_roots TO hr_reader;

-- Rate limit and analytics tables (function uses SECURITY DEFINER)
-- No direct grants needed - accessed via SECURITY DEFINER functions

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 9: Create analytics query function (for admin use)
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS hr_search_analytics_summary(integer);

CREATE OR REPLACE FUNCTION hr_search_analytics_summary(p_days integer DEFAULT 7)
RETURNS TABLE (
  total_searches bigint,
  unique_users bigint,
  avg_latency_ms numeric,
  zero_result_count bigint,
  zero_result_pct numeric,
  phrase_query_count bigint,
  avg_result_count numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*) AS total_searches,
    COUNT(DISTINCT user_id) AS unique_users,
    ROUND(AVG(latency_ms), 2) AS avg_latency_ms,
    COUNT(*) FILTER (WHERE result_count = 0) AS zero_result_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE result_count = 0) / NULLIF(COUNT(*), 0), 2) AS zero_result_pct,
    COUNT(*) FILTER (WHERE is_phrase_query) AS phrase_query_count,
    ROUND(AVG(result_count), 2) AS avg_result_count
  FROM hr_search_analytics
  WHERE searched_at >= NOW() - make_interval(days => p_days);
$$;

-- Only allow service_role to view analytics
REVOKE ALL ON FUNCTION hr_search_analytics_summary(integer) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 10: Verification
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_has_content_tsv boolean;
  v_has_title_tsv boolean;
  v_has_content_idx boolean;
  v_has_title_idx boolean;
  v_has_search_fn boolean;
BEGIN
  -- Check columns
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hr_knowledge_chunks' AND column_name = 'content_tsv'
  ) INTO v_has_content_tsv;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hr_knowledge_pages' AND column_name = 'title_tsv'
  ) INTO v_has_title_tsv;

  -- Check indexes
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hr_chunks_content_tsv'
  ) INTO v_has_content_idx;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hr_pages_title_tsv'
  ) INTO v_has_title_idx;

  -- Check function
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_name = 'hr_search_knowledge' AND routine_schema = 'public'
  ) INTO v_has_search_fn;

  -- Report
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 017 VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'content_tsv column:    %', CASE WHEN v_has_content_tsv THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'title_tsv column:      %', CASE WHEN v_has_title_tsv THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'Content GIN index:     %', CASE WHEN v_has_content_idx THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'Title GIN index:       %', CASE WHEN v_has_title_idx THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE 'hr_search_knowledge:   %', CASE WHEN v_has_search_fn THEN 'OK' ELSE 'MISSING' END;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  IF NOT (v_has_content_tsv AND v_has_title_tsv AND v_has_content_idx AND v_has_title_idx AND v_has_search_fn) THEN
    RAISE EXCEPTION 'Migration 017 verification failed';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 017
-- ═══════════════════════════════════════════════════════════════════════════
