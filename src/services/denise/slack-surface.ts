/**
 * Denise — Slack Surface
 *
 * Payload generation for Denise Slack notifications.
 * Does NOT post messages — only generates structured payloads.
 *
 * High-severity events that warrant proactive notification:
 * - HIGH/CRITICAL acquisition risk
 * - POTENTIALLY_DISQUALIFYING
 * - CAPTURE_REASSESSMENT_REQUIRED
 * - High-priority clarification
 * - LEGAL_REVIEW_REQUIRED
 * - Material evaluation change
 * - Material submission-instruction change
 *
 * Routine analysis remains durable/silent.
 *
 * Zero LLM calls. Zero provider imports. Zero Slack SDK imports.
 */

import type {
  AcquisitionRisk,
  AcquisitionClarificationQuestion,
  SlackNotificationType,
} from './types.js';
import {
  DENISE_SLACK_ENABLED,
} from './types.js';

export interface DeniseSlackPayload {
  notificationType: SlackNotificationType;
  shouldPost: boolean;
  blocks: unknown[];
  text: string;
}

/**
 * Generate Slack payload for a high-severity acquisition risk.
 * Returns shouldPost=false if DENISE_SLACK_ENABLED is false or risk is low.
 */
export function generateRiskPayload(
  risk: Pick<AcquisitionRisk, 'risk_type' | 'severity' | 'source_fact' | 'interpretation' | 'operational_impact' | 'potentially_disqualifying' | 'legal_review_required' | 'id'>,
  analysisId: string,
  opportunityId: string
): DeniseSlackPayload {
  const isHigh = risk.severity === 'CRITICAL' || risk.severity === 'HIGH';
  const isDisqualifying = risk.potentially_disqualifying;
  const shouldPost = DENISE_SLACK_ENABLED && (isHigh || isDisqualifying);

  const notificationType: SlackNotificationType = isDisqualifying
    ? 'POTENTIALLY_DISQUALIFYING'
    : 'ACQUISITION_RISK_HIGH';

  const headerText = isDisqualifying
    ? 'DENISE — Potentially Disqualifying Risk'
    : `DENISE — ${risk.severity} Acquisition Risk`;

  const text = `${headerText}: ${risk.source_fact}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Risk:* ${risk.risk_type}\n*Finding:* ${risk.source_fact}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Impact:*\n${risk.operational_impact}`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Opportunity: ${opportunityId} · Analysis: ${analysisId}`,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'denise_acknowledge',
          value: JSON.stringify({ artifactId: analysisId, idempotencyKey: `risk-${risk.id}` }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request Review' },
          action_id: 'denise_request_review',
          value: JSON.stringify({ artifactId: analysisId, opportunityId: opportunityId }),
        },
      ],
    },
  ];

  return { notificationType, shouldPost, blocks, text };
}

/**
 * Generate Slack payload for a capture reassessment requirement.
 */
export function generateReassessmentPayload(
  reason: string,
  sourceDescription: string,
  analysisId: string,
  opportunityId: string
): DeniseSlackPayload {
  const shouldPost = DENISE_SLACK_ENABLED;
  const text = `DENISE — Capture Reassessment Required: ${reason}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'DENISE — Capture Reassessment Required' },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${sourceDescription}\n\n*Impact:*\nCurrent capture and proposal emphasis may require reassessment.`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Opportunity: ${opportunityId} · Analysis: ${analysisId}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'denise_acknowledge',
          value: JSON.stringify({ artifactId: analysisId, idempotencyKey: `reassess-${analysisId}` }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request Review' },
          action_id: 'denise_request_review',
          value: JSON.stringify({ artifactId: analysisId, opportunityId: opportunityId }),
        },
      ],
    },
  ];

  return {
    notificationType: 'CAPTURE_REASSESSMENT_REQUIRED',
    shouldPost,
    blocks,
    text,
  };
}

/**
 * Generate Slack payload for a high-priority clarification question.
 */
export function generateClarificationPayload(
  question: Pick<AcquisitionClarificationQuestion, 'source_section' | 'ambiguity' | 'proposed_question' | 'priority' | 'classification' | 'id'>,
  analysisId: string,
  opportunityId: string
): DeniseSlackPayload {
  const isHigh = question.priority === 'CRITICAL' || question.priority === 'HIGH';
  const isLegal = question.classification === 'LEGAL_REVIEW_REQUIRED';
  const shouldPost = DENISE_SLACK_ENABLED && (isHigh || isLegal);

  const notificationType: SlackNotificationType = isLegal
    ? 'LEGAL_REVIEW_REQUIRED'
    : 'HIGH_PRIORITY_CLARIFICATION';

  const headerText = isLegal
    ? 'DENISE — Legal Review Required'
    : 'DENISE — High-Priority Clarification';

  const text = `${headerText}: ${question.ambiguity}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Section:* ${question.source_section}\n*Issue:* ${question.ambiguity}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Draft Question:*\n${question.proposed_question}`,
      },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `Opportunity: ${opportunityId} · Source: ${question.source_section}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge' },
          action_id: 'denise_acknowledge',
          value: JSON.stringify({ artifactId: analysisId, idempotencyKey: `clarification-${question.id}` }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request Review' },
          action_id: 'denise_request_review',
          value: JSON.stringify({ artifactId: analysisId, opportunityId: opportunityId }),
        },
      ],
    },
  ];

  return { notificationType, shouldPost, blocks, text };
}

/**
 * Determine if a finding should trigger a proactive Slack notification.
 * Low-severity findings remain silent.
 */
export function shouldNotify(severity: string, potentiallyDisqualifying: boolean): boolean {
  if (!DENISE_SLACK_ENABLED) return false;
  if (potentiallyDisqualifying) return true;
  return severity === 'CRITICAL' || severity === 'HIGH';
}
