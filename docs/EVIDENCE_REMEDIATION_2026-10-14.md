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
- `src/services/evidence/__tests__/unsupported-claims-guard.test.ts` — 4 guard tests preventing re-introduction

### Database (requires authorization)
- `supabase/migrations/20261014_evidence_remediation.sql` — 3 UPDATE statements affecting:
  - `case_studies` row `d9a7ca5d-cd41-4f81-ae21-b8355525eb4c` (outcomes array)
  - `proposal_snippets` row `23618839-647b-4d14-a681-681499f2045b` (content text)
  - `proposal_snippets` row `2dd5af3b-c2e2-4d20-8884-73b85371825a` (content text)

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
