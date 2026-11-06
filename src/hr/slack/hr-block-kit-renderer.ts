/**
 * HR Block Kit Renderer — Structured Slack Formatting
 *
 * Transforms validated HR answers into Slack Block Kit payloads.
 * Operates strictly after answer and citation validation.
 * Does not retrieve knowledge, invoke LLMs, or reinterpret policy.
 *
 * Security:
 *   - Neutralizes Slack mentions in all text.
 *   - Escapes mrkdwn control characters in citation titles.
 *   - Enforces Slack block count and text length limits.
 *   - Uses only validated citation metadata.
 *   - Employee names are escaped to prevent injection.
 */

import type { KnownBlock, SectionBlock, HeaderBlock, DividerBlock, ContextBlock } from '@slack/types';
import type { HRAnswerResult } from '../llm/hr-answer-foundation.js';
import type { HRPipelineResult } from '../llm/hr-answer-pipeline.js';

// ── Slack Limits ───────────────────────────────────────────

/** Maximum blocks per message (Slack limit is 50). */
const MAX_BLOCKS = 45;

/** Maximum text length in a section block (Slack limit is 3000). */
const MAX_SECTION_TEXT = 2800;

/** Maximum text length for plain-text fallback. */
const MAX_FALLBACK_TEXT = 3000;

// ── Topic Emoji Map ────────────────────────────────────────

/**
 * Deterministic topic-to-emoji mapping.
 * Matched against the answer text and citation titles.
 */
const TOPIC_EMOJIS: Array<{ pattern: RegExp; emoji: string; label: string }> = [
  { pattern: /\b(pto|paid time off|vacation|time off)\b/i, emoji: '🏖️', label: 'Paid Time Off' },
  { pattern: /\b(sick leave|sick day|illness)\b/i, emoji: '🤒', label: 'Sick Leave' },
  { pattern: /\b(parental leave|maternity|paternity|family leave)\b/i, emoji: '👶', label: 'Parental Leave' },
  { pattern: /\b(remote work|work from home|wfh|hybrid|telecommut)/i, emoji: '🏠', label: 'Remote Work' },
  { pattern: /\b(cybersecurity|cyber\s*security|security\s*policy|phishing|password\s*policy)\b/i, emoji: '🛡️', label: 'Cybersecurity' },
  { pattern: /\b(benefits|insurance|401k|dental|vision|medical)\b/i, emoji: '💼', label: 'Employee Benefits' },
  { pattern: /\b(travel|reimburs|expense)\b/i, emoji: '✈️', label: 'Travel & Expenses' },
  { pattern: /\b(harassment|discrimination|complaint|reporting)\b/i, emoji: '⚖️', label: 'Workplace Compliance' },
  { pattern: /\b(timekeeping|timesheet|hours|time tracking)\b/i, emoji: '⏰', label: 'Timekeeping' },
  { pattern: /\b(holiday|day off)\b/i, emoji: '🎉', label: 'Holidays' },
  { pattern: /\b(onboarding|new hire|orientation)\b/i, emoji: '🚀', label: 'Onboarding' },
  { pattern: /\b(performance|review|evaluation)\b/i, emoji: '📊', label: 'Performance' },
  { pattern: /\b(salary|compensation|pay|bonus)\b/i, emoji: '💰', label: 'Compensation' },
  { pattern: /\b(termination|resignation|separation)\b/i, emoji: '📋', label: 'Separation' },
];

// ── Text Safety ────────────────────────────────────────────

/**
 * Neutralize Slack special mentions in text.
 */
function neutralizeMentions(text: string): string {
  return text
    .replace(/<!channel>/g, '@\u200Bchannel')
    .replace(/<!here>/g, '@\u200Bhere')
    .replace(/<!everyone>/g, '@\u200Beveryone')
    .replace(/<@(U[A-Z0-9]+)>/g, '@\u200Buser');
}

/**
 * Escape Slack mrkdwn control characters.
 */
function escapeSlackMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape an employee name for safe Slack display.
 * Prevents names from creating mentions, links, or formatting.
 */
export function escapeEmployeeName(name: string): string {
  return escapeSlackMrkdwn(neutralizeMentions(name));
}

/**
 * Normalize markdown to Slack mrkdwn safely.
 */
function normalizeToMrkdwn(text: string): string {
  return neutralizeMentions(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, (_m, inner: string) => `*${inner.replace(/\*/g, '')}*`)
    .replace(/^[\t ]*[-]\s+/gm, '• ')
    .replace(/^[\t ]*\*\s+/gm, '• ')
    .replace(/^[\t ]*\d+\.\s+/gm, (_m) => _m); // preserve numbered lists
}

// ── Topic Detection ────────────────────────────────────────

interface TopicMatch {
  emoji: string;
  label: string;
}

