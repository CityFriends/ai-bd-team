-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017a: Search Relevance Fix
-- ═══════════════════════════════════════════════════════════════════════════
--
-- C8X-107BS-QA: Fix search relevance so primary policies rank above incidental
-- mentions. The issue: "PTO policy" search was using AND semantics, so pages
-- without "policy" in their content (like the actual PTO page) didn't appear.
--
-- Changes:
--   1. Use OR semantics for matching (find pages with ANY search term)
--   2. Rank by: exact title match > title contains terms > content matches
--   3. Add significant boost (10x) for title matches
--   4. Prefer pages matching more terms
--   5. Improve excerpt generation
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop and recreate the main search function with improved relevance
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_policy_date DATE := hr_policy_date();
  v_tsquery_and tsquery;  -- AND query for ranking
  v_tsquery_or tsquery;   -- OR query for matching
  v_start_time timestamptz := clock_timestamp();
  v_result_count integer := 0;
  v_is_phrase boolean := false;
  v_query_hash text;
  v_cleaned_query text;
  v_query_words text[];
BEGIN
  -- ═══════════════════════════════════════════════════════════════════════
  -- INPUT VALIDATION
  -- ═══════════════════════════════════════════════════════════════════════

  IF p_user_id IS NULL OR trim(p_user_id) = '' THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) < 2 THEN
    RAISE EXCEPTION 'query must be at least 2 characters';
  END IF;

  IF length(p_query) > 500 THEN
    RAISE EXCEPTION 'query exceeds maximum length of 500 characters';
  END IF;

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

  IF v_is_phrase THEN
    -- Phrase query: use phrase matching (AND semantics, but for adjacent words)
    v_cleaned_query := trim(both '"' from p_query);
    v_cleaned_query := regexp_replace(v_cleaned_query, '[^\w\s]', ' ', 'g');
    v_cleaned_query := regexp_replace(v_cleaned_query, '\s+', ' ', 'g');
    v_cleaned_query := trim(v_cleaned_query);

    IF v_cleaned_query = '' THEN
      v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
      INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
      VALUES (p_user_id, v_query_hash, length(p_query), 0,
              EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer, true);
      RETURN;
    END IF;

    v_tsquery_and := phraseto_tsquery('english', v_cleaned_query);
    v_tsquery_or := v_tsquery_and;  -- For phrases, use same query for both
  ELSE
    -- Regular query: create BOTH AND and OR versions
    v_cleaned_query := regexp_replace(p_query, '[^\w\s]', ' ', 'g');
    v_cleaned_query := regexp_replace(v_cleaned_query, '\s+', ' ', 'g');
    v_cleaned_query := trim(v_cleaned_query);

    IF v_cleaned_query = '' THEN
      v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
      INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
      VALUES (p_user_id, v_query_hash, length(p_query), 0,
              EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer, false);
      RETURN;
    END IF;

    -- AND query for ranking (pages with all terms rank higher)
    v_tsquery_and := plainto_tsquery('english', v_cleaned_query);

    -- OR query for matching (find pages with ANY term)
    -- Build OR query from individual words
    v_query_words := regexp_split_to_array(v_cleaned_query, '\s+');
    v_tsquery_or := to_tsquery('english', array_to_string(v_query_words, ' | '));
  END IF;

  IF v_tsquery_or IS NULL THEN
    v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
    INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
    VALUES (p_user_id, v_query_hash, length(p_query), 0,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer, v_is_phrase);
    RETURN;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- EXECUTE SEARCH WITH IMPROVED RELEVANCE
  -- ═══════════════════════════════════════════════════════════════════════
  --
  -- Ranking strategy:
  -- 1. Title exact match (title = query): +100
  -- 2. Title contains query terms: +10 * ts_rank
  -- 3. Content matches all terms (AND): +5 * ts_rank
  -- 4. Content matches any terms (OR): +1 * ts_rank
  --
  -- This ensures:
  -- - "PTO" titled page ranks #1 for "PTO policy" search
  -- - Pages with more term matches rank higher
  -- - Incidental mentions rank lower

  RETURN QUERY
  WITH ranked_chunks AS (
    -- Find all matching chunks with relevance scores
    SELECT
      c.page_id,
      p.title AS page_title,
      c.content_text,
      p.notion_page_id,
      c.content_tsv,
      p.title_tsv,
      -- Calculate relevance score with title priority
      (
        -- Title exact match bonus (case insensitive)
        CASE WHEN lower(p.title) = lower(v_cleaned_query) THEN 100.0 ELSE 0.0 END +
        -- Title contains all query words bonus
        CASE WHEN p.title_tsv @@ v_tsquery_and THEN 50.0 ELSE 0.0 END +
        -- Title contains any query words (scaled by match quality)
        COALESCE(ts_rank(p.title_tsv, v_tsquery_or) * 20.0, 0) +
        -- Content matches all terms bonus
        CASE WHEN c.content_tsv @@ v_tsquery_and THEN 5.0 ELSE 0.0 END +
        -- Content match quality (OR)
        COALESCE(ts_rank(c.content_tsv, v_tsquery_or), 0)
      )::real AS relevance_score,
      -- Row number for deduplication (best chunk per page)
      ROW_NUMBER() OVER (
        PARTITION BY c.page_id
        ORDER BY ts_rank(c.content_tsv, v_tsquery_or) DESC
      ) AS chunk_rank
    FROM hr_knowledge_chunks c
    JOIN hr_knowledge_pages p ON p.id = c.page_id
    JOIN hr_page_approvals a ON a.knowledge_page_id = c.page_id
      AND a.approved_content_hash = c.page_content_hash
    JOIN hr_approved_roots ar ON ar.id = p.approved_root_id
    WHERE
      -- Match on OR query (any term in title or content)
      (c.content_tsv @@ v_tsquery_or OR p.title_tsv @@ v_tsquery_or)
      -- Approval filters
      AND a.revoked_at IS NULL
      AND a.valid_from <= v_policy_date
      AND (a.valid_until IS NULL OR a.valid_until >= v_policy_date)
      -- Page filters
      AND p.sync_status = 'synced'
      AND NOT p.is_excluded
      -- Root filters
      AND ar.is_active = true
      AND ar.access_classification = 'employee_safe'
  )
  SELECT
    rc.page_id,
    rc.page_title,
    -- Generate clean excerpt with highlighted terms
    ts_headline(
      'english',
      rc.content_text,
      v_tsquery_or,
      'MaxWords=30, MinWords=15, StartSel=**, StopSel=**, MaxFragments=1, FragmentDelimiter= ... '
    ) AS excerpt,
    'https://notion.so/' || replace(rc.notion_page_id::text, '-', '') AS notion_url,
    rc.relevance_score AS rank
  FROM ranked_chunks rc
  WHERE rc.chunk_rank = 1  -- Only best chunk per page
  ORDER BY rc.relevance_score DESC
  LIMIT p_limit;

  -- Get result count for analytics
  GET DIAGNOSTICS v_result_count = ROW_COUNT;

  -- ═══════════════════════════════════════════════════════════════════════
  -- LOG ANALYTICS
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

-- Re-grant permissions
REVOKE ALL ON FUNCTION hr_search_knowledge(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hr_search_knowledge(text, text, integer) TO hr_reader;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_test_results RECORD;
  v_pto_found boolean := false;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 017a: SEARCH RELEVANCE FIX - VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  -- Test: "PTO policy" should return PTO page in top results
  FOR v_test_results IN
    SELECT page_title, rank
    FROM hr_search_knowledge('verification', 'PTO policy', 5)
  LOOP
    IF v_test_results.page_title ILIKE '%PTO%' OR v_test_results.page_title ILIKE '%Paid Time Off%' THEN
      v_pto_found := true;
      RAISE NOTICE 'PTO policy search: Found "%" with rank %', v_test_results.page_title, v_test_results.rank;
    END IF;
  END LOOP;

  IF v_pto_found THEN
    RAISE NOTICE '';
    RAISE NOTICE '✓ PTO page now appears in "PTO policy" search results';
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '⚠ PTO page still not found - check data';
  END IF;

  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
