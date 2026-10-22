/**
 * Maya ops notification wording tests.
 *
 * The review-queued notification is informational only — Maya's review
 * processor assesses opportunities automatically. The message must not
 * imply human approval is required or that the task is assigned to
 * another AI employee.
 */
import { describe, it, expect } from 'vitest';
import { buildReviewQueuedNotification } from '../collector.js';

describe('buildReviewQueuedNotification', () => {
  const msg = buildReviewQueuedNotification(
    'VCS Standalone IT Support Contract — RFI',
    'VETERANS AFFAIRS, DEPARTMENT OF',
    '36C10B27Q0060',
    69,
    true,
    'review:abc123:hash456:v1'
  );

  it('uses "queued for AI assessment" heading', () => {
    expect(msg).toContain('[Maya Ops] Opportunity queued for AI assessment');
  });

  it('shows QUEUED status, not PENDING', () => {
    expect(msg).toContain('Status: QUEUED — awaiting automatic Maya assessment');
    expect(msg).not.toContain('PENDING');
    expect(msg).not.toContain('awaiting Maya review authorization');
  });

  it('clarifies no human approval is required', () => {
    expect(msg).toContain('No human approval is required for this assessment.');
  });

  it('explains automatic processing', () => {
    expect(msg).toContain('Maya will assess this opportunity automatically');
    expect(msg).toContain('provided AI review is enabled');
  });

  it('preserves opportunity details', () => {
    expect(msg).toContain('Title: VCS Standalone IT Support Contract — RFI');
    expect(msg).toContain('Agency: VETERANS AFFAIRS, DEPARTMENT OF');
    expect(msg).toContain('Solicitation: 36C10B27Q0060');
    expect(msg).toContain('Score: 69/100 (strategic override)');
    expect(msg).toContain('Task key: review:abc123:hash456:v1');
  });

  it('shows score without override label when not triggered', () => {
    const noOverride = buildReviewQueuedNotification(
      'Test', 'Agency', 'SOL1', 72, false, 'key:1'
    );
    expect(noOverride).toContain('Score: 72/100');
    expect(noOverride).not.toContain('strategic override');
  });

  it('handles missing agency and solicitation', () => {
    const sparse = buildReviewQueuedNotification(
      'Sparse Opp', null, null, 45, false, 'key:2'
    );
    expect(sparse).toContain('Agency: Unknown');
    expect(sparse).toContain('Solicitation: N/A');
  });
});
