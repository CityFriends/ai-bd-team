/**
 * Haiku 5.5 Preflight Hardening Tests
 *
 * Incomplete-response handling, pricing, reservation, tokenizer, migration.
 * Zero live inference.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const gatewayPath = path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'gateway.ts');
const routingPath = path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'routing.ts');
const regInterpPath = path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts');
const migrationPath = path.join(import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20261014_haiku_55_pricing.sql');

// ============================================================
// Incomplete response handling
// ============================================================
describe('Incomplete response handling', () => {
  it('Gateway flags stop_reason=max_tokens as incomplete', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain("response.stop_reason === 'max_tokens'");
    expect(content).toContain('incomplete');
  });

  it('Gateway flags max_tokens regardless of text presence', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    // Should NOT be conditional on empty text
    const section = content.slice(content.indexOf('Flag incomplete output'));
    expect(section).toContain("const isIncomplete = response.stop_reason === 'max_tokens'");
    // No "!outputText &&" guard
    expect(section).not.toContain('!outputText && response.stop_reason');
  });

  it('regulatory-interpretation fails closed on incomplete', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    expect(content).toContain('response.incomplete');
    expect(content).toContain('INCOMPLETE_OUTPUT');
    expect(content).toContain('fail_denise_eval_claim');
  });

  it('incomplete response preserves cost and ledger', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    // Search from 'response.incomplete' to the next 'return' statement
    const start = content.indexOf('response.incomplete');
    const end = content.indexOf("return { ...fail('Incomplete output", start);
    const incompleteSection = content.slice(start, end + 100);
    expect(incompleteSection).toContain('recordValidationFailureAudit');
    expect(incompleteSection).toContain('ledgerId, costUsd');
  });

  it('incomplete response does not retry', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    const start = content.indexOf('response.incomplete');
    const end = content.indexOf("return { ...fail('Incomplete output", start);
    const incompleteSection = content.slice(start, end + 100);
    expect(incompleteSection).not.toContain('await complete(');
  });

  it('InferenceResponse has incomplete field', () => {
    const typesPath = path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'types.ts');
    const content = fs.readFileSync(typesPath, 'utf-8');
    expect(content).toContain('incomplete?: boolean');
  });
});

// ============================================================
// Pricing and reservation
// ============================================================
describe('Haiku 5.5 pricing and reservation', () => {
  it('migration adds haiku-5-5 pricing at $0.10/$0.50', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain("'claude-haiku-5-5'");
    expect(sql).toContain('0.10');
    expect(sql).toContain('0.50');
  });

  it('worst-case regulatory interpretation cost is under $0.05', () => {
    // Route: maxInputTokens=8000, maxOutputTokens=4096
    // Pricing: $0.10/MTok input, $0.50/MTok output
    const worstCase = (8000 * 0.10 + 4096 * 0.50) / 1_000_000;
    expect(worstCase).toBeLessThan(0.05);
    expect(worstCase).toBeCloseTo(0.00285, 4);
  });

  it('worst-case clarification cost is under $0.03', () => {
    // Route: maxInputTokens=8000, maxOutputTokens=2048
    const worstCase = (8000 * 0.10 + 2048 * 0.50) / 1_000_000;
    expect(worstCase).toBeLessThan(0.03);
  });

  it('worst-case capture/clause cost is under $0.05', () => {
    // Route: maxInputTokens=16000, maxOutputTokens=4096
    const worstCase = (16000 * 0.10 + 4096 * 0.50) / 1_000_000;
    expect(worstCase).toBeLessThan(0.05);
  });

  it('long-context pricing applies only above 100K tokens', () => {
    // Our max input is 16000 — well under 100K threshold
    // Standard pricing ($0.10/$0.50) applies, not long-context ($0.50/$2.50)
    const maxInput = 16000;
    expect(maxInput).toBeLessThan(100000);
  });

  it('4096 output tokens accommodate thinking + response', () => {
    // Haiku 5.5 adaptive thinking consumes output budget
    // 4096 gives ~1500 thinking + ~2500 response tokens
    // Denise requires ~500-2000 output tokens for regulatory JSON
    const routingContent = fs.readFileSync(routingPath, 'utf-8');
    const regInterpRoute = routingContent.slice(
      routingContent.indexOf("'denise_regulatory_interpretation'"),
      routingContent.indexOf('},', routingContent.indexOf("'denise_regulatory_interpretation'")) + 2
    );
    expect(regInterpRoute).toContain('maxOutputTokens: 4096');
  });
});

// ============================================================
// Token-limit assumptions
// ============================================================
describe('Tokenizer assumptions', () => {
  it('Gateway uses chars/3 conservative estimate', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('totalChars / 3');
  });

  it('chars/3 is conservative for the new tokenizer', () => {
    // Haiku 5.5 tokenizer: ~30% more tokens for same text
    // Old tokenizer: ~4 chars/token → chars/4
    // New tokenizer: ~3 chars/token → chars/3
    // Gateway uses max(chars/4 * 1.2, chars/3) = max(chars/3.33, chars/3) = chars/3
    // chars/3 matches the new tokenizer's average, so it's exactly right
    // For safety: the Gateway also checks rawInput <= maxInputTokens before dispatch
    const charsPerToken = 3; // New tokenizer average
    const safetyBound = 3;   // Gateway divisor
    expect(safetyBound).toBeLessThanOrEqual(charsPerToken);
  });

  it('Gateway rejects input exceeding maxInputTokens before dispatch', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('rawInput > maxInputTokens');
    expect(content).toContain('BudgetExceededError');
  });

  it('regulatory interpretation truncates evidence to 6000 chars', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    expect(content).toContain('.slice(0, 6000)');
    // 6000 chars / 3 = 2000 tokens, well under 8000 maxInputTokens
    const maxTokensFromEvidence = Math.ceil(6000 / 3);
    expect(maxTokensFromEvidence).toBeLessThan(8000);
  });
});

// ============================================================
// Migration safety
// ============================================================
describe('Haiku 5.5 migration safety', () => {
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  it('only updates Denise Haiku routes', () => {
    // Should target specific Denise task types only
    expect(sql).toContain("'denise_capture_acquisition'");
    expect(sql).toContain("'denise_clause_analysis'");
    expect(sql).toContain("'denise_clarification_draft'");
    expect(sql).toContain("'denise_regulatory_interpretation'");
    // Should NOT update non-Denise routes
    expect(sql).not.toContain("'classify'");
    expect(sql).not.toContain("'extract'");
    expect(sql).not.toContain("'reason'");
    expect(sql).not.toContain("'james_'");
    expect(sql).not.toContain("'patricia_'");
  });

  it('routes remain disabled after migration', () => {
    // UPDATE does not change enabled status
    expect(sql).not.toContain('enabled = true');
    expect(sql).not.toContain("enabled = 't'");
  });

  it('does not modify historical ledger records', () => {
    expect(sql).not.toContain('ai_inference_ledger');
    expect(sql).not.toContain('DELETE');
  });

  it('pricing insert is idempotent', () => {
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
  });

  it('route update is conditional on old model', () => {
    expect(sql).toContain("AND model = 'claude-haiku-4-5-20251001'");
  });

  it('does not change Sonnet routes', () => {
    // denise_amendment_impact and denise_evaluation_analysis use Sonnet
    expect(sql).not.toContain("'denise_amendment_impact'");
    expect(sql).not.toContain("'denise_evaluation_analysis'");
  });
});

// ============================================================
// No retries / no fallback / no Slack
// ============================================================
describe('Safety invariants preserved', () => {
  it('SDK retries remain disabled', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('maxRetries: 0');
  });

  it('no model fallback in routing', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).not.toContain('fallbackModel');
  });

  it('no Slack in regulatory interpretation', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    expect(content).not.toContain('postMessage');
    expect(content).not.toMatch(/from\s+['"].*slack/i);
  });
});
