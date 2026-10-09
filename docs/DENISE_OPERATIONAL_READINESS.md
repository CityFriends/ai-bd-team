# Denise Operational Readiness — Milestone D Phase 1

**Status:** Documentation only. NOT ACTIVATED.
**Baseline:** f773564
**Date:** 2026-10-09

## 1. Controlled Real-Slack Smoke-Test Procedure

### Prerequisites
- DENISE_SLACK_ENABLED=false (default — remains off until explicit activation)
- Commissioning Supabase instance verified (not production)
- Test workspace and channel configured

### Steps
1. Set env: `SLACK_TEAM_ID=<test-workspace-id>`, `SLACK_CHANNEL_ID=<test-channel-id>`
2. Set `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN` to test-workspace credentials
3. Start the team with `npx tsx src/live/run-team.ts`
4. Verify console output: "Denise action handlers registered (gated on DENISE_SLACK_ENABLED)"
5. Set `DENISE_SLACK_ENABLED=true` (requires restart or dynamic flag update)
6. Trigger a test notification by inserting a HIGH-severity finding into `acquisition_analyses`
7. Verify Slack message appears in test channel with correct format
8. Click "Acknowledge" button — verify durable claim recorded in `denise_task_claims`
9. Click "Request Review" button — verify durable claim recorded
10. Set `DENISE_SLACK_ENABLED=false` — verify no further notifications post

### Verification Checklist
- [ ] Message appears in correct channel only
- [ ] Action buttons work and record claims
- [ ] Duplicate actions are idempotent (second click returns "Already acknowledged")
- [ ] Nonmember user action is rejected
- [ ] Wrong-workspace action is rejected
- [ ] Feature flag disable stops all notifications immediately

## 2. Required Test-Workspace Credentials

| Variable | Description | Source |
|---|---|---|
| `DENISE_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) | Slack app "Denise BD" in test workspace |
| `DENISE_APP_TOKEN` | App-Level Token (xapp-...) | Same Slack app, Socket Mode enabled |
| `SLACK_TEAM_ID` | Test workspace ID (T...) | Slack workspace settings |
| `SLACK_CHANNEL_ID` | Test channel ID (C...) | Channel details in test workspace |
| `SUPABASE_URL` | Commissioning Supabase URL | Commissioning project dashboard |
| `SUPABASE_SERVICE_KEY` | Commissioning service role key | Commissioning project settings |

**CRITICAL:** Never use production Supabase credentials during smoke testing.

## 3. Feature-Flag Activation and Rollback Order

### Activation (forward)
1. Verify `SLACK_TEAM_ID` and `SLACK_CHANNEL_ID` are set to correct values
2. Verify `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN` are valid
3. Set `DENISE_SLACK_ENABLED=true`
4. Verify Denise action handlers are registered (check startup logs)
5. Monitor `denise_task_claims` for delivery records

### Rollback (reverse)
1. Set `DENISE_SLACK_ENABLED=false` — immediately stops all notification qualification and delivery
2. No restart required if using dynamic feature flags; otherwise restart the process
3. Existing acknowledged/reviewed claims are preserved (idempotent, no rollback needed)
4. Any AMBIGUOUS deliveries remain in AMBIGUOUS state — see reconciliation below

### Emergency Kill
- Set `DENISE_SLACK_ENABLED=false` — this is the single control point
- All code paths check this flag before qualification, delivery, and action processing
- Gateway routes for Denise task types are `enabled: false` by default — no inference possible

## 4. Manual Reconciliation of Ambiguous Slack Delivery

An AMBIGUOUS delivery means the Slack API call completed but the outcome is uncertain (network timeout, process crash after `mark_denise_inference_attempted` but before completion).

### Reconciliation Procedure
1. Query ambiguous claims:
   ```sql
   SELECT * FROM denise_task_claims
   WHERE status = 'AMBIGUOUS'
   AND idempotency_key LIKE 'denise-delivery-%';
   ```
2. For each ambiguous claim, check the Slack channel for the corresponding message:
   - Search by notification category and artifact ID in message metadata
   - If message exists: manually mark claim as COMPLETED via `complete_denise_eval_claim`
   - If message does not exist: manually mark claim as FAILED via `fail_denise_eval_claim`
3. Do NOT auto-retry ambiguous deliveries — this prevents duplicate Slack messages

### Design Rationale
The durable delivery boundary marks `inference_attempted=true` BEFORE the Slack API call. If the process crashes:
- Recovery finds `inference_attempted=true` with no completion → AMBIGUOUS
- Human determines whether the Slack message was actually posted
- No automated repost avoids duplicate messages in the channel

## 5. Safe Handling of Ambiguous Gateway Reservations

Gateway reservations for Denise task types (`denise_regulatory_interpretation`, etc.) are all `enabled: false`. No inference can occur until routes are explicitly enabled.

If a reservation is created but inference fails or is interrupted:
1. The reservation remains in `ai_budget_ledger` with `status = 'reserved'`
2. Stale reservations (older than lease period) are cleaned up by the existing reconciliation process
3. No manual intervention required unless reconciliation is also failing

### Known Backlog Item
Per memory `project_gateway_reconciliation.md`: failed-before-provider reservation cleanup and stale key reconciliation is a known backlog item. This does not block Denise activation because all Denise Gateway routes are disabled.

## 6. October 15 Model Review Procedure

### Scope
Review model assignments for all Denise task types in `ai_model_routing` and `DEFAULT_ROUTES`.

### Current Denise Routes (all disabled)
| Task Type | Model | Input Limit | Output Limit | Cost Limit |
|---|---|---|---|---|
| denise_capture_acquisition | claude-haiku-4-5-20251001 | 16,000 | 2,048 | $0.05 |
| denise_clause_analysis | claude-haiku-4-5-20251001 | 16,000 | 2,048 | $0.05 |
| denise_amendment_analysis | claude-sonnet-4-6 | 16,000 | 2,048 | $0.05 |
| denise_clarification_draft | claude-haiku-4-5-20251001 | 8,000 | 1,024 | $0.03 |
| denise_evaluation_analysis | claude-sonnet-4-6 | 16,000 | 2,048 | $0.05 |
| denise_regulatory_interpretation | claude-haiku-4-5-20251001 | 8,000 | 2,048 | $0.05 |

### Review Checklist
- [ ] Confirm model availability (no deprecation notices for claude-haiku-4-5-20251001 or claude-sonnet-4-6)
- [ ] Review token pricing changes since last review
- [ ] Evaluate whether Haiku 4.5 quality is sufficient for regulatory interpretation tasks
- [ ] Review cost ceiling adequacy based on commissioning test data
- [ ] Document any model changes in `ai_model_routing` DB table (not just DEFAULT_ROUTES)
- [ ] Do NOT assume model retirement — verify with Anthropic status page

### Decision Authority
Model changes require CEO approval per feedback_model_routing.md precedent (Sonnet write route for Jodie was CEO-approved after Haiku truncation failures).
