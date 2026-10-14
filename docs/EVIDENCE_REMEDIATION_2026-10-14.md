# Evidence Remediation — 2026-10-14

## Summary

Remove three unsupported performance claims from the VA debt resolution case study that were propagating through the evidence chain into agent prompts.

## Claims Removed

| # | Claim | Reason for removal |
|---|-------|--------------------|
| 1 | "88% increase in waiver submissions" | February 2024 VHA figure — cannot be attributed to ENG-17 without further evidence |
| 2 | "95% instant approval rate for Streamlined Waiver" | No source documentation |
| 3 | "30K+ veterans helped" | Program-scale metric, not an FFTC outcome |

## What Was Kept

- "Veterans resolve debt in minutes instead of weeks" — verified, attributable outcome

## Changes Made

### Code (committed)
- `src/scripts/update-company-data.ts` — removed 3 unsupported outcomes from VA debt case study outcomes array (lines 413–418)
- `src/services/evidence/__tests__/unsupported-claims-guard.test.ts` — 14 guard tests covering seed script and migration contract

### Database (requires owner authorization)
- `supabase/migrations/20261014_evidence_remediation.sql` — surgical removal-only migration affecting 3 rows across 2 tables:
  - `case_studies` row `d9a7ca5d` — JSONB array element removal (removes 3 elements by value, preserves all others)
  - `proposal_snippets` row `23618839` — `regexp_replace` removes 2 unsupported sentences from end of content
  - `proposal_snippets` row `2dd5af3b` — `regexp_replace` removes 1 unsupported paragraph from end of content

### Migration Safety Features
- **Explicit transaction** with `BEGIN`/`COMMIT`
- **Pre-modification assertions** — aborts if any row content does not match expected pre-remediation state
- **Rollback artifact** — captures exact original values in `_evidence_remediation_rollback_20261014` table (service_role access only)
- **Post-modification assertions** — verifies claims are removed and verified outcome is preserved
- **Idempotency safety** — rerun aborts because pre-assertions check for original 4-element outcomes array
- **Commented rollback script** — restores originals only when post-remediation values still match

## Original-to-Revised Diffs

### case_studies outcomes (row d9a7ca5d)

```diff
 [
-  "88% increase in waiver submissions",
-  "95% instant approval rate for Streamlined Waiver",
   "Veterans resolve debt in minutes instead of weeks",
-  "30K+ veterans helped"
 ]
```

### proposal_snippets content (row 23618839 — Short)

```diff
 We redesigned the VA's debt resolution process so Veterans can check
 balances, request waivers, and resolve debt online in minutes instead
 of weeks. We ran co-design sessions with Veterans including those with
 PTSD and TBI, identified 66 issues in the existing form, and developed
-trauma-informed research protocols. Waiver submissions increased 88%.
-The Streamlined Waiver, a Presidential Initiative, now delivers 95%
-instant approval.
+trauma-informed research protocols.
```

### proposal_snippets content (row 2dd5af3b — Full)

```diff
 ...We connected the platform to VA's Debt Management Center, Health
 Resource Center, and VBMS. For the first time, Veterans could submit
 a form and know immediately it had been received.
-
-The Streamlined Waiver, a Presidential Initiative, offers fast-track
-debt forgiveness. Waiver submissions increased 88%. Ninety-five percent
-of qualifying Veterans now receive instant approval.
```

## Evidence for Retained Claim

| Claim | Evidence |
|-------|----------|
| "Veterans resolve debt in minutes instead of weeks" | FFTC case study page describes the before/after: paper-based multi-week process → digital same-session resolution. Attributable to FFTC design work on the VA eFSR platform. |

## Propagation Chain (Verified Clean)

```
FFTC website
  → update-company-data.ts  ← CLEANED (code change)
    → case_studies DB table  ← PENDING (SQL migration)
      → proposal_snippets    ← PENDING (SQL migration)
        → company-context.ts (reads DB at runtime)
          → James / Patricia / Maya / Jodie agent prompts
```

All hardcoded paths verified clean. Database remediation blocks the runtime path.

## Rejected Changes

### Threshold-45 Calibration (REJECTED by owner)

A dry-run assessment proposed lowering Maya's `storeWatch` threshold from 59 to 44 based on FFTC's realistic scoring ceiling of ~55. The assessment included sample classifications of pipeline opportunities as "prime fit" or "teaming fit."

**Rejection reason:** The assessment misclassified at least two opportunities:
- **HHS Data Management** — classified as prime fit, but FFTC lacks the required data management/analytics depth
- **VA Enterprise Service Desk** — classified as prime fit, but this is Tier 1 help desk work outside FFTC's core capabilities

The owner directed that threshold calibration and prime/teaming classifications require deeper analysis before implementation.

### Capability-Profile Integration (HELD)

Integration of the revised FFTC capability profile (Revision 2) into the scoring pipeline was placed on hold pending the evidence remediation and threshold calibration decisions.
