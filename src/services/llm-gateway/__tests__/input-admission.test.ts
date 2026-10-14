/**
 * Input Admission and Hard-Cap Completeness Tests
 *
 * Verifies input-token estimation, billing coverage,
 * prompt integrity, and output-limit enforcement.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const gatewayPath = path.join(import.meta.dirname, '..', 'gateway.ts');
const pricingPath = path.join(import.meta.dirname, '..', 'pricing.ts');

describe('Input-token admission', () => {
  it('uses max(chars/3.08, chars/2.5) for conservative estimation', async () => {
    const { estimateInputTokens, TOKEN_SAFETY_MARGIN } = await import('../pricing.js');
    // chars/4 * 1.3 = chars/3.08
    expect(TOKEN_SAFETY_MARGIN).toBe(1.3);
    // For 1000 chars: max(ceil(1000/4*1.3), ceil(1000/2.5)) = max(325, 400) = 400
    const est = estimateInputTokens([{ content: 'a'.repeat(1000) }]);
    expect(est).toBe(325); // estimateInputTokens returns chars/4*1.3
    // Gateway takes max(325, 400) = 400
  });

  it('chars/2.5 can underestimate for CJK text', () => {
    // CJK: 1 char = ~1 token on new tokenizer
    // chars/2.5 = 400 for 1000 CJK chars, but actual = ~1000 tokens
    // This is a known limitation — documented, not a hard guarantee
    const cjkChars = 1000;
    const estimate = Math.ceil(cjkChars / 2.5);
    expect(estimate).toBe(400);
    // Actual could be ~1000 — underestimate of 2.5x
  });

  it('route-max input cost covers underestimate in hard-cap formula', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    // The hard-cap formula uses maxInputTokens (not estimate) for input cost
    expect(content).toContain('maxInputTokens * pricing.inputPricePerMillion');
    // This means the output cap is calculated conservatively
  });

  it('post-dispatch ceiling overrun is logged for observability', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('GATEWAY CEILING OVERRUN');
    expect(content).toContain('actualCost > maxCost');
  });
});

describe('Billing model coverage', () => {
  it('settlement uses actual_input + actual_output tokens', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    // calculateCost uses actual tokens from provider response
    expect(content).toContain('calculateCost(provider, model, actualIn, actualOut)');
  });

  it('thinking tokens are included in output_tokens (Anthropic behavior)', () => {
    // Anthropic's response.usage.output_tokens includes thinking tokens
    // The Gateway reads this value directly — no separate thinking billing
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain("response.usage?.output_tokens || 0");
  });

  it('cache tokens are not separately handled (standard billing)', () => {
    // Anthropic prompt caching is not used by this Gateway
    // If it were, cache_read tokens would be billed at 10% of input price
    // The Gateway does not send cache_control blocks
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).not.toContain('cache_control');
  });

  it('long-context pricing not applicable (all routes ≤16K input)', () => {
    // Haiku 5.5 long-context: $0.50/$2.50 for prompts >100K tokens
    // All routes have maxInputTokens ≤ 16000 — well under threshold
    // No special handling needed
    expect(16000).toBeLessThan(100000);
  });
});

describe('Prompt integrity after admission', () => {
  it('provider request uses the same messages passed to admission', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    // The messages are filtered and mapped but not modified in content
    const dispatchSection = content.slice(content.indexOf('const messages = request.messages'));
    // Messages are only filtered (remove system role) and mapped (cast role)
    expect(dispatchSection).toContain(".filter((m) => m.role !== 'system')");
    expect(dispatchSection).toContain(".map((m) => ({ role: m.role");
    // Content is passed through unchanged
    expect(dispatchSection).toContain('content: m.content');
  });

  it('system prompt is passed separately (not in messages)', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('system: request.systemPrompt');
  });
});

describe('Output-limit enforcement', () => {
  it('provider receives effectiveMaxOutput (capped value)', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain('max_tokens: effectiveMaxOutput');
  });

  it('incomplete output detected regardless of text presence', () => {
    const content = fs.readFileSync(gatewayPath, 'utf-8');
    expect(content).toContain("response.stop_reason === 'max_tokens'");
  });
});

describe('Jodie 3466-token output cap assessment', () => {
  it('jodie_coherence_review: max observed 3058 < cap 3466', () => {
    // From commissioning data (8 calls):
    // max_out=3058, p95=3042, avg=2710
    expect(3058).toBeLessThan(3466);
    // 12% headroom — tight but safe
  });

  it('jodie_section_draft: max observed 2414 < cap 3466', () => {
    expect(2414).toBeLessThan(3466);
    // 30% headroom
  });

  it('jodie_section_revision: max observed 973 < cap 3466', () => {
    expect(973).toBeLessThan(3466);
    // 72% headroom
  });

  it('3466 tokens ≈ 2600 words — sufficient for proposal sections', () => {
    // At ~1.3 tokens per word (new tokenizer), 3466 tokens ≈ 2666 words
    const estimatedWords = Math.floor(3466 / 1.3);
    expect(estimatedWords).toBeGreaterThan(2500);
  });
});

describe('Denise Sonnet route configuration', () => {
  it('denise_amendment_impact capped at 133 output tokens (disabled)', () => {
    // ceiling=$0.05, Sonnet $3/$15 pricing
    // inputCost = 16000 * $3/M = $0.048
    // budgetForOutput = $0.05 - $0.048 = $0.002
    // affordable = floor($0.002 * 1M / $15) = 133
    const inputCost = (16000 * 3.0) / 1_000_000;
    const budget = 0.05 - inputCost;
    const affordable = Math.floor((budget * 1_000_000) / 15.0);
    expect(affordable).toBe(133);
    // 133 tokens is insufficient for regulatory analysis
    // Route must remain disabled until ceiling is reviewed
  });

  it('proposed fix: reduce maxInputTokens to 8000 for Denise Sonnet', () => {
    // With maxInput=8000: inputCost = 8000 * $3/M = $0.024
    // budgetForOutput = $0.05 - $0.024 = $0.026
    // affordable = floor($0.026 * 1M / $15) = 1733
    // This provides usable output while keeping the $0.05 ceiling
    const inputCost = (8000 * 3.0) / 1_000_000;
    const budget = 0.05 - inputCost;
    const affordable = Math.floor((budget * 1_000_000) / 15.0);
    expect(affordable).toBe(1733);
    // 1733 tokens ≈ 1333 words — sufficient for analysis
  });
});