/**
 * Broad-topic keywords that indicate the question's primary subject
 * is a general category, not a specific sub-policy mentioned within it.
 *
 * Example: "What benefits do we offer, including parental leave?"
 * → primary subject is "benefits", not "parental leave"
 */
const BROAD_TOPIC_INDICATORS: Array<{ pattern: RegExp; emoji: string; label: string }> = [
  { pattern: /\bbenefit/i, emoji: '💼', label: 'Employee Benefits' },
];

/**
 * Detect the primary topic for header display.
 *
 * Decision hierarchy:
 * 1. Broad-topic indicator in the question (e.g., "benefits" dominates
 *    over incidental sub-topic mentions like "parental leave").
 * 2. Specific topic match in the question text.
 * 3. Citation title match (source policy identity).
 * 4. Answer text match (weakest — may mention multiple topics).
 *
 * This prevents incidental mentions (e.g., "18 Days Accrued PTO" in a
 * benefits answer) from overriding the actual topic.
 */
function detectTopic(
  answerText: string,
  citations: Array<{ title?: string }>,
  messageText: string = ''
): TopicMatch {
  if (messageText) {
    // 1. Check for broad-topic indicators first (overrides sub-topic matches)
    for (const { pattern, emoji, label } of BROAD_TOPIC_INDICATORS) {
      if (pattern.test(messageText)) {
        return { emoji, label };
      }
    }

    // 2. Specific topic match in question
    const questionMatch = matchTopic(messageText);
    if (questionMatch) return questionMatch;
  }

  // 3. Match against citation titles (source policy identity)
  const citationText = citations.map((c) => c.title || '').join(' ');
  if (citationText.trim()) {
    const citationMatch = matchTopic(citationText);
    if (citationMatch) return citationMatch;
  }

  // 4. Fall back to answer text (weakest signal)
  const answerMatch = matchTopic(answerText);
  if (answerMatch) return answerMatch;

  return { emoji: '📖', label: 'HR Policy' };
}

function matchTopic(text: string): TopicMatch | null {
  for (const { pattern, emoji, label } of TOPIC_EMOJIS) {
    if (pattern.test(text)) {
      return { emoji, label };
    }
  }
  return null;
}

// ── Block Builders ─────────────────────────────────────────

function headerBlock(text: string): HeaderBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: text.slice(0, 150), emoji: true },
  };
}

function sectionBlock(mrkdwn: string): SectionBlock {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text: mrkdwn.slice(0, MAX_SECTION_TEXT) },
  };
}

function dividerBlock(): DividerBlock {
  return { type: 'divider' };
}

function contextBlock(mrkdwn: string): ContextBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: mrkdwn.slice(0, 3000) }],
  };
}

// ── Answer Structuring ─────────────────────────────────────

/**
 * Split answer text into Slack-safe sections.
 * Preserves paragraph boundaries and list groupings.
 * Splits oversized paragraphs at safe boundaries (newlines, sentences)
 * without cutting through links, formatting, or mid-word.
 */
function splitIntoSections(text: string): string[] {
  // Split on double newlines (paragraph boundaries)
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  // Further split paragraphs that exceed the section text limit
  const sections: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= MAX_SECTION_TEXT) {
      sections.push(para);
    } else {
      // Split at single newlines first (list items, bullet groups)
      const lines = para.split('\n');
      let current = '';
      for (const line of lines) {
        if (current.length + line.length + 1 > MAX_SECTION_TEXT) {
          if (current.trim()) sections.push(current.trim());
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current.trim()) sections.push(current.trim());
    }
  }

  return sections;
}

// ── Citation Dedup ─────────────────────────────────────────

interface DedupedCitation {
  sourceUrl: string;
  title: string;
}

