# Denise Operational Readiness — Milestone D Phase 2

**Status:** Documentation only. NOT ACTIVATED.
**Baseline:** 78c898e
**Date:** 2026-10-09

## 1. Production Slack Topology

Denise runs a **dedicated Bolt app** with its own Socket Mode connection, independent
of Maya and all other agents.

### Process architecture
- `run-team.ts` calls `startDeniseSlackApp()` after all agents connect.
- Denise's Bolt app uses `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN`.
- Action handlers (`denise_acknowledge`, `denise_request_review`) are registered
  on Denise's own app — they do NOT run on Maya's app.
- Duplicate Socket Mode connections are prevented — `startDeniseSlackApp()` is
  idempotent per process.
- Shutdown: `stopDeniseSlackApp()` is called alongside agent disconnects on SIGINT.

### Required credentials
| Variable | Description | Source |
|---|---|---|
| `DENISE_BOT_TOKEN` | Bot User OAuth Token (xoxb-...) | Slack app "Denise BD" |
| `DENISE_APP_TOKEN` | App-Level Token (xapp-...) | Same Slack app, Socket Mode enabled |
| `SLACK_TEAM_ID` | FFTC workspace ID (T...) | Slack workspace settings |
| `SLACK_CHANNEL_ID` | BD team channel ID (C...) | Channel details |
| `SUPABASE_URL` | Supabase project URL | Project dashboard |
| `SUPABASE_SERVICE_KEY` | Service role key | Project settings |

**CRITICAL:** Never use production Supabase credentials during smoke testing.
Use commissioning project `nnwddilewgbsmyouatzu` for all pre-activation testing.

## 2. Emergency Controls

Denise has **two independent emergency stops** — one for all AI inference, one
for Denise Slack specifically. Neither requires Railway redeployment.

### Denise-specific Slack stop (preferred for Denise-only incidents)
```sql
UPDATE system_controls SET value = 'false'::jsonb,
  updated_by = 'emergency' WHERE key = 'denise_slack_enabled';
```
- Latency: ~5 seconds (negative cache TTL in `isDeniseSlackAuthorized()`).
- Scope: Denise Slack dispatch and action processing only.
- Does NOT affect other agents, global AI, or Gateway inference.
- Checked at every action handler and delivery boundary.

### Global AI stop (all agents)
```sql
UPDATE system_controls SET value = 'false'::jsonb,
  updated_by = 'emergency' WHERE key = 'ai_enabled';
```
- Latency: ~5 seconds.
- Scope: All AI inference for all agents.

### Layered emergency stop priority
| Priority | Method | Latency | Scope |
|---|---|---|---|
| 1 | DB: `denise_slack_enabled = false` | ~5 sec | Denise Slack only |
| 2 | DB: `ai_enabled = false` | ~5 sec | All AI inference |
| 3 | DB: Set Denise routes `enabled = false` | Immediate | Denise Gateway routes |
| 4 | Railway: Remove env vars | Minutes (redeploy) | Process-level |

### Dual authorization for Denise Slack
Denise Slack operates ONLY when ALL THREE are true:
1. **Environment:** `DENISE_SLACK_ENABLED=true`
2. **Database:** `system_controls.denise_slack_enabled = true`
3. **Credentials:** `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN` present

Missing any one → Denise Slack is disabled (fail-closed).

## 3. Railway Deployment Behavior

### Environment variable changes trigger REDEPLOYMENT, not restart
When environment variables change via the Railway dashboard or CLI:
1. Railway builds a **new container image**.
2. The old container continues running with OLD env vars during build.
3. After build completes, Railway starts the new container and drains the old.
4. This is NOT an in-place restart — it is a full build+deploy cycle.
5. Latency: minutes, not seconds.

### Implication for emergency stops
**Do NOT rely on Railway env var changes for emergency stops.**
Use the database controls above, which take effect within ~5 seconds
without any redeployment.

### Railway configuration
- Start command: `npm run start:prod` → `tsx src/scripts/run-all.ts`
- Restart policy: `ON_FAILURE`, max 10 retries
- Health check: **NOT CONFIGURED** (`healthcheckPath: null`)
- Builder: Dockerfile

## 4. Activation and Rollback Order

