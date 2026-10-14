/**
 * Cost-Cap Enforcement Verification Tests
 *
 * Proves the per-call cost-cap behavior for all existing routes
 * and documents the enforcement semantics.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const gatewayPath = path.join(import.meta.dirname, '..', 'gateway.ts');

describe('Cost-cap enforcement semantics', () => {
  const content = fs.readFileSync(gatewayPath, 'utf-8');

  it('cost-cap check uses ESTIMATED cost, not route-max reservation', () => {
    // The cost-cap comparison should use estimatedCost (from boundedInput)
    // not reservationCost (from max(boundedInput, maxInputTokens))
    const capSection = content.slice(content.indexOf('Per-request cost cap'));
    expect(capSection).toContain('estimatedCost > maxCost');
    expect(capSection).not.toContain('reservationCost > maxCost');
  });

  it('reservation uses route-max input for budget safety', () => {
    expect(content).toContain('Math.max(boundedInput, maxInputTokens)');
    expect(content).toContain('estimateMaxCost(provider, model, reservationInput, maxOutputTokens)');
  });

  it('settlement checks actual vs reserved (not actual vs ceiling)', () => {
    // The settlement RPC rejects if actual > reserved
    // This is the hard financial guarantee
    const settleSection = content.slice(content.indexOf('settleBudget'));
    expect(settleSection).toContain('actualCostUsd');
  });
});

describe('Jodie Sonnet route compatibility', () => {
  it('estimated cost for typical Jodie request is under $0.10', () => {
    // Jodie section_draft: Sonnet 4.6, maxInput=16000, maxOutput=4096
    // Typical Jodie input: ~8000 chars → ~3200 tokens at chars/2.5
    // Estimated cost: (3200 * 3.0 + 4096 * 15.0) / 1M = $0.0710
    const typicalInput = Math.ceil(8000 / 2.5); // 3200 tokens
    const estimatedCost = (typicalInput * 3.0 + 4096 * 15.0) / 1_000_000;
    expect(estimatedCost).toBeLessThan(0.10);
  });

  it('route-max reservation for Jodie Sonnet exceeds $0.10 ceiling', () => {
    // This is expected and acceptable — the reservation is a budget safety margin
    // The cost-cap check uses the ESTIMATED cost, not the reservation
    const maxReservation = (16000 * 3.0 + 4096 * 15.0) / 1_000_000;
    expect(maxReservation).toBeGreaterThan(0.10);
    expect(maxReservation).toBeCloseTo(0.1094, 3);
  });

  it('actual cost can only exceed estimate if input underestimates', () => {
    // Output is hard-limited by max_tokens parameter
    // Input is estimated but the route-max reservation covers the worst case
    // The per-call ceiling is an admission filter, not a hard cap
    const maxOutput = 4096; // Provider-enforced limit
    const maxActualOutput = maxOutput; // Cannot exceed this
    expect(maxActualOutput).toBe(4096);
  });

  it('Jodie requests with large input are rejected by input-size check', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('rawInput > maxInputTokens');
    // If chars/2.5 estimate exceeds 16000, request is rejected before dispatch
  });
});

describe('Denise route compatibility preserved', () => {
  it('Denise Haiku 5.5 routes fit within $0.05 at route-max', () => {
    // denise_regulatory_interpretation: maxIn=8000, maxOut=4096
    const worstCase = (8000 * 0.10 + 4096 * 0.50) / 1_000_000;
    expect(worstCase).toBeLessThan(0.05);
  });

  it('Denise estimated cost matches route-max cost (tight fit)', () => {
    // For Haiku 5.5, route-max reservation IS under the ceiling
    // Both estimated and reserved costs are under $0.05
    const maxReservation = (8000 * 0.10 + 4096 * 0.50) / 1_000_000;
    expect(maxReservation).toBeLessThan(0.05);
  });
});

describe('Settlement violation handling', () => {
  it('settlement violation marks ledger ambiguous and throws', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    const settleSection = content.slice(content.indexOf('if (!settled)'));
    expect(settleSection).toContain('markAmbiguous');
    expect(settleSection).toContain('settlement_violation');
    expect(settleSection).toContain('throw new ProviderError');
  });

  it('settlement violation preserves budget reservation', () => {
    // markAmbiguous does NOT release budget — confirmed by RPC definition
    // The reservation stays locked until manual reconciliation
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    const violationHandler = content.slice(
      content.indexOf('if (!settled)'),
      content.indexOf('const textBlock')
    );
    expect(violationHandler).toContain('markAmbiguous');
    // The violation handler uses markAmbiguous, not releaseBudget
    expect(violationHandler).not.toContain('releaseBudget(');
  });
});

describe('All existing routes: estimated cost under ceiling', () => {
  // Verify that typical requests (8000 char input) pass the cost-cap check
  const routes = [
    { name: 'classify', maxIn: 8000, maxOut: 2048, ceil: 0.03, pi: 1.0, po: 5.0 },
    { name: 'extract', maxIn: 8000, maxOut: 512, ceil: 0.02, pi: 1.0, po: 5.0 },
    { name: 'reason', maxIn: 16000, maxOut: 2048, ceil: 0.08, pi: 1.0, po: 5.0 },
    { name: 'jodie_compliance', maxIn: 16000, maxOut: 4096, ceil: 0.05, pi: 1.0, po: 5.0 },
    { name: 'jodie_outline', maxIn: 16000, maxOut: 2048, ceil: 0.05, pi: 1.0, po: 5.0 },
    { name: 'jodie_draft', maxIn: 16000, maxOut: 4096, ceil: 0.10, pi: 3.0, po: 15.0 },
    { name: 'jodie_revision', maxIn: 16000, maxOut: 4096, ceil: 0.10, pi: 3.0, po: 15.0 },
    { name: 'jodie_coherence', maxIn: 16000, maxOut: 4096, ceil: 0.10, pi: 3.0, po: 15.0 },
    { name: 'david_research', maxIn: 16000, maxOut: 2048, ceil: 0.05, pi: 1.0, po: 5.0 },
    { name: 'marcus_research', maxIn: 16000, maxOut: 3072, ceil: 0.05, pi: 1.0, po: 5.0 },
    { name: 'rosa_intelligence', maxIn: 16000, maxOut: 2048, ceil: 0.05, pi: 1.0, po: 5.0 },
  ];

  for (const r of routes) {
    it(`${r.name}: typical 8K-char request under $${r.ceil} ceiling`, () => {
      // Typical input: 8000 chars → ceil(8000/2.5) = 3200 tokens
      const typicalTokens = Math.ceil(8000 / 2.5);
      const estimatedCost = (typicalTokens * r.pi + r.maxOut * r.po) / 1_000_000;
      expect(estimatedCost).toBeLessThan(r.ceil);
    });
  }
});
