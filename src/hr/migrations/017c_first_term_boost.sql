-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 017c: First Term Title Boost
-- ═══════════════════════════════════════════════════════════════════════════
--
-- C8X-107BS-QA: Prioritize first query term in title matching.
--
-- Problem: "PTO policy" search returns 9 pages with "Policy" in title before
-- the actual PTO page, because both "PTO" and "policy" give +30 title bonus.
--
-- Solution: Add +50 boost when the FIRST query word appears in the title.
-- Users typically put the most important/specific term first.
--
-- Expected ranking after fix:
--   "PTO policy" search:
--   - PTO page: title_or=30 + first_term=50 + ts_rank=~0.3 = ~80
--   - Social Media Policy: title_or=30 + ts_rank=~0.35 = ~30
--
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
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_policy_date DATE := hr_policy_date();
  v_tsquery_and tsquery;
  v_tsquery_or tsquery;
  v_tsquery_first tsquery;  -- First term only
  v_start_time timestamptz := clock_timestamp();
  v_result_count integer := 0;
  v_is_phrase boolean := false;
  v_query_hash text;
  v_cleaned_query text;
  v_query_words text[];
  v_first_word text;
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
    v_tsquery_or := v_tsquery_and;
    v_tsquery_first := v_tsquery_and;  -- For phrases, use full phrase
  ELSE
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

    v_tsquery_and := plainto_tsquery('english', v_cleaned_query);
    v_query_words := regexp_split_to_array(v_cleaned_query, '\s+');
    v_tsquery_or := to_tsquery('english', array_to_string(v_query_words, ' | '));

    -- Extract first word for priority matching
    v_first_word := v_query_words[1];
    IF v_first_word IS NOT NULL AND length(v_first_word) >= 2 THEN
      v_tsquery_first := plainto_tsquery('english', v_first_word);
    ELSE
      v_tsquery_first := v_tsquery_or;
    END IF;
  END IF;

  IF v_tsquery_or IS NULL THEN
    v_query_hash := encode(digest(p_query, 'sha256'), 'hex');
    INSERT INTO hr_search_analytics (user_id, query_hash, query_length, result_count, latency_ms, is_phrase_query)
    VALUES (p_user_id, v_query_hash, length(p_query), 0,
            EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::integer, v_is_phrase);
    RETURN;
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════
  -- EXECUTE SEARCH WITH FIRST-TERM PRIORITY
  -- ═══════════════════════════════════════════════════════════════════════
  --
  -- Ranking strategy (017c):
  -- 1. Title exact match (title = query): +100
  -- 2. Title contains ALL query words (AND): +50
  -- 3. Title contains FIRST query word: +50 (NEW)
  -- 4. Title contains ANY query word (OR): +30
  -- 5. Content matches ALL terms (AND): +5
  -- 6. Content/title ts_rank bonuses
  --
  -- This ensures "PTO policy" ranks "Paid Time Off (PTO)" above
  -- "Social Media Policy" because PTO contains the first term.

  RETURN QUERY
  WITH ranked_chunks AS (
    SELECT
      c.page_id,
      p.title AS page_title,
      c.content_text,
      p.notion_page_id,
      c.content_tsv,
      p.title_tsv,
      (
        -- Title exact match bonus
        CASE WHEN lower(p.title) = lower(v_cleaned_query) THEN 100.0 ELSE 0.0 END +
        -- Title contains ALL query words
        CASE WHEN p.title_tsv @@ v_tsquery_and THEN 50.0 ELSE 0.0 END +
        -- NEW: Title contains FIRST query word (priority boost)
        CASE WHEN p.title_tsv @@ v_tsquery_first THEN 50.0 ELSE 0.0 END +
        -- Title contains ANY query word
        CASE WHEN p.title_tsv @@ v_tsquery_or THEN 30.0 ELSE 0.0 END +
        COALESCE(ts_rank(p.title_tsv, v_tsquery_or) * 10.0, 0) +
        -- Content matches ALL terms
        CASE WHEN c.content_tsv @@ v_tsquery_and THEN 5.0 ELSE 0.0 END +
        -- Content match quality
        COALESCE(ts_rank(c.content_tsv, v_tsquery_or), 0)
      )::real AS relevance_score,
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
      (c.content_tsv @@ v_tsquery_or OR p.title_tsv @@ v_tsquery_or)
      AND a.revoked_at IS NULL
      AND a.valid_from <= v_policy_date
      AND (a.valid_until IS NULL OR a.valid_until >= v_policy_date)
      AND p.sync_status = 'synced'
      AND NOT p.is_excluded
      AND ar.is_active = true
      AND ar.access_classification = 'employee_safe'
  )
  SELECT
    rc.page_id,
    rc.page_title,
    ts_headline(
      'english',
      rc.content_text,
      v_tsquery_or,
      'MaxWords=30, MinWords=15, StartSel=**, StopSel=**, MaxFragments=1, FragmentDelimiter= ... '
    ) AS excerpt,
    'https://notion.so/' || replace(rc.notion_page_id::text, '-', '') AS notion_url,
    rc.relevance_score AS rank
  FROM ranked_chunks rc
  WHERE rc.chunk_rank = 1
  ORDER BY rc.relevance_score DESC
  LIMIT p_limit;

  GET DIAGNOSTICS v_result_count = ROW_COUNT;

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