### Activation (forward)
1. Verify `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN` are valid
2. Verify `SLACK_TEAM_ID` and `SLACK_CHANNEL_ID` are correct
3. Set env `DENISE_SLACK_ENABLED=true` (requires Railway redeployment)
4. Set DB `denise_slack_enabled = true`:
   ```sql
   UPDATE system_controls SET value = 'true'::jsonb,
     updated_by = 'activation' WHERE key = 'denise_slack_enabled';
   ```
5. Verify startup log: "Denise Slack app started (dedicated Socket Mode, actions gated on DB control)"
6. Monitor `denise_task_claims` for delivery records

### Rollback (reverse)
1. **Immediate:** Set DB `denise_slack_enabled = false` (~5 sec latency)
2. **Durable:** Set env `DENISE_SLACK_ENABLED=false` (next redeploy)
3. Existing acknowledged/reviewed claims are preserved (idempotent)
4. Any AMBIGUOUS deliveries remain in AMBIGUOUS state — see reconciliation below

**IMPORTANT:** Feature flags (`DENISE_SLACK_ENABLED`) are read from environment
variables, NOT from the database. Changing an env var on Railway requires a
redeployment. The database control `denise_slack_enabled` is the only truly
dynamic runtime stop.

## 5. Controlled Real-Slack Smoke-Test Procedure

### Prerequisites
- Commissioning Supabase instance `nnwddilewgbsmyouatzu` configured
- DENISE_SLACK_ENABLED=false (default — remains off until explicit activation)
- DB: `denise_slack_enabled = false` (migration default)
- Test workspace and channel configured

### Steps
1. Set env: `SLACK_TEAM_ID=<test-workspace-id>`, `SLACK_CHANNEL_ID=<test-channel-id>`
2. Set `DENISE_BOT_TOKEN` and `DENISE_APP_TOKEN` to test-workspace credentials
3. Start the team with `npx tsx src/live/run-team.ts`
4. Verify console output: "Denise Slack app started (dedicated Socket Mode, actions gated on DB control)"
5. Set env `DENISE_SLACK_ENABLED=true` and DB `denise_slack_enabled = true`
6. Trigger a test notification by inserting a HIGH-severity finding into `acquisition_analyses`
7. Verify Slack message appears in test channel with correct format
8. Click "Acknowledge" button — verify durable claim recorded in `denise_task_claims`
9. Click "Request Review" button — verify durable claim recorded
10. Set DB `denise_slack_enabled = false` — verify no further notifications post within ~5 seconds

