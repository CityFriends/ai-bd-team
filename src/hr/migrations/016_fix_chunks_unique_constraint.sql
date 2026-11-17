-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 016: Fix hr_knowledge_chunks Unique Constraint for Version Coexistence
-- ═══════════════════════════════════════════════════════════════════════════
--
-- C8X-107BI: This migration updates the unique constraint on hr_knowledge_chunks
-- to allow multiple versions of chunks for the same page, differentiated by
-- page_content_hash.
--
-- Current constraint: UNIQUE(page_id, chunk_index)
-- New constraint:     UNIQUE(page_id, chunk_index, page_content_hash)
--
-- This enables:
-- - Staging future policy versions without overwriting current chunks
-- - Date-aware retrieval selecting chunks by approved content hash
-- - Atomic version transitions (both versions exist simultaneously)
--
-- Safety: This migration is idempotent and checks constraint state before modifying.
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Check for duplicate (page_id, chunk_index, page_content_hash) combinations
DO $$
DECLARE
  v_dupe_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dupe_count
  FROM (
    SELECT page_id, chunk_index, page_content_hash
    FROM hr_knowledge_chunks
    GROUP BY page_id, chunk_index, page_content_hash
    HAVING COUNT(*) > 1
  ) dupes;

  IF v_dupe_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION BLOCKED: Found % duplicate (page_id, chunk_index, page_content_hash) combinations. Clean up duplicates before proceeding.', v_dupe_count;
  END IF;

  RAISE NOTICE 'No duplicates found - safe to update constraint';
END
$$;

-- Step 2: Check and update the unique constraint
DO $$
DECLARE
  v_constraint_name TEXT;
  v_constraint_def TEXT;
BEGIN
  -- Find the existing unique constraint on (page_id, chunk_index)
  SELECT con.conname, pg_get_constraintdef(con.oid)
  INTO v_constraint_name, v_constraint_def
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'hr_knowledge_chunks'
    AND n.nspname = 'public'
    AND con.contype = 'u';

  IF v_constraint_name IS NULL THEN
    RAISE NOTICE 'No unique constraint found on hr_knowledge_chunks - creating new one';

    ALTER TABLE hr_knowledge_chunks
    ADD CONSTRAINT hr_knowledge_chunks_page_chunk_hash_key
    UNIQUE (page_id, chunk_index, page_content_hash);

  ELSIF v_constraint_def LIKE '%page_content_hash%' THEN
    RAISE NOTICE 'Constraint already includes page_content_hash - no action needed';

  ELSE
    RAISE NOTICE 'Updating constraint % to include page_content_hash', v_constraint_name;

    -- Drop the old constraint
    EXECUTE format('ALTER TABLE hr_knowledge_chunks DROP CONSTRAINT %I', v_constraint_name);

    -- Create new constraint with page_content_hash
    ALTER TABLE hr_knowledge_chunks
    ADD CONSTRAINT hr_knowledge_chunks_page_chunk_hash_key
    UNIQUE (page_id, chunk_index, page_content_hash);

    RAISE NOTICE 'Constraint updated successfully';
  END IF;
END
$$;

-- Step 3: Verify the constraint
DO $$
DECLARE
  v_constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(con.oid)
  INTO v_constraint_def
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'hr_knowledge_chunks'
    AND n.nspname = 'public'
    AND con.contype = 'u';

  IF v_constraint_def LIKE '%page_content_hash%' THEN
    RAISE NOTICE 'VERIFICATION PASSED: Constraint includes page_content_hash';
  ELSE
    RAISE EXCEPTION 'VERIFICATION FAILED: Constraint does not include page_content_hash. Got: %', v_constraint_def;
  END IF;
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION 016
-- ═══════════════════════════════════════════════════════════════════════════