REVOKE ALL ON FUNCTION hr_search_knowledge(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hr_search_knowledge(text, text, integer) TO hr_reader;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_test_results RECORD;
  v_position integer := 0;
  v_pto_position integer := 0;
  v_pto_rank real;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 017c: FIRST TERM BOOST - VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Test: "PTO policy" search (limit 5)';
  RAISE NOTICE '';

  FOR v_test_results IN
    SELECT page_title, rank
    FROM hr_search_knowledge('verify-017c', 'PTO policy', 5)
  LOOP
    v_position := v_position + 1;
    RAISE NOTICE '%: % (rank: %)', v_position, v_test_results.page_title, v_test_results.rank;

    IF v_test_results.page_title ILIKE '%PTO%' OR v_test_results.page_title ILIKE '%Paid Time Off%' THEN
      v_pto_rank := v_test_results.rank;
      v_pto_position := v_position;
    END IF;
  END LOOP;

  RAISE NOTICE '';
  IF v_pto_position = 1 THEN
    RAISE NOTICE '✓ SUCCESS: PTO page is #1 (rank: %)', v_pto_rank;
  ELSIF v_pto_position > 0 AND v_pto_position <= 3 THEN
    RAISE NOTICE '~ ACCEPTABLE: PTO page is #% (rank: %)', v_pto_position, v_pto_rank;
  ELSIF v_pto_position > 0 THEN
    RAISE NOTICE '⚠ PARTIAL: PTO page at position % (rank: %)', v_pto_position, v_pto_rank;
  ELSE
    RAISE NOTICE '✗ FAILED: PTO page not in top 5';
  END IF;

  -- Test single word
  RAISE NOTICE '';
  RAISE NOTICE 'Test: "PTO" search (should be #1)';
  v_position := 0;
  FOR v_test_results IN
    SELECT page_title, rank FROM hr_search_knowledge('verify-017c-single', 'PTO', 3)
  LOOP
    v_position := v_position + 1;
    RAISE NOTICE '  %: % (rank: %)', v_position, v_test_results.page_title, v_test_results.rank;
  END LOOP;

  -- Test policy alone
  RAISE NOTICE '';
  RAISE NOTICE 'Test: "policy" search (Policy pages expected)';
  v_position := 0;
  FOR v_test_results IN
    SELECT page_title, rank FROM hr_search_knowledge('verify-017c-policy', 'policy', 3)
  LOOP
    v_position := v_position + 1;
    RAISE NOTICE '  %: % (rank: %)', v_position, v_test_results.page_title, v_test_results.rank;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