### Verification Checklist
- [ ] Denise starts on its own Bolt app (not Maya's)
- [ ] Message appears in correct channel only
- [ ] Action buttons work and record claims
- [ ] Duplicate actions are idempotent (second click returns "Already acknowledged")
- [ ] Nonmember user action is rejected
- [ ] Wrong-workspace action is rejected
- [ ] DB emergency stop disables all notifications within ~5 seconds
- [ ] Env flag disable stops all notifications after restart

## 6. Manual Reconciliation of Ambiguous Slack Delivery

An AMBIGUOUS delivery means the Slack API call completed but the outcome is
uncertain (network timeout, process crash after `mark_denise_inference_attempted`
but before completion).

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

## 7. Safe Handling of Ambiguous Gateway Reservations

Gateway reservations for Denise task types are all `enabled: false` in
DEFAULT_ROUTES. Commissioning DB has them enabled for testing.

If a reservation is created but inference fails or is interrupted:
1. The reservation remains in `ai_inference_ledger` with `status = 'ambiguous'`
2. Ambiguous reservations keep budget locked — they are NOT auto-released
3. Manual evidence (provider logs, API dashboard) required before releasing
4. Stale `reserved` entries (pre-network) are auto-released by `reconcile_stale_reservations()`

### Known Backlog Item
Per memory `project_gateway_reconciliation.md`: failed-before-provider
reservation cleanup and stale key reconciliation is a known backlog item.

## 8. Commissioning Budget Reconciliation (2026-10-09)

### Global budget state
| Metric | Value |
|---|---|
| Limit | $5.0000 |
| Settled (spent) | $4.9022 |
| Active reservations | $0.0911 |
| Committed total | $4.9933 |
| Available headroom | $0.0067 |

### Settled spending by agent
| Agent | Task Type | Calls | Total Actual | Total Reserved |
|---|---|---|---|---|
| denise | denise_amendment_impact | 86 | $0.2347 | $0.9408 |
| denise | denise_clause_analysis | 137 | $0.9214 | $1.5542 |
| denise | denise_evaluation_analysis | 165 | $0.8652 | $1.8200 |
| denise | denise_regulatory_interpretation | 160 | $0.8847 | $1.7311 |
| james | james_capture_initial | 4 | $0.0282 | $0.0390 |
| jodie | jodie_coherence_review | 8 | $0.3459 | $0.5209 |
| jodie | jodie_compliance_analysis | 109 | $0.3287 | $1.9996 |
| jodie | jodie_outline | 29 | $0.1683 | $0.2574 |
| jodie | jodie_section_draft | 30 | $0.8303 | $1.6402 |
| jodie | jodie_section_revision | 9 | $0.1455 | $0.5870 |
| marcus | marcus_capture_research | 2 | $0.0216 | $0.0246 |
| maya | maya_commissioning_review | 5 | $0.0249 | $0.0581 |
| patricia | patricia_portfolio_brief | 6 | $0.0114 | $0.0510 |
| patricia | patricia_risk_synthesis | 6 | $0.0130 | $0.0374 |
| rosa | rosa_intelligence | 2 | $0.0149 | $0.0215 |

### Ambiguous reservations (budget locked)
| Agent | Task Type | Entries | Reserved Total |
|---|---|---|---|
| jodie | jodie_section_draft | 4 | $0.1976 |
| denise | denise_evaluation_analysis | 1 | $0.0111 |

All 5 ambiguous entries have `error_code: stale_in_progress` — they were
in-progress requests that exceeded the staleness threshold and were promoted
to ambiguous by `reconcile_stale_reservations()`.

**Status:** Budget is near-exhausted ($0.0067 headroom). No new inference is
possible at current limits without releasing ambiguous reservations or
increasing the budget. Do not release without provider-side evidence.

## 9. Effective Route Configuration (Commissioning DB)

Queried from `ai_model_routing` in commissioning project `nnwddilewgbsmyouatzu`:

| Task Type | Model | Input | Output | Cost | Enabled |
|---|---|---|---|---|---|
| denise_amendment_impact | claude-haiku-4-5-20251001 | 8,000 | 2,048 | $0.05 | **true** |
| denise_clause_analysis | claude-haiku-4-5-20251001 | 8,000 | 2,048 | $0.05 | **true** |
| denise_evaluation_analysis | claude-haiku-4-5-20251001 | 8,000 | 2,048 | $0.05 | **true** |
| denise_regulatory_interpretation | claude-haiku-4-5-20251001 | 8,000 | 2,048 | $0.05 | **true** |

**Key findings:**
- Commissioning DB uses `denise_amendment_impact` (correct, matches implementation code).
- All commissioning routes use Haiku 4.5 (not Sonnet as in DEFAULT_ROUTES).
- All routes are enabled in commissioning (disabled in code defaults for production safety).
- `denise_capture_acquisition` and `denise_clarification_draft` are not in commissioning DB.

## 10. Model Lifecycle Review (October 15 checkpoint)

### Scope
Review model assignments for all Denise task types in `ai_model_routing` and `DEFAULT_ROUTES`.

### Current Denise Routes (code defaults — all disabled)
| Task Type | Model | Input Limit | Output Limit | Cost Limit |
|---|---|---|---|---|
| denise_capture_acquisition | claude-haiku-4-5-20251001 | 16,000 | 2,048 | $0.05 |
| denise_clause_analysis | claude-haiku-4-5-20251001 | 16,000 | 2,048 | $0.05 |
| denise_amendment_impact | claude-sonnet-4-6 | 16,000 | 2,048 | $0.05 |
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
Model changes require CEO approval per feedback_model_routing.md precedent
(Sonnet write route for Jodie was CEO-approved after Haiku truncation failures).

## 11. Remaining Live-Provider Validation

Before Denise production activation, the following must be verified with a live
provider call (NOT yet authorized):

1. **Budget headroom:** Current headroom is $0.0067 — insufficient for a $0.05
   inference call. Either release verified-safe ambiguous reservations or increase
   the commissioning budget before testing.
2. **Observation window:** A `denise_observation_windows` row must exist with
   remaining slots for the test capture.
3. **Route enablement:** The target route must be `enabled: true` in the DB.
4. **System controls:** Both `ai_enabled` and `denise_slack_enabled` must be `true`.
5. **Single call:** One `denise_regulatory_interpretation` call, pinned to
   Haiku 4.5, max $0.05, one observation slot, no Slack, no workflows.