function deduplicateCitations(
  citations: Array<{ sourceUrl: string; title?: string }>
): DedupedCitation[] {
  const seen = new Set<string>();
  const unique: DedupedCitation[] = [];
  for (const c of citations) {
    const pageUrl = c.sourceUrl.replace(/#.*$/, '');
    if (!seen.has(pageUrl)) {
      seen.add(pageUrl);
      unique.push({ sourceUrl: pageUrl, title: c.title || 'Source' });
    }
  }
  return unique;
}

// ── Greeting ───────────────────────────────────────────────

/** Patterns that suggest the employee is starting a conversation. */
const GREETING_PATTERNS = /^\s*(hi|hello|hey|good\s*(morning|afternoon|evening)|help|can\s+you\s+help)\b/i;

/** Sensitive topics where a cheerful greeting would be inappropriate. */
const SENSITIVE_TOPICS = new Set(['Workplace Compliance', 'Separation']);

/**
 * Determine if a greeting with the employee's name is appropriate.
 *
 * Deterministic rules (no persistence required):
 * - Use name when the message looks like an initial greeting.
 * - Skip name for direct policy questions (no greeting words).
 * - Skip name for sensitive topics.
 * - Skip name when unavailable.
 */
export function shouldGreetByName(
  messageText: string,
  employeeName: string | null,
  topic: TopicMatch
): boolean {
  if (!employeeName) return false;
  if (SENSITIVE_TOPICS.has(topic.label)) return false;
  return GREETING_PATTERNS.test(messageText);
}

/**
 * Build a greeting line appropriate for the context.
 * Personalized only when shouldGreetByName() returns true.
 */
export function buildGreeting(
  employeeName: string | null,
  topic: TopicMatch,
  messageText: string = ''
): string {
  if (shouldGreetByName(messageText, employeeName, topic)) {
    const safeName = escapeEmployeeName(employeeName!);
    return `Hey ${safeName}! Here's what I found about *${topic.label}*:`;
  }
  return '';
}

// ── Main Renderer ──────────────────────────────────────────

export interface BlockKitPayload {
  text: string; // plain-text fallback
  blocks: KnownBlock[];
  /** True if content was truncated and a continuation message would be needed. */
  truncated: boolean;
}

export interface RenderOptions {
  employeeName?: string | null;
  /** Original message text from the employee (used for greeting detection). */
  messageText?: string;
}

/**
 * Render a validated HR answer as a Block Kit payload.
 *
 * Consumes only the final approved answer and validated citations.
 * Does not retrieve knowledge, invoke a model, or reinterpret policy.
 */
export function renderAnswerAsBlocks(
  result: HRAnswerResult & { ok: true },
  options: RenderOptions = {}
): BlockKitPayload {
  const { employeeName = null, messageText = '' } = options;
  const { text: answerText, citations } = result.answer;

  // Detect topic for header emoji (question text → citation titles → answer text)
  const topic = detectTopic(answerText, citations, messageText);

  // Build blocks
  const blocks: KnownBlock[] = [];

  // 1. Header with topic emoji
  blocks.push(headerBlock(`${topic.emoji} ${topic.label}`));

  // 2. Greeting section (only for conversational openers, not every question)
  const greeting = buildGreeting(employeeName, topic, messageText);
  if (greeting) {
    blocks.push(sectionBlock(greeting));
  }

  // 3. Answer body — split into sections for readability
  const normalized = normalizeToMrkdwn(answerText);
  const sections = splitIntoSections(normalized);
  const reservedBlocks = 3; // divider + sources + context
  let truncated = false;

  for (const section of sections) {
    if (blocks.length >= MAX_BLOCKS - reservedBlocks) {
      truncated = true;
      break;
    }
    blocks.push(sectionBlock(section));
  }

  // 4. Sources section
  const uniqueSources = deduplicateCitations(citations);
  if (uniqueSources.length > 0) {
    blocks.push(dividerBlock());
    const sourceLines = uniqueSources
      .map((c) => `• <${c.sourceUrl}|${escapeSlackMrkdwn(c.title)}>`)
      .join('\n');
    blocks.push(sectionBlock(`📚 *Sources*\n${sourceLines}`));
  }

  // 5. Footer context (with truncation notice if needed)
  const footerText = truncated
    ? '_This answer was shortened to fit. Contact HR for the complete policy details._'
    : '_Answers are based on approved FFTC policy documents. For clarification, contact HR._';
  blocks.push(contextBlock(footerText));

  // 6. Build plain-text fallback
  const fallbackText = buildPlainTextFallback(answerText, uniqueSources, truncated);

  return { text: fallbackText, blocks, truncated };
}

/**
 * Render a pipeline result (success or failure) as Block Kit.
 */
export function renderPipelineResultAsBlocks(
  result: HRPipelineResult,
  options: RenderOptions = {}
): BlockKitPayload {
  if (result.ok) {
    return renderAnswerAsBlocks(result, options);
  }

  // Failure — simple fallback block
  const blocks: KnownBlock[] = [
    sectionBlock(result.fallbackMessage),
  ];

  return { text: result.fallbackMessage, blocks, truncated: false };
}

// ── Plain-Text Fallback ────────────────────────────────────

function buildPlainTextFallback(
  answerText: string,
  sources: DedupedCitation[],
  truncated: boolean = false
): string {
  let text = neutralizeMentions(answerText);

  if (sources.length > 0) {
    const sourceLines = sources.map((c) => `• ${c.title}`).join('\n');
    text += `\n\nSources:\n${sourceLines}`;
  }

  if (truncated) {
    text += '\n\n(This answer was shortened. Contact HR for complete policy details.)';
  }

  if (text.length > MAX_FALLBACK_TEXT) {
    // Find a safe break point — don't cut through a word or link
    const cutPoint = text.lastIndexOf('\n', MAX_FALLBACK_TEXT - 50);
    const safeCut = cutPoint > MAX_FALLBACK_TEXT * 0.7 ? cutPoint : MAX_FALLBACK_TEXT - 50;
    text = text.slice(0, safeCut) + '\n\n(Shortened. Contact HR for complete details.)';
  }

  return text;
}
