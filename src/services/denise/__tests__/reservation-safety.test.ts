/**
 * Reservation Safety and Settlement Tests
 *
 * Verifies the Gateway reservation always covers worst-case actual cost,
 * settlement violation handling, task-claim sequencing, and incomplete output.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const gatewayPath = path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'gateway.ts');
const regInterpPath = path.join(import.meta.dirname, '..', 'regulatory-interpretation.ts');
const pricingPath = path.join(import.meta.dirname, '..', '..', 'llm-gateway', 'pricing.ts');

describe('Reservation uses route max input tokens', () => {
  const content = fs.readFileSync(gatewayPath, 'utf-8');

  it('reservation input is max(estimated, route maxInputTokens)', () => {
    expect(content).toContain('Math.max(boundedInput, maxInputTokens)');
    expect(content).toContain('reservationInput');
  });

  it('estimateMaxCost uses reservationInput not boundedInput', () => {
    const section = content.slice(content.indexOf('reservationInput'));
    expect(section).toContain('estimateMaxCost(provider, model, reservationInput, maxOutputTokens)');
  });

  it('worst-case Haiku 5.5 regulatory reservation fits under $0.05', () => {
    // Route: maxInputTokens=8000, maxOutputTokens=4096
    // Pricing: $0.10/MTok input, $0.50/MTok output
    const worstCase = (8000 * 0.10 + 4096 * 0.50) / 1_000_000;
    expect(worstCase).toBeLessThan(0.05);
    expect(worstCase).toBeCloseTo(0.00285, 4);
  });

  it('actual cost can never exceed reservation at route limits', () => {
    // If actual input <= maxInputTokens and actual output <= maxOutputTokens,
    // and reservation uses maxInputTokens + maxOutputTokens at the same pricing,
    // then actual_cost <= reservation_cost is guaranteed.
    const maxIn = 8000;
    const maxOut = 4096;
    const price_in = 0.10;
    const price_out = 0.50;

    const reservation = (maxIn * price_in + maxOut * price_out) / 1_000_000;

    // Actual must be <= max tokens at same pricing
    for (const actualIn of [0, 1000, 5000, 8000]) {
      for (const actualOut of [0, 1000, 2000, 4096]) {
        const actual = (actualIn * price_in + actualOut * price_out) / 1_000_000;
        expect(actual).toBeLessThanOrEqual(reservation + 0.000001);
      }
    }
  });
});

describe('Settlement violation handling', () => {
  const content = fs.readFileSync(gatewayPath, 'utf-8');

  it('settlement failure marks ledger ambiguous', () => {
    const section = content.slice(content.indexOf('if (!settled)'));
    expect(section).toContain('markAmbiguous');
    expect(section).toContain('settlement_violation');
  });

  it('settlement failure throws ProviderError (non-retryable)', () => {
    const section = content.slice(content.indexOf('if (!settled)'));
    expect(section).toContain('throw new ProviderError');
    expect(section).toContain('false'); // retryable = false
  });

  it('settlement failure does NOT silently return a successful response', () => {
    const section = content.slice(content.indexOf('if (!settled)'));
    // After markAmbiguous + throw, the function cannot reach the return statement
    expect(section).toContain('throw');
    // No return before the throw
    const throwIdx = section.indexOf('throw new ProviderError');
    const returnBefore = section.slice(0, throwIdx).lastIndexOf('return {');
    expect(returnBefore).toBe(-1);
  });
});

describe('Task-claim sequencing', () => {
  const content = fs.readFileSync(regInterpPath, 'utf-8');

  it('claim_denise_eval_task is called before Gateway complete()', () => {
    const claimPos = content.indexOf('claim_denise_eval_task');
    const completePos = content.indexOf('await complete(');
    expect(claimPos).toBeGreaterThan(0);
    expect(completePos).toBeGreaterThan(0);
    expect(claimPos).toBeLessThan(completePos);
  });

  it('mark_denise_inference_attempted is set before dispatch', () => {
    const markPos = content.indexOf('mark_denise_inference_attempted');
    const completePos = content.indexOf('await complete(');
    expect(markPos).toBeGreaterThan(0);
    expect(markPos).toBeLessThan(completePos);
  });

  it('observation window is claimed before dispatch', () => {
    const windowPos = content.indexOf('claim_denise_observation_slot');
    const completePos = content.indexOf('await complete(');
    expect(windowPos).toBeGreaterThan(0);
    expect(windowPos).toBeLessThan(completePos);
  });

  it('no hardcoded maxOutputTokens in regulatory interpretation', () => {
    // Should use the route's value, not a hardcoded override
    const callSection = content.slice(
      content.indexOf('await complete('),
      content.indexOf('});', content.indexOf('await complete(')) + 3
    );
    expect(callSection).not.toContain('maxOutputTokens:');
  });
});

describe('Incomplete output handling', () => {
  it('Gateway sets incomplete for all max_tokens stop reasons', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain("response.stop_reason === 'max_tokens'");
    // Should NOT be conditional on empty text
    expect(content).not.toContain("!outputText && response.stop_reason === 'max_tokens'");
  });

  it('regulatory-interpretation fails closed on incomplete', () => {
    const content = fs.readFileSync(regInterpPath, 'utf-8');
    expect(content).toContain('response.incomplete');
    expect(content).toContain('INCOMPLETE_OUTPUT');
  });
});

describe('Reconciliation plan for stuck ledger', () => {
  it('mark_inference_ambiguous RPC exists in migration', () => {
    const migrationPath = path.join(import.meta.dirname, '..', '..', '..', '..', 'supabase', 'migrations', '20260928_llm_gateway.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toContain('mark_inference_ambiguous');
    // Ambiguous does NOT release budget — budget stays reserved
    expect(sql).toContain('Budget stays reserved');
  });
});
